#include "bindings.h"

#include <cmath>
#include <limits>
#include <GLFW/glfw3.h>
#include "application.h"
#include "window.h"
#include "native_boundary.h"

namespace hostframe {
namespace {
int WindowInteger(Napi::Env env, double value, bool positive) {
  if(!std::isfinite(value) || std::floor(value) != value ||
      value < (positive ? 1 : std::numeric_limits<int>::min()) || value > std::numeric_limits<int>::max()) {
    throw Napi::RangeError::New(env, positive ? "Size must be positive signed 32-bit integers" : "Position must be signed 32-bit integers");
  }
  return static_cast<int>(value);
}
void CheckWindowControl(Napi::Env env) {
  const char* description = nullptr;
  if(glfwGetError(&description) != GLFW_NO_ERROR) {
    throw Napi::Error::New(env, description ? description : "Window control failed");
  }
}
}

void Window::SetTitle(std::string title) {
  NativeBoundary(env_, [&] {
    auto application = RequireAvailable();
    ApplicationOperation operation(*application);
    auto window = state_->NativeWindow();
    if(title.find('\0') != std::string::npos) throw Napi::TypeError::New(env_, "Title must not contain null characters");
    glfwGetError(nullptr);
    glfwSetWindowTitle(window, title.c_str());
    CheckWindowControl(env_);
  });
}

void Window::SetSize(double width, double height) {
  NativeBoundary(env_, [&] {
    auto application = RequireAvailable();
    ApplicationOperation operation(*application);
    auto window = state_->NativeWindow();
    const int w = WindowInteger(env_, width, true), h = WindowInteger(env_, height, true);
    glfwGetError(nullptr);
    glfwSetWindowSize(window, w, h);
    CheckWindowControl(env_);
  });
}

void Window::SetPosition(double x, double y) {
  NativeBoundary(env_, [&] {
    auto application = RequireAvailable();
    ApplicationOperation operation(*application);
    auto window = state_->NativeWindow();
    const int px = WindowInteger(env_, x, false), py = WindowInteger(env_, y, false);
    glfwGetError(nullptr);
    glfwSetWindowPos(window, px, py);
    CheckWindowControl(env_);
  });
}

void Window::SetVisible(bool visible) {
  NativeBoundary(env_, [&] {
    auto application = RequireAvailable();
    ApplicationOperation operation(*application);
    auto window = state_->NativeWindow();
    glfwGetError(nullptr);
    if(visible) glfwShowWindow(window);
    else glfwHideWindow(window);
    CheckWindowControl(env_);
  });
}

}
