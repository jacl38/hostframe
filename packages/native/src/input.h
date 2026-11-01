#pragma once

#include <map>
#include <vector>
#include <GLFW/glfw3.h>
#include "src/dawn/node/interop/NodeAPI.h"

namespace ts_dawn {
// GLFW callbacks only record data. No JavaScript runs on the GLFW callback stack.
// Owned by WindowState and detached before Presentation destroys the GLFW window.
class WindowInput {
 public:
  explicit WindowInput(GLFWwindow* window);
  ~WindowInput();
  Napi::Object Snapshot(Napi::Env env) const;
  void Dispatch(Napi::Env env, Napi::Function callback);
  void SetCapture(bool captured, bool raw);
  void Reset();

 private:
  struct Event {
    const char* type;
    int code = 0, scancode = 0, action = 0, modifiers = 0;
    double x = 0, y = 0, dx = 0, dy = 0;
    bool value = false, raw = false, synthetic = false;
  };
  static WindowInput& Get(GLFWwindow* window);
  void Capture(bool captured, bool raw);
  void Position(double x, double y);
  GLFWwindow* window_;
  bool focused_ = false, captured_ = false, raw_ = false, baseline_ = false;
  bool changing_mode_ = false, capture_failed_ = false;
  double x_ = 0, y_ = 0;
  std::map<int, int> keys_; // Platform scancode -> GLFW physical key token (including unknown).
  std::map<int, bool> buttons_;
  std::vector<Event> events_;
};
}
