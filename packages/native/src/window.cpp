#include "window.h"

#include <chrono>
#include <memory>
#include <stdexcept>
#include <thread>
#include <sys/syscall.h>
#include <unistd.h>

#include <GLFW/glfw3.h>
#include <webgpu/webgpu_glfw.h>

#include "src/dawn/node/binding/GPUDevice.h"
#include "src/dawn/node/binding/GPUTexture.h"

namespace ts_dawn {
namespace {

void RequireMainThread(Napi::Env env) {
  // This target is Linux-only. A worker cannot become GLFW's main thread.
  if(syscall(SYS_gettid) != getpid()) {
    throw Napi::Error::New(env, "Native windows require the process main thread");
  }
}

class GlfwSession {
 public:
  GlfwSession() {
    if(active_) throw std::runtime_error("Only one native window is supported in this increment");
    if(!glfwInit()) {
      glfwTerminate();
      throw std::runtime_error("GLFW initialization failed; check DISPLAY");
    }
    active_ = true;
  }
  ~GlfwSession() {
    glfwTerminate();
    active_ = false;
  }
  GlfwSession(const GlfwSession&) = delete;
  GlfwSession& operator=(const GlfwSession&) = delete;

 private:
  static bool active_;
};
bool GlfwSession::active_ = false;

// Members release in reverse order: surface/device before window before GLFW.
class Presentation {
 public:
  explicit Presentation(wgpu::Device device) : device_(std::move(device)) {
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
    configuration_.presentMode = wgpu::PresentMode::Fifo;
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
    glfwPollEvents();
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

 private:
  bool DeviceLost() const {
    return instance_.WaitAny(device_.GetLostFuture(), 0) == wgpu::WaitStatus::Success;
  }

  void Abort() {
    if(configured_) surface_.Unconfigure();
    configured_ = false;
  }

  GlfwSession session_;
  std::unique_ptr<GLFWwindow, decltype(&glfwDestroyWindow)> window_{nullptr, glfwDestroyWindow};
  wgpu::Device device_;
  wgpu::Instance instance_;
  wgpu::Surface surface_;
  wgpu::SurfaceConfiguration configuration_;
  bool configured_ = false;
};

class Window final : public Napi::ObjectWrap<Window> {
 public:
  static void Initialize(Napi::Env env, Napi::Object exports) {
    exports.Set("Window", DefineClass(env, "Window", {
      InstanceMethod("draw", &Window::Draw),
      InstanceMethod("dispose", &Window::Dispose)
    }));
  }

  explicit Window(const Napi::CallbackInfo& info) : Napi::ObjectWrap<Window>(info) {
    try {
      RequireMainThread(info.Env());
      void* wrapped = nullptr;
      if(!info[0].IsObject() || napi_unwrap(info.Env(), info[0], &wrapped) != napi_ok || !wrapped) {
        throw Napi::TypeError::New(info.Env(), "Expected a Dawn GPUDevice");
      }
      auto* device = wgpu::interop::GPUDevice::Unwrap(info[0].As<Napi::Object>());
      auto* binding = dynamic_cast<wgpu::binding::GPUDevice*>(device);
      if(!binding) throw Napi::TypeError::New(info.Env(), "Expected a Dawn GPUDevice");
      device_ = Napi::Persistent(info[0].As<Napi::Object>());
      presentation_ = std::make_unique<Presentation>(binding->GetNativeDevice());
      if(napi_add_env_cleanup_hook(info.Env(), Cleanup, this) != napi_ok) {
        presentation_.reset();
        throw Napi::Error::New(info.Env(), "Could not register window cleanup");
      }
      cleanupRegistered_ = true;
    } catch(const Napi::Error& error) {
      error.ThrowAsJavaScriptException();
    } catch(const std::exception& error) {
      Napi::Error::New(info.Env(), error.what()).ThrowAsJavaScriptException();
    }
  }

  ~Window() override {
    if(cleanupRegistered_) napi_remove_env_cleanup_hook(Env(), Cleanup, this);
    presentation_.reset();
  }

 private:
  struct Operation {
    bool& active;
    explicit Operation(bool& value) : active(value) { active = true; }
    ~Operation() { active = false; }
  };

  static void Cleanup(void* data) {
    // Runs before JS finalizers at environment shutdown, while the device is retained.
    auto* window = static_cast<Window*>(data);
    window->presentation_.reset();
    window->cleanupRegistered_ = false;
  }

  Napi::Value Draw(const Napi::CallbackInfo& info) {
    try {
      RequireMainThread(info.Env());
      if(!presentation_) throw Napi::Error::New(info.Env(), "Window is disposed");
      if(executing_) throw Napi::Error::New(info.Env(), "A window operation is already in progress");
      if(!info[0].IsFunction()) throw Napi::TypeError::New(info.Env(), "Expected a draw callback");
      Operation operation(executing_);
      presentation_->Draw(info.Env(), info[0].As<Napi::Function>());
    } catch(const Napi::Error& error) {
      error.ThrowAsJavaScriptException();
    }
    return info.Env().Undefined();
  }

  Napi::Value Dispose(const Napi::CallbackInfo& info) {
    try {
      RequireMainThread(info.Env());
      if(executing_) throw Napi::Error::New(info.Env(), "A window operation is already in progress");
      Operation operation(executing_);
      const bool drained = !presentation_ || presentation_->Close();
      presentation_.reset();
      device_.Reset();
      if(!drained) throw Napi::Error::New(info.Env(), "GPU cleanup timed out; device was destroyed");
    } catch(const Napi::Error& error) {
      error.ThrowAsJavaScriptException();
    }
    return info.Env().Undefined();
  }

  Napi::ObjectReference device_;
  std::unique_ptr<Presentation> presentation_;
  bool executing_ = false;
  bool cleanupRegistered_ = false;
};

}  // namespace

void InitializeWindow(Napi::Env env, Napi::Object exports) {
  Window::Initialize(env, exports);
}
}  // namespace ts_dawn
