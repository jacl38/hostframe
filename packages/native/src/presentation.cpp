#include "presentation.h"

#include <chrono>
#ifdef HOSTFRAME_TEST_CLEANUP_TIMEOUT
#include <cstdlib>
#endif
#include <stdexcept>
#include <thread>

#include <webgpu/webgpu_glfw.h>

#include "src/dawn/node/binding/GPUTexture.h"
#include "src/dawn/node/binding/GPUDevice.h"
#include "src/dawn/node/binding/Converter.h"
#include "present_mode.h"
#include "surface_acquisition.h"

namespace hostframe {
Presentation::Presentation(wgpu::Instance instance, const WindowOptions& options) : instance_(std::move(instance)), vsync_(options.vsync) {
  glfwDefaultWindowHints();
  glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API);
  glfwWindowHint(GLFW_RESIZABLE, options.resizable ? GLFW_TRUE : GLFW_FALSE);
  window_.reset(glfwCreateWindow(options.width, options.height, options.title.c_str(), nullptr, nullptr));
  if(!window_) throw std::runtime_error("GLFW window creation failed");
  surface_ = wgpu::glfw::CreateSurfaceForWindow(instance_, window_.get());
  if(!surface_) throw std::runtime_error("Dawn surface creation failed");
}

void Presentation::ConfigureDevice(wgpu::Device device, wgpu::SurfaceConfiguration configuration) {
  if(device.GetAdapter().GetInstance().Get() != instance_.Get()) {
    throw std::runtime_error("Device must belong to this surface's GPU instance");
  }
  if(instance_.WaitAny(device.GetLostFuture(), 0) == wgpu::WaitStatus::Success) {
    throw std::runtime_error("GPU device is lost or destroyed");
  }
  wgpu::SurfaceCapabilities capabilities;
  if(surface_.GetCapabilities(device.GetAdapter(), &capabilities) != wgpu::Status::Success ||
     capabilities.formatCount == 0 || capabilities.alphaModeCount == 0) {
    throw std::runtime_error("Device adapter cannot present to this window");
  }
  if(std::find(capabilities.formats, capabilities.formats + capabilities.formatCount, configuration.format) ==
     capabilities.formats + capabilities.formatCount) throw std::runtime_error("Unsupported surface format");
  if(std::find(capabilities.alphaModes, capabilities.alphaModes + capabilities.alphaModeCount, configuration.alphaMode) ==
     capabilities.alphaModes + capabilities.alphaModeCount) throw std::runtime_error("Unsupported surface alphaMode");
  if(configuration.usage == wgpu::TextureUsage::None || (configuration.usage & capabilities.usages) != configuration.usage) {
    throw std::runtime_error("Unsupported surface usage");
  }
  configuration.presentMode = SelectPresentMode({capabilities.presentModes, capabilities.presentModeCount}, vsync_);
  wgpu::Limits limits;
  if(device.GetLimits(&limits) != wgpu::Status::Success) throw std::runtime_error("Device limits unavailable");
  // Validate everything before replacing an existing configuration.
  Unconfigure();
  device_ = std::move(device);
  configuration.device = device_;
  configuration_ = configuration;
  max_dimension_ = limits.maxTextureDimension2D;
}

Napi::Value Presentation::Configure(Napi::Env env, Napi::Value value) {
  if(!value.IsObject() || value.IsNull() || value.IsArray() || value.IsFunction()) {
    throw Napi::TypeError::New(env, "Expected a canvas configuration object");
  }
  wgpu::interop::GPUCanvasConfiguration descriptor;
  auto result = wgpu::interop::FromJS(env, value, descriptor);
  if(!result) {
    if(!env.IsExceptionPending()) throw Napi::TypeError::New(env, result.error);
    return env.Undefined();
  }
  if(env.IsExceptionPending()) return env.Undefined();
  if(descriptor.colorSpace != wgpu::interop::PredefinedColorSpace::kSrgb ||
     descriptor.toneMapping.mode != wgpu::interop::GPUCanvasToneMappingMode::kStandard) {
    throw Napi::TypeError::New(env, "Only srgb colorSpace and standard toneMapping are supported");
  }
  wgpu::binding::Converter convert(env);
  auto* binding = dynamic_cast<wgpu::binding::GPUDevice*>(*descriptor.device);
  if(!binding) throw Napi::TypeError::New(env, "Expected a Dawn GPUDevice");
  auto device = binding->GetNativeDevice();
  wgpu::SurfaceConfiguration configuration;
  std::vector<wgpu::TextureFormat> formats;
  if(!convert(configuration.format, descriptor.format) ||
     !convert(configuration.usage, descriptor.usage)) return env.Undefined();
  for(auto format : descriptor.viewFormats) {
    wgpu::TextureFormat nativeFormat;
    if(!convert(nativeFormat, format)) return env.Undefined();
    auto base = [](wgpu::TextureFormat format) {
      if(format == wgpu::TextureFormat::RGBA8UnormSrgb) return wgpu::TextureFormat::RGBA8Unorm;
      if(format == wgpu::TextureFormat::BGRA8UnormSrgb) return wgpu::TextureFormat::BGRA8Unorm;
      return format;
    };
    if(base(nativeFormat) != base(configuration.format)) throw Napi::TypeError::New(env, "Incompatible surface viewFormat");
    formats.push_back(nativeFormat);
  }
  configuration.alphaMode = descriptor.alphaMode == wgpu::interop::GPUCanvasAlphaMode::kOpaque
      ? wgpu::CompositeAlphaMode::Opaque : wgpu::CompositeAlphaMode::Premultiplied;
  auto normalized = wgpu::interop::ToJS(env, descriptor);
  if(env.IsExceptionPending()) return env.Undefined();
  ConfigureDevice(std::move(device), configuration);
  // WindowState retains the JS binding through cleanup. Use its destruction
  // entry point on timeout so its finalizer agrees with the native device state.
  destroy_device_ = [binding, env] { binding->destroy(env); };
  view_formats_ = std::move(formats);
  configuration_.viewFormatCount = view_formats_.size();
  configuration_.viewFormats = view_formats_.data();
  return normalized;
}

void Presentation::Unconfigure() {
  Abort();
  const bool drained = Drain();
  configuration_ = {};
  view_formats_.clear();
  device_ = nullptr;
  destroy_device_ = {};
  if(!drained) throw std::runtime_error("GPU cleanup timed out; device was destroyed");
}

Presentation::~Presentation() { Close(); }

bool Presentation::Close() {
  if(!surface_) return true;
  Abort();
  surface_ = nullptr;
  return Drain();
}

bool Presentation::Drain() {
  if(!device_) return true;
  // Vulkan defers swapchain deletion to a queue serial. Complete that work
  // before GLFW closes the X11 connection used by the swapchain's deleter.
  if(!DeviceLost()) {
    auto queue = device_.GetQueue();
    auto commands = device_.CreateCommandEncoder().Finish();
    queue.Submit(1, &commands);
  }
  // Only test builds can replace progress/deadline observations. Consume once
  // per process, after real submission, so retries exercise ordinary cleanup.
  bool forceTimeout = false;
#ifdef HOSTFRAME_TEST_CLEANUP_TIMEOUT
  static bool injected = false;
  if(!injected && std::getenv("HOSTFRAME_TEST_STALL_CLEANUP")) {
    injected = true;
    forceTimeout = true;
  }
#endif
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
  // A work-done future advances user-visible completion only. DeviceTick also
  // runs Dawn's best-effort deletion processors before reporting the device idle.
  while(dawn::native::DeviceTick(device_.Get()) || forceTimeout) {
    if(forceTimeout || std::chrono::steady_clock::now() >= deadline) {
      // A stalled device must release its swapchains before its display dies.
      destroy_device_();
      return false;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  return true;
}

void Presentation::RenderFrame(Napi::Env env, Napi::Function callback) {
  if(!device_) throw Napi::Error::New(env, "Context is not configured");
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
      throw Napi::TypeError::New(env, "frame callback must return undefined synchronously");
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
const char* Presentation::PresentMode() const {
  if(!device_) throw std::runtime_error("Context is not configured");
  return PresentModeName(configuration_.presentMode);
}

bool Presentation::DeviceLost() const {
  return instance_.WaitAny(device_.GetLostFuture(), 0) == wgpu::WaitStatus::Success;
}

void Presentation::Abort() {
  if(configured_) surface_.Unconfigure();
  configured_ = false;
}
}
