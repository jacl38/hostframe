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
    input.events_.push_back({.type = "key", .code = key, .scancode = scancode,
                             .action = action, .modifiers = mods});
  });
  glfwSetMouseButtonCallback(window_, [](GLFWwindow* window, int button, int action, int mods) {
    auto& input = Get(window);
    if(!input.focused_ || glfwWindowShouldClose(window)) return;
    if(action == GLFW_RELEASE) {
      if(!input.buttons_.erase(button)) return;
    } else {
      input.buttons_[button] = true;
    }
    input.events_.push_back({.type = "pointerButton", .code = button, .action = action, .modifiers = mods});
  });
  glfwSetCursorPosCallback(window_, [](GLFWwindow* window, double x, double y) { Get(window).Position(x, y); });
  glfwSetScrollCallback(window_, [](GLFWwindow* window, double x, double y) {
    auto& input = Get(window);
    if(input.focused_ && !glfwWindowShouldClose(window)) input.events_.push_back({.type = "scroll", .dx = x, .dy = y});
  });
  glfwSetWindowFocusCallback(window_, [](GLFWwindow* window, int focused) {
    auto& input = Get(window);
    input.focused_ = focused;
    if(!focused) input.Reset();
    input.baseline_ = false;
    input.events_.push_back({.type = "focus", .value = focused != 0});
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
  events_.push_back({.type = "pointerMove", .x = x, .y = y, .dx = dx, .dy = dy, .value = captured_});
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
  events_.push_back({.type = "pointerCapture", .value = captured_, .raw = raw_});
}

void WindowInput::Reset() {
  for(const auto& [scancode, key] : keys_) {
    events_.push_back({.type = "key", .code = key, .scancode = scancode, .action = GLFW_RELEASE, .synthetic = true});
  }
  keys_.clear();
  for(const auto& [button, held] : buttons_) {
    (void)held;
    events_.push_back({.type = "pointerButton", .code = button, .action = GLFW_RELEASE, .synthetic = true});
  }
  buttons_.clear();
  Capture(false, false);
  baseline_ = false;
}

Napi::Object WindowInput::Snapshot(Napi::Env env) const {
  auto result = Napi::Object::New(env);
  auto keys = Napi::Array::New(env);
  auto scancodes = Napi::Array::New(env);
  auto buttons = Napi::Array::New(env);
  uint32_t index = 0;
  for(const auto& [scancode, key] : keys_) {
    keys.Set(index, key);
    scancodes.Set(index++, scancode);
  }
  index = 0;
  for(const auto& [button, held] : buttons_) {
    (void)held;
    buttons.Set(index++, button);
  }
  result.Set("keys", keys);
  result.Set("scancodes", scancodes);
  result.Set("buttons", buttons);
  result.Set("focused", focused_);
  result.Set("pointerCaptured", captured_);
  result.Set("rawMotion", raw_);
  result.Set("x", x_);
  result.Set("y", y_);
  return result;
}

void WindowInput::Dispatch(Napi::Env env, Napi::Function callback) {
  auto events = std::exchange(events_, {});
  auto array = Napi::Array::New(env, events.size());
  uint32_t index = 0;
  for(const auto& event : events) {
    auto object = Napi::Object::New(env);
    const std::string type(event.type);
    object.Set("type", type);
    if(type == "key" || type == "pointerButton") {
      object.Set(type == "key" ? "key" : "button", event.code);
      if(type == "key") object.Set("scancode", event.scancode);
      object.Set("action", event.action == GLFW_RELEASE ? "release" : event.action == GLFW_REPEAT ? "repeat" : "press");
      object.Set("modifiers", event.modifiers);
      object.Set("synthetic", event.synthetic);
    } else if(type == "pointerMove") {
      object.Set("x", event.x);
      object.Set("y", event.y);
      object.Set("deltaX", event.dx);
      object.Set("deltaY", event.dy);
      object.Set("captured", event.value);
    } else if(type == "scroll") {
      object.Set("deltaX", event.dx);
      object.Set("deltaY", event.dy);
    } else if(type == "focus") {
      object.Set("focused", event.value);
    } else {
      object.Set("captured", event.value);
      object.Set("rawMotion", event.raw);
    }
    array.Set(index++, object);
  }
  callback.Call({Snapshot(env), array});
  if(!env.IsExceptionPending() && std::exchange(capture_failed_, false)) {
    throw std::runtime_error("Could not release pointer capture");
  }
}
}
