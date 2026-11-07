#pragma once

#include <map>
#include <vector>
#include <GLFW/glfw3.h>
#include "binding_types.h"

namespace hostframe {
// GLFW callbacks only record data. No JavaScript runs on the GLFW callback stack.
// Owned by WindowState and detached before Presentation destroys the GLFW window.
class WindowInput {
 public:
  explicit WindowInput(GLFWwindow* window);
  ~WindowInput();
  InputState Snapshot() const;
  void Dispatch(InputCallback callback);
  void SetCapture(bool captured, bool raw);
  void Reset();
  void Close();

 private:
  static WindowInput& Get(GLFWwindow* window);
  void Capture(bool captured, bool raw);
  void Position(double x, double y);
  GLFWwindow* window_;
  WindowMetrics metrics_;
  bool focused_ = false, captured_ = false, raw_ = false, baseline_ = false;
  bool close_pending_ = false, closed_ = false;
  bool changing_mode_ = false, capture_failed_ = false;
  double x_ = 0, y_ = 0;
  std::map<int, int> keys_; // Platform scancode -> GLFW physical key token (including unknown).
  std::map<int, bool> buttons_;
  std::vector<InputEvent> events_;
};
}
