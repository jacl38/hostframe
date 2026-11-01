#include "window.h"

#include <memory>
#include <stdexcept>

#include "src/dawn/node/binding/GPUDevice.h"
#include "application.h"
#include "presentation.h"

namespace ts_dawn {

WindowState::WindowState(Napi::Env env, Napi::Value value,
                         const std::shared_ptr<ApplicationState>& application, const WindowOptions& options) : application_(application) {
  void* wrapped = nullptr;
  if(!value.IsObject() || napi_unwrap(env, value, &wrapped) != napi_ok || !wrapped) {
    throw Napi::TypeError::New(env, "Expected a Dawn GPUDevice");
  }
  auto* device = wgpu::interop::GPUDevice::Unwrap(value.As<Napi::Object>());
  auto* binding = dynamic_cast<wgpu::binding::GPUDevice*>(device);
  if(!binding) throw Napi::TypeError::New(env, "Expected a Dawn GPUDevice");
  device_ = Napi::Persistent(value.As<Napi::Object>());
  presentation_ = std::make_unique<Presentation>(binding->GetNativeDevice(), options);
}

WindowState::~WindowState() { Close(); }

bool WindowState::Close() {
  const bool drained = !presentation_ || presentation_->Close();
  presentation_.reset();
  device_.Reset();
  if(auto application = Owner()) application->Unregister(this);
  application_.reset();
  return drained;
}

void WindowState::Draw(Napi::Env env, Napi::Function callback) {
  if(!presentation_) throw Napi::Error::New(env, "Window is disposed");
  presentation_->Draw(env, callback);
}

bool WindowState::ShouldClose() const {
  return !presentation_ || presentation_->ShouldClose();
}

void WindowState::RequestClose() {
  presentation_->RequestClose();
}

const char* WindowState::PresentMode() const {
  return presentation_->PresentMode();
}

namespace {
class Window final : public Napi::ObjectWrap<Window> {
 public:
  static Napi::Function Constructor(Napi::Env env) {
    return DefineClass(env, "Window", {
      InstanceMethod("draw", &Window::Draw),
      InstanceAccessor("shouldClose", &Window::ShouldClose, nullptr),
      InstanceAccessor("presentMode", &Window::PresentMode, nullptr),
      InstanceMethod("requestClose", &Window::RequestClose),
      InstanceMethod("dispose", &Window::Dispose)
    });
  }

  explicit Window(const Napi::CallbackInfo& info) : Napi::ObjectWrap<Window>(info) {
    try {
      RequireMainThread(info.Env());
      if(!info[0].IsExternal()) {
        throw Napi::TypeError::New(info.Env(), "Use Application.createWindow(device)");
      }
      state_ = *info[0].As<Napi::External<std::shared_ptr<WindowState>>>().Data();
    } catch(const Napi::Error& error) {
      error.ThrowAsJavaScriptException();
    }
  }

 private:
  Napi::Value Draw(const Napi::CallbackInfo& info) {
    try {
      RequireMainThread(info.Env());
      auto application = state_->Owner();
      if(!application) throw Napi::Error::New(info.Env(), "Window is disposed");
      application->RequireAvailable(info.Env());
      if(!info[0].IsFunction()) throw Napi::TypeError::New(info.Env(), "Expected a draw callback");
      ApplicationOperation operation(*application);
      state_->Draw(info.Env(), info[0].As<Napi::Function>());
    } catch(const Napi::Error& error) {
      error.ThrowAsJavaScriptException();
    } catch(const std::exception& error) {
      Napi::Error::New(info.Env(), error.what()).ThrowAsJavaScriptException();
    }
    return info.Env().Undefined();
  }

  Napi::Value Dispose(const Napi::CallbackInfo& info) {
    try {
      RequireMainThread(info.Env());
      auto application = state_->Owner();
      if(!application) return info.Env().Undefined();
      application->RequireAvailable(info.Env());
      ApplicationOperation operation(*application);
      if(!state_->Close()) throw Napi::Error::New(info.Env(), "GPU cleanup timed out; device was destroyed");
    } catch(const Napi::Error& error) {
      error.ThrowAsJavaScriptException();
    }
    return info.Env().Undefined();
  }

  Napi::Value ShouldClose(const Napi::CallbackInfo& info) {
    try {
      RequireMainThread(info.Env());
      auto application = state_->Owner();
      if(!application) throw Napi::Error::New(info.Env(), "Window is disposed");
      application->RequireAvailable(info.Env());
      return Napi::Boolean::New(info.Env(), state_->ShouldClose());
    } catch(const Napi::Error& error) {
      error.ThrowAsJavaScriptException();
    }
    return info.Env().Undefined();
  }

  Napi::Value RequestClose(const Napi::CallbackInfo& info) {
    try {
      RequireMainThread(info.Env());
      auto application = state_->Owner();
      if(!application) throw Napi::Error::New(info.Env(), "Window is disposed");
      application->RequireAvailable(info.Env());
      ApplicationOperation operation(*application);
      state_->RequestClose();
    } catch(const Napi::Error& error) {
      error.ThrowAsJavaScriptException();
    }
    return info.Env().Undefined();
  }

  Napi::Value PresentMode(const Napi::CallbackInfo& info) {
    try {
      RequireMainThread(info.Env());
      auto application = state_->Owner();
      if(!application) throw Napi::Error::New(info.Env(), "Window is disposed");
      application->RequireAvailable(info.Env());
      return Napi::String::New(info.Env(), state_->PresentMode());
    } catch(const Napi::Error& error) {
      error.ThrowAsJavaScriptException();
    }
    return info.Env().Undefined();
  }

  std::shared_ptr<WindowState> state_;
};

}  // namespace

Napi::Function DefineWindow(Napi::Env env) {
  return Window::Constructor(env);
}
}  // namespace ts_dawn
