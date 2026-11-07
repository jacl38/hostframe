#pragma once

#include <memory>
#include <GLFW/glfw3.h>

#include "src/dawn/node/interop/NodeAPI.h"
#include "window_options.h"
#include "binding_types.h"

namespace hostframe {
class ApplicationState;
class Presentation;
class WindowInput;

class WindowState {
 public:
  WindowState(Napi::Env env, DawnGPU gpu, const std::shared_ptr<ApplicationState>& application, const WindowOptions& options);
  ~WindowState();
  bool Close();
  GLFWwindow* NativeWindow() const;
  WindowInput& Input() { return *input_; }
  bool IsDisposed() const { return !presentation_; }
  bool IsConfigured() const;
  void RenderFrame(Napi::Env env, Napi::Function callback);
  napi_value RequestAdapter(Napi::Env env, Napi::Value options);
  napi_value Configure(Napi::Env env, Napi::Value configuration);
  void Unconfigure();
  bool ShouldClose() const;
  void RequestClose();
  const char* PresentMode() const;
  std::shared_ptr<ApplicationState> Owner() const { return application_.lock(); }

 private:
  std::weak_ptr<ApplicationState> application_;
  Napi::ObjectReference device_;
  Napi::ObjectReference gpu_;
  std::unique_ptr<Presentation> presentation_;
  std::unique_ptr<WindowInput> input_;
};

}
