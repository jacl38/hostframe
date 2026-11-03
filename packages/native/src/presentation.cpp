#include "presentation.h"

#include <chrono>
#include <stdexcept>
#include <thread>

#include <webgpu/webgpu_glfw.h>

#include "src/dawn/node/binding/GPUTexture.h"
#include "present_mode.h"
#include "surface_acquisition.h"

namespace hostframe {
Presentation::Presentation(wgpu::Device device, const WindowOptions& options) : device_(std::move(device)) {
  instance_ = device_.GetAdapter().GetInstance();
  if(DeviceLost()) throw std::runtime_error("GPU device is lost or destroyed");
  glfwDefaultWindowHints();
  glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API);
  glfwWindowHint(GLFW_RESIZABLE, options.resizable ? GLFW_TRUE : GLFW_FALSE);
  window_.reset(glfwCreateWindow(options.width, options.height, options.title.c_str(), nullptr, nullptr));
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
  configuration_.presentMode = SelectPresentMode({capabilities.presentModes, capabilities.presentModeCount}, options.vsync);
  wgpu::Limits limits;
  if(device_.GetLimits(&limits) != wgpu::Status::Success) {
    throw std::runtime_error("Device limits unavailable");
  }
  max_dimension_ = limits.maxTextureDimension2D;
}

Presentation::~Presentation() { Close(); }

bool Presentation::Close() {
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

void Presentation::Draw(Napi::Env env, Napi::Function callback) {
  if(DeviceLost()) throw Napi::Error::New(env, "GPU device is lost or destroyed");
  if(glfwWindowShouldClose(window_.get())) throw Napi::Error::New(env, "Window close requested");
  auto acquired = Acquire(env);
  if(!acquired.texture) {
    instance_.ProcessEvents();
    return;
  }
  // Defer suboptimal reconfiguration until the next draw, after this frame expires.
  reconfigure_ = acquired.status == wgpu::SurfaceGetCurrentTextureStatus::SuccessSuboptimal;
  // Expire both the JS texture and any retained views on success or exception.
  struct Frame {
    wgpu::Texture texture;
    ~Frame() { texture.Destroy(); }
  } frame{acquired.texture};
  try {
    wgpu::TextureDescriptor descriptor;
    descriptor.size = {acquired.texture.GetWidth(), acquired.texture.GetHeight(), 1};
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

bool Presentation::Prepare(Napi::Env env) {
  int width = 0;
  int height = 0;
  glfwGetFramebufferSize(window_.get(), &width, &height);
  // X11 can retain nonzero framebuffer dimensions while iconified.
  if(glfwGetWindowAttrib(window_.get(), GLFW_ICONIFIED) || width <= 0 || height <= 0) {
    Abort();
    return false;
  }
  if(static_cast<uint32_t>(width) > max_dimension_ || static_cast<uint32_t>(height) > max_dimension_) {
    Abort();
    throw Napi::Error::New(env, "Window framebuffer exceeds device maxTextureDimension2D");
  }
  if(reconfigure_ || configuration_.width != static_cast<uint32_t>(width) ||
     configuration_.height != static_cast<uint32_t>(height)) {
    Abort();
  }
  if(!configured_) {
    configuration_.width = width;
    configuration_.height = height;
    surface_.Configure(&configuration_);
    configured_ = true;
    reconfigure_ = false;
  }
  return true;
}

wgpu::SurfaceTexture Presentation::Acquire(Napi::Env env) {
  return AcquireSurfaceTexture(
      [&] { return Prepare(env); },
      [&] {
        wgpu::SurfaceTexture acquired;
        surface_.GetCurrentTexture(&acquired);
        if(DeviceLost()) {
          if(acquired.texture) acquired.texture.Destroy();
          acquired.texture = nullptr;
          Abort();
          throw Napi::Error::New(env, "GPU device is lost or destroyed");
        }
        return acquired;
      },
      [&](bool recreate) {
        Abort();
        if(recreate) {
          // Retain the old surface if recreation fails so disposal still drains its GPU work.
          auto replacement = wgpu::glfw::CreateSurfaceForWindow(instance_, window_.get());
          if(!replacement) throw Napi::Error::New(env, "Dawn surface recreation failed");
          surface_ = std::move(replacement);
        }
      });
}

bool Presentation::ShouldClose() const { return glfwWindowShouldClose(window_.get()); }
void Presentation::RequestClose() { glfwSetWindowShouldClose(window_.get(), GLFW_TRUE); }
const char* Presentation::PresentMode() const { return PresentModeName(configuration_.presentMode); }

bool Presentation::DeviceLost() const {
  return instance_.WaitAny(device_.GetLostFuture(), 0) == wgpu::WaitStatus::Success;
}

void Presentation::Abort() {
  if(configured_) surface_.Unconfigure();
  configured_ = false;
}
}
