#pragma once

#include <memory>

#include "src/dawn/node/interop/NodeAPI.h"

namespace ts_dawn {
class ApplicationState;
class Presentation;

class WindowState {
 public:
  WindowState(Napi::Env env, Napi::Value device, const std::shared_ptr<ApplicationState>& application);
  ~WindowState();
  bool Close();
  void Draw(Napi::Env env, Napi::Function callback);
  bool ShouldClose() const;
  void RequestClose();
  std::shared_ptr<ApplicationState> Owner() const { return application_.lock(); }

 private:
  std::weak_ptr<ApplicationState> application_;
  Napi::ObjectReference device_;
  std::unique_ptr<Presentation> presentation_;
};

Napi::Function DefineWindow(Napi::Env env);
}
