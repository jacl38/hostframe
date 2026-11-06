#include "window.h"

#include <memory>
#include <stdexcept>

#include "src/dawn/node/binding/GPUDevice.h"
#include "application.h"
#include "presentation.h"
#include "input.h"
#include "bindings.h"
#include "native_boundary.h"
#include "dawn_bridge.h"

namespace hostframe {

WindowState::~WindowState() { Close(); }

WindowState::WindowState(Napi::Env env, DawnGPU owner,
                         const std::shared_ptr<ApplicationState>& application, const WindowOptions& options) : application_(application) {
  Napi::Value gpu(env, owner.value);
  auto& binding = RequireGPU(env, gpu);
  gpu_ = Napi::Persistent(gpu.As<Napi::Object>());
  presentation_ = std::make_unique<Presentation>(binding.GetNativeInstance(), options);
  input_ = std::make_unique<WindowInput>(presentation_->NativeWindow());
}

napi_value WindowState::RequestAdapter(Napi::Env env, Napi::Value value) {
  wgpu::interop::GPURequestAdapterOptions options;
  auto result = wgpu::interop::FromJSOptional(env, value, options);
  if(!result) {
    if(!env.IsExceptionPending()) throw Napi::TypeError::New(env, result.error);
    return env.Undefined();
  }
  if(env.IsExceptionPending()) return env.Undefined();
  return RequireGPU(env, gpu_.Value()).requestAdapterForSurface(env, options, presentation_->Surface());
}

napi_value WindowState::Configure(Napi::Env env, Napi::Value value) {
  try {
    auto configuration = presentation_->Configure(env, value);
    if(!env.IsExceptionPending()) {
      device_ = Napi::Persistent(configuration.As<Napi::Object>().Get("device").As<Napi::Object>());
    }
    return configuration;
  } catch(...) {
    // Replacement cleanup can clear the native configuration before throwing.
    // Preserve validation failures' old owner, but never retain a timed-out one.
    if(!IsConfigured()) device_.Reset();
    throw;
  }
}

void WindowState::Unconfigure() {
  // Retain through draining, but release even when draining reports a timeout.
  auto device = std::move(device_);
  presentation_->Unconfigure();
}

bool WindowState::IsConfigured() const { return presentation_ && presentation_->HasContextConfiguration(); }

bool WindowState::Close() {
  input_.reset();
  const bool drained = !presentation_ || presentation_->Close();
  presentation_.reset();
  device_.Reset();
  gpu_.Reset();
  if(auto application = Owner()) application->Unregister(this);
  application_.reset();
  return drained;
}

void WindowState::RenderFrame(Napi::Env env, Napi::Function callback) {
  if(!presentation_) throw Napi::Error::New(env, "Window is disposed");
  presentation_->RenderFrame(env, callback);
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

bool Window::Configured() {
  return NativeBoundary(env_, [&] {
    RequireMainThread(env_);
    return state_->IsConfigured();
  });
}

void Window::RenderFrame(FrameCallback callback) {
  NativeBoundary(env_, [&] {
    auto application = RequireAvailable();
    ApplicationOperation operation(*application);
    state_->RenderFrame(env_, Napi::Value(env_, callback.value).As<Napi::Function>());
  });
}

DawnAdapterRequest Window::RequestAdapter(AdapterOptionsArgument options) {
  return NativeBoundary(env_, [&]() -> DawnAdapterRequest {
    auto application = RequireAvailable();
    ApplicationOperation operation(*application);
    return {state_->RequestAdapter(env_, Napi::Value(env_, options.value))};
  });
}

CanvasConfiguration Window::Configure(CanvasConfiguration configuration) {
  return NativeBoundary(env_, [&]() -> CanvasConfiguration {
    auto application = RequireAvailable();
    ApplicationOperation operation(*application);
    return {env_, state_->Configure(env_, Napi::Value(env_, configuration.value))};
  });
}

void Window::Unconfigure() {
  NativeBoundary(env_, [&] {
    auto application = RequireAvailable();
    ApplicationOperation operation(*application);
    state_->Unconfigure();
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
}  // namespace hostframe
