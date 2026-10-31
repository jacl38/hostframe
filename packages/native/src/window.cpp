#include "window.h"

#include <chrono>
#include <memory>
#include <stdexcept>
#include <thread>

#include <GLFW/glfw3.h>
#include <webgpu/webgpu_glfw.h>

#include "src/dawn/node/binding/GPUDevice.h"
#include "src/dawn/node/binding/GPUTexture.h"
#include "application.h"
#include "present_mode.h"

namespace ts_dawn {

// Members release in reverse order: surface/device before the native window.
// The application's GLFW session outlives all presentation resources.
class Presentation {
 public:
  Presentation(wgpu::Device device, bool vsync) : device_(std::move(device)) {
    instance_ = device_.GetAdapter().GetInstance();
    if(DeviceLost()) throw std::runtime_error("GPU device is lost or destroyed");
    glfwDefaultWindowHints();
    glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API);
    glfwWindowHint(GLFW_RESIZABLE, GLFW_FALSE);
    window_.reset(glfwCreateWindow(320, 240, "ts-dawn solid color", nullptr, nullptr));
    if(!window_) throw std::runtime_error("GLFW window creation failed");
    surface_ = wgpu::glfw::CreateSurfaceForWindow(instance_, window_.get());
    if(!surface_) throw std::runtime_error("Dawn surface creation failed");
    wgpu::SurfaceCapabilities capabilities;
    if(surface_.GetCapabilities(device_.GetAdapter(), &capabilities) != wgpu::Status::Success ||
       capabilities.formatCount == 0 || capabilities.alphaModeCount == 0) {
      throw std::runtime_error("Device adapter cannot present to this window");
    }
    configuration_.device = device_;
    configuration_.format = capabilities.formats[0];
    configuration_.alphaMode = capabilities.alphaModes[0];
    configuration_.presentMode = SelectPresentMode({capabilities.presentModes, capabilities.presentModeCount}, vsync);
    int width = 0;
    int height = 0;
    glfwGetFramebufferSize(window_.get(), &width, &height);
    if(width <= 0 || height <= 0) throw std::runtime_error("Window framebuffer is empty");
    configuration_.width = width;
    configuration_.height = height;
  }
  ~Presentation() { Close(); }

  bool Close() {
    if(!surface_) return true;
    Abort();
    surface_ = nullptr;
    // Vulkan defers swapchain deletion to a queue serial. Complete that work
    // before GLFW closes the X11 connection used by the swapchain's deleter.
    if(!DeviceLost()) {
      auto queue = device_.GetQueue();
      auto commands = device_.CreateCommandEncoder().Finish();
      queue.Submit(1, &commands);
    }
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    // A work-done future advances user-visible completion only. DeviceTick also
    // runs Dawn's best-effort deletion processors before reporting the device idle.
    while(dawn::native::DeviceTick(device_.Get())) {
      if(std::chrono::steady_clock::now() >= deadline) {
        // A stalled device must release its swapchains before its display dies.
        device_.Destroy();
        return false;
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    return true;
  }

  void Draw(Napi::Env env, Napi::Function callback) {
    if(DeviceLost()) throw Napi::Error::New(env, "GPU device is lost or destroyed");
    if(glfwWindowShouldClose(window_.get())) throw Napi::Error::New(env, "Window close requested");
    if(!configured_) {
      surface_.Configure(&configuration_);
      configured_ = true;
    }
    wgpu::SurfaceTexture acquired;
    surface_.GetCurrentTexture(&acquired);
    if((acquired.status != wgpu::SurfaceGetCurrentTextureStatus::SuccessOptimal &&
        acquired.status != wgpu::SurfaceGetCurrentTextureStatus::SuccessSuboptimal) || !acquired.texture) {
      Abort();
      throw Napi::Error::New(env, "Surface texture acquisition failed (device lost or surface unavailable)");
    }
    // Expire both the JS texture and any retained views on success or exception.
    struct Frame {
      wgpu::Texture texture;
      ~Frame() { texture.Destroy(); }
    } frame{acquired.texture};
    try {
      wgpu::TextureDescriptor descriptor;
      descriptor.size = {configuration_.width, configuration_.height, 1};
      descriptor.format = configuration_.format;
      descriptor.usage = configuration_.usage;
      auto texture = wgpu::interop::GPUTexture::Create<wgpu::binding::GPUTexture>(
          env, device_, descriptor, acquired.texture);
      auto result = callback.Call({texture});
      // Dawn compiles node-addon-api with C++ exception propagation disabled.
      if(env.IsExceptionPending()) {
        Abort();
        return;
      }
      if(!result.IsUndefined()) {
        throw Napi::TypeError::New(env, "draw callback must return undefined synchronously");
      }
      if(surface_.Present() != wgpu::Status::Success) {
        throw Napi::Error::New(env, "Surface presentation failed");
      }
      instance_.ProcessEvents();
    } catch(...) {
      // Abandon the frame, preserve the original exception, and permit a later draw.
      Abort();
      throw;
    }
  }

  bool ShouldClose() const { return glfwWindowShouldClose(window_.get()); }
  void RequestClose() { glfwSetWindowShouldClose(window_.get(), GLFW_TRUE); }
  const char* PresentMode() const { return PresentModeName(configuration_.presentMode); }

 private:
  bool DeviceLost() const {
    return instance_.WaitAny(device_.GetLostFuture(), 0) == wgpu::WaitStatus::Success;
  }

  void Abort() {
    if(configured_) surface_.Unconfigure();
    configured_ = false;
  }

  std::unique_ptr<GLFWwindow, decltype(&glfwDestroyWindow)> window_{nullptr, glfwDestroyWindow};
  wgpu::Device device_;
  wgpu::Instance instance_;
  wgpu::Surface surface_;
  wgpu::SurfaceConfiguration configuration_;
  bool configured_ = false;
};

WindowState::WindowState(Napi::Env env, Napi::Value value,
                         const std::shared_ptr<ApplicationState>& application, bool vsync) : application_(application) {
  void* wrapped = nullptr;
  if(!value.IsObject() || napi_unwrap(env, value, &wrapped) != napi_ok || !wrapped) {
    throw Napi::TypeError::New(env, "Expected a Dawn GPUDevice");
  }
  auto* device = wgpu::interop::GPUDevice::Unwrap(value.As<Napi::Object>());
  auto* binding = dynamic_cast<wgpu::binding::GPUDevice*>(device);
  if(!binding) throw Napi::TypeError::New(env, "Expected a Dawn GPUDevice");
  device_ = Napi::Persistent(value.As<Napi::Object>());
  presentation_ = std::make_unique<Presentation>(binding->GetNativeDevice(), vsync);
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
