#pragma once

#include <memory>

#include "src/dawn/node/interop/NodeAPI.h"
#include "window_options.h"

namespace ts_dawn {
class ApplicationState;
class Presentation;
class WindowInput;

class WindowState {
 public:
  WindowState(Napi::Env env, Napi::Value device, const std::shared_ptr<ApplicationState>& application, const WindowOptions& options);
  ~WindowState();
  bool Close();
  WindowInput& Input() { return *input_; }
  bool IsDisposed() const { return !presentation_; }
  void Draw(Napi::Env env, Napi::Function callback);
  bool ShouldClose() const;
  void RequestClose();
  const char* PresentMode() const;
  std::shared_ptr<ApplicationState> Owner() const { return application_.lock(); }

 private:
  std::weak_ptr<ApplicationState> application_;
  Napi::ObjectReference device_;
  std::unique_ptr<Presentation> presentation_;
  std::unique_ptr<WindowInput> input_;
};

Napi::Function DefineWindow(Napi::Env env);
}
