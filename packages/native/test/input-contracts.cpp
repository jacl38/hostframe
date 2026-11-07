// Exercises the production GLFW callbacks without exporting injection controls in the addon.
#include "input.h"
#include <functional>
#include <iostream>
#include <stdexcept>

using namespace hostframe;
namespace {
std::function<void(const InputState&, const std::vector<InputEvent>&)> observe;
void Check(bool condition) { if(!condition) throw std::runtime_error("Native input contract failed"); }
}
namespace hostframe {
void InputCallback::Call(const InputState& state, const std::vector<InputEvent>& events) const { observe(state, events); }
}
// This executable has no JavaScript environment; listener failures throw directly.
extern "C" napi_status napi_is_exception_pending(napi_env, bool* pending) { *pending = false; return napi_ok; }

int main() {
  Check(glfwInit());
  glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API);
  GLFWwindow* window = glfwCreateWindow(100, 100, "input contracts", nullptr, nullptr);
  Check(window != nullptr);
  {
    WindowInput input(window);
    auto key = glfwSetKeyCallback(window, nullptr);
    glfwSetKeyCallback(window, key);
    auto focus = glfwSetWindowFocusCallback(window, nullptr);
    glfwSetWindowFocusCallback(window, focus);
    auto button = glfwSetMouseButtonCallback(window, nullptr);
    glfwSetMouseButtonCallback(window, button);
    focus(window, GLFW_TRUE);
    observe = [](const auto& state, const auto& events) {
      Check(state.metrics.width == 100 && state.metrics.height == 100);
      Check(state.metrics.framebufferWidth > 0 && state.metrics.drawable);
      Check(!events.empty() && std::holds_alternative<MetricsEvent>(events.front()));
      Check(std::get<MetricsEvent>(events.front()).metrics == state.metrics);
    };
    input.Dispatch({});
    observe = [](const auto&, const auto& events) { Check(events.empty()); };
    input.Dispatch({});
    key(window, GLFW_KEY_A, 38, GLFW_PRESS, 0);
    key(window, GLFW_KEY_A, 38, GLFW_RELEASE, 0);
    observe = [](const auto& state, const auto& events) {
      Check(state.keys.empty() && state.scancodes.empty());
      Check(events.size() == 2);
      Check(std::get<KeyEvent>(events[0]).action.value == "press");
      Check(std::get<KeyEvent>(events[1]).action.value == "release");
    };
    input.Dispatch({});
    key(window, GLFW_KEY_UNKNOWN, 901, GLFW_PRESS, 0);
    key(window, GLFW_KEY_UNKNOWN, 902, GLFW_PRESS, 0);
    Check(input.Snapshot().scancodes == std::vector<int>({901, 902}));
    Check(input.Snapshot().keys == std::vector<int>({GLFW_KEY_UNKNOWN, GLFW_KEY_UNKNOWN}));
    key(window, GLFW_KEY_UNKNOWN, 901, GLFW_RELEASE, 0);
    observe = [](const auto& state, const auto& events) {
      Check(state.keys == std::vector<int>{GLFW_KEY_UNKNOWN});
      Check(state.scancodes == std::vector<int>{902});
      Check(events.size() == 3);
      Check(std::get<KeyEvent>(events[2]).scancode == 901);
    };
    input.Dispatch({});
    key(window, GLFW_KEY_A, 38, GLFW_PRESS, 0);
    key(window, GLFW_KEY_A, 38, GLFW_RELEASE, 0);
    button(window, GLFW_MOUSE_BUTTON_LEFT, GLFW_PRESS, 0);
    focus(window, GLFW_FALSE);
    // Late OS releases after reconciliation must not duplicate synthetic releases.
    key(window, GLFW_KEY_UNKNOWN, 902, GLFW_RELEASE, 0);
    button(window, GLFW_MOUSE_BUTTON_LEFT, GLFW_RELEASE, 0);
    observe = [](const auto& state, const auto& events) {
      Check(!state.focused && state.keys.empty() && state.scancodes.empty() && state.buttons.empty());
      Check(events.size() == 6);
      Check(std::get<KeyEvent>(events[3]).synthetic);
      Check(std::get<KeyEvent>(events[3]).scancode == 902);
      Check(std::get<PointerButtonEvent>(events[4]).synthetic);
      Check(!std::get<FocusEvent>(events[5]).focused);
      throw std::runtime_error("listener failure");
    };
    try { input.Dispatch({}); Check(false); } catch(const std::runtime_error& error) {
      Check(std::string(error.what()) == "listener failure");
    }
    observe = [](const auto& state, const auto& events) { Check(events.empty() && state.keys.empty() && state.buttons.empty()); };
    input.Dispatch({});
    focus(window, GLFW_TRUE);
    key(window, GLFW_KEY_UNKNOWN, 902, GLFW_RELEASE, 0);
    button(window, GLFW_MOUSE_BUTTON_LEFT, GLFW_RELEASE, 0);
    key(window, GLFW_KEY_UNKNOWN, 902, GLFW_PRESS, 0);
    key(window, GLFW_KEY_UNKNOWN, 902, GLFW_RELEASE, 0);
    observe = [](const auto& state, const auto& events) { Check(state.keys.empty() && events.size() == 3); };
    input.Dispatch({});
  }
  glfwDestroyWindow(window);
  glfwTerminate();
  std::cout << "Native batched input contracts passed\n";
}
