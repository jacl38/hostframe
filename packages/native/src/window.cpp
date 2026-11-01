#include "window.h"

#include <memory>
#include <stdexcept>

#include "src/dawn/node/binding/GPUDevice.h"
#include "application.h"
#include "presentation.h"
#include "input.h"
#include "bindings.h"
#include "native_boundary.h"

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
  input_ = std::make_unique<WindowInput>(presentation_->NativeWindow());
}

WindowState::~WindowState() { Close(); }

bool WindowState::Close() {
  input_.reset();
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
  input_->Reset();
}

const char* WindowState::PresentMode() const {
  return presentation_->PresentMode();
}

std::shared_ptr<ApplicationState> Window::RequireAvailable() {
  RequireMainThread(env_);
  auto application = state_->Owner();
  if(!application) throw Napi::Error::New(env_, "Window is disposed");
  application->RequireAvailable(env_);
  return application;
}

bool Window::Disposed() {
  return NativeBoundary(env_, [&] {
    RequireMainThread(env_);
    return state_->IsDisposed();
  });
}

void Window::Draw(DrawCallback callback) {
  NativeBoundary(env_, [&] {
    auto application = RequireAvailable();
    ApplicationOperation operation(*application);
    state_->Draw(env_, Napi::Value(env_, callback.value).As<Napi::Function>());
  });
}

void Window::DispatchInput(InputCallback callback) {
  NativeBoundary(env_, [&] {
    auto application = RequireAvailable();
    ApplicationOperation operation(*application);
    state_->Input().Dispatch(callback);
  });
}

InputState Window::SetPointerCapture(bool captured, bool rawMotion) {
  return NativeBoundary(env_, [&] {
    auto application = RequireAvailable();
    ApplicationOperation operation(*application);
    state_->Input().SetCapture(captured, rawMotion);
    return state_->Input().Snapshot();
  });
}

InputState Window::RequestClose() {
  return NativeBoundary(env_, [&] {
    auto application = RequireAvailable();
    ApplicationOperation operation(*application);
    state_->RequestClose();
    return state_->Input().Snapshot();
  });
}

void Window::Dispose() {
  NativeBoundary(env_, [&] {
    RequireMainThread(env_);
    auto application = state_->Owner();
    if(!application) return;
    application->RequireAvailable(env_);
    ApplicationOperation operation(*application);
    if(!state_->Close()) throw Napi::Error::New(env_, "GPU cleanup timed out; device was destroyed");
  });
}

bool Window::ShouldClose() {
  return NativeBoundary(env_, [&] {
    auto application = RequireAvailable();
    return state_->ShouldClose();
  });
}

PresentMode Window::GetPresentMode() {
  return NativeBoundary(env_, [&] {
    auto application = RequireAvailable();
    return PresentMode(state_->PresentMode());
  });
}
}  // namespace ts_dawn
