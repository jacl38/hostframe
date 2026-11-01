#include "input.h"

#include <stdexcept>
#include <utility>

namespace ts_dawn {
WindowInput& WindowInput::Get(GLFWwindow* window) {
  return *static_cast<WindowInput*>(glfwGetWindowUserPointer(window));
}

WindowInput::WindowInput(GLFWwindow* window) : window_(window) {
  focused_ = glfwGetWindowAttrib(window_, GLFW_FOCUSED);
  glfwGetCursorPos(window_, &x_, &y_);
  baseline_ = true;
  glfwSetWindowUserPointer(window_, this);
  glfwSetInputMode(window_, GLFW_LOCK_KEY_MODS, GLFW_TRUE);
  glfwSetKeyCallback(window_, [](GLFWwindow* window, int key, int scancode, int action, int mods) {
    auto& input = Get(window);
    if(!input.focused_ || glfwWindowShouldClose(window)) return;
    if(action == GLFW_RELEASE) {
      if(!input.keys_.erase(scancode)) return;
    } else {
      input.keys_[scancode] = key;
    }
    input.events_.emplace_back(KeyEvent{.type = {}, .key = key, .scancode = scancode,
        .action = action == GLFW_RELEASE ? "release" : action == GLFW_REPEAT ? "repeat" : "press",
        .modifiers = mods});
  });
  glfwSetMouseButtonCallback(window_, [](GLFWwindow* window, int button, int action, int mods) {
    auto& input = Get(window);
    if(!input.focused_ || glfwWindowShouldClose(window)) return;
    if(action == GLFW_RELEASE) {
      if(!input.buttons_.erase(button)) return;
    } else {
      input.buttons_[button] = true;
    }
    input.events_.emplace_back(PointerButtonEvent{.type = {}, .button = button,
        .action = action == GLFW_RELEASE ? "release" : "press", .modifiers = mods});
  });
  glfwSetCursorPosCallback(window_, [](GLFWwindow* window, double x, double y) { Get(window).Position(x, y); });
  glfwSetScrollCallback(window_, [](GLFWwindow* window, double x, double y) {
    auto& input = Get(window);
    if(input.focused_ && !glfwWindowShouldClose(window)) {
      input.events_.emplace_back(ScrollEvent{.type = {}, .deltaX = x, .deltaY = y});
    }
  });
  glfwSetWindowFocusCallback(window_, [](GLFWwindow* window, int focused) {
    auto& input = Get(window);
    input.focused_ = focused;
    if(!focused) input.Reset();
    input.baseline_ = false;
    input.events_.emplace_back(FocusEvent{.type = {}, .focused = focused != 0});
  });
  glfwSetWindowCloseCallback(window_, [](GLFWwindow* window) { Get(window).Reset(); });
}

WindowInput::~WindowInput() {
  // No callbacks may retain this object during native window destruction.
  glfwSetKeyCallback(window_, nullptr);
  glfwSetMouseButtonCallback(window_, nullptr);
  glfwSetCursorPosCallback(window_, nullptr);
  glfwSetScrollCallback(window_, nullptr);
  glfwSetWindowFocusCallback(window_, nullptr);
  glfwSetWindowCloseCallback(window_, nullptr);
  glfwSetWindowUserPointer(window_, nullptr);
  glfwSetInputMode(window_, GLFW_CURSOR, GLFW_CURSOR_NORMAL);
}

void WindowInput::Position(double x, double y) {
  if(changing_mode_ || glfwWindowShouldClose(window_)) return;
  const double dx = baseline_ ? x - x_ : 0;
  const double dy = baseline_ ? y - y_ : 0;
  x_ = x;
  y_ = y;
  baseline_ = true;
  events_.emplace_back(PointerMoveEvent{.type = {}, .x = x, .y = y,
      .deltaX = dx, .deltaY = dy, .captured = captured_});
}

void WindowInput::SetCapture(bool captured, bool raw) {
  if(captured && (!focused_ || glfwWindowShouldClose(window_))) {
    throw std::runtime_error("Pointer capture requires an open, focused window");
  }
  if(captured && raw && !glfwRawMouseMotionSupported()) throw std::runtime_error("Raw mouse motion is unavailable");
  Capture(captured, captured && raw);
  if(std::exchange(capture_failed_, false)) throw std::runtime_error("Could not change pointer capture mode");
}

void WindowInput::Capture(bool captured, bool raw) {
  if(captured == captured_ && raw == raw_) return;
  // Mode changes may synchronously invoke cursor callbacks. Reset their baseline
  // before and after so cursor restoration/recentering never becomes camera motion.
  baseline_ = false;
  changing_mode_ = true;
  glfwGetError(nullptr);
  if(glfwRawMouseMotionSupported()) glfwSetInputMode(window_, GLFW_RAW_MOUSE_MOTION, raw ? GLFW_TRUE : GLFW_FALSE);
  glfwSetInputMode(window_, GLFW_CURSOR, captured ? GLFW_CURSOR_DISABLED : GLFW_CURSOR_NORMAL);
  capture_failed_ = glfwGetError(nullptr) != GLFW_NO_ERROR;
  captured_ = glfwGetInputMode(window_, GLFW_CURSOR) == GLFW_CURSOR_DISABLED;
  raw_ = glfwRawMouseMotionSupported() && glfwGetInputMode(window_, GLFW_RAW_MOUSE_MOTION);
  changing_mode_ = false;
  glfwGetCursorPos(window_, &x_, &y_);
  baseline_ = false;
  events_.emplace_back(PointerCaptureEvent{.type = {}, .captured = captured_, .rawMotion = raw_});
}

void WindowInput::Reset() {
  for(const auto& [scancode, key] : keys_) {
    events_.emplace_back(KeyEvent{.type = {}, .key = key, .scancode = scancode,
        .action = "release", .synthetic = true});
  }
  keys_.clear();
  for(const auto& [button, held] : buttons_) {
    (void)held;
    events_.emplace_back(PointerButtonEvent{.type = {}, .button = button,
        .action = "release", .synthetic = true});
  }
  buttons_.clear();
  Capture(false, false);
  baseline_ = false;
}

InputState WindowInput::Snapshot() const {
  InputState state;
  for(const auto& [scancode, key] : keys_) {
    state.keys.push_back(key);
    state.scancodes.push_back(scancode);
  }
  for(const auto& [button, held] : buttons_) {
    (void)held;
    state.buttons.push_back(button);
  }
  state.focused = focused_;
  state.pointerCaptured = captured_;
  state.rawMotion = raw_;
  state.x = x_;
  state.y = y_;
  return state;
}

void WindowInput::Dispatch(InputCallback callback) {
  auto events = std::exchange(events_, {});
  callback.Call(Snapshot(), events);
  bool pending = false;
  napi_is_exception_pending(callback.env, &pending);
  if(!pending && std::exchange(capture_failed_, false)) {
    throw std::runtime_error("Could not release pointer capture");
  }
}
}
