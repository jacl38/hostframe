#include <atomic>
#include <chrono>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <thread>
#include <utility>

#define GLFW_INCLUDE_NONE
#include <GLFW/glfw3.h>
#include <webgpu/webgpu_cpp.h>
#include <webgpu/webgpu_glfw.h>

namespace {

std::atomic_bool validationFailed{false};

class GlfwSession {
 public:
  GlfwSession() {
    if(!glfwInit()) throw std::runtime_error("GLFW initialization failed; check DISPLAY.");
  }
  ~GlfwSession() { glfwTerminate(); }
  GlfwSession(const GlfwSession&) = delete;
  GlfwSession& operator=(const GlfwSession&) = delete;
};

template <typename Predicate>
void ProgressUntil(const wgpu::Instance& instance, Predicate complete) {
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
  while(!complete()) {
    if(std::chrono::steady_clock::now() >= deadline) {
      throw std::runtime_error("GPU initialization timed out.");
    }
    instance.ProcessEvents();
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
}

void CheckPresentation() {
  GlfwSession session;
  glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API);
  std::unique_ptr<GLFWwindow, decltype(&glfwDestroyWindow)> window(
      glfwCreateWindow(320, 240, "ts-dawn presentation check", nullptr, nullptr), glfwDestroyWindow);
  if(!window) throw std::runtime_error("GLFW window creation failed.");

  auto instance = wgpu::CreateInstance();
  if(!instance) throw std::runtime_error("Dawn instance creation failed.");
  auto surface = wgpu::glfw::CreateSurfaceForWindow(instance, window.get());
  if(!surface) throw std::runtime_error("Dawn surface creation failed.");
  struct AdapterRequest {
    wgpu::Adapter adapter;
    bool done = false;
  };
  auto adapterRequest = std::make_shared<AdapterRequest>();
  wgpu::RequestAdapterOptions options;
  options.backendType = wgpu::BackendType::Vulkan;
  options.compatibleSurface = surface;
  instance.RequestAdapter(&options, wgpu::CallbackMode::AllowProcessEvents,
      [adapterRequest](wgpu::RequestAdapterStatus status, wgpu::Adapter result, wgpu::StringView) {
        if(status == wgpu::RequestAdapterStatus::Success) adapterRequest->adapter = std::move(result);
        adapterRequest->done = true;
      });
  ProgressUntil(instance, [&] { return adapterRequest->done; });
  auto adapter = adapterRequest->adapter;
  if(!adapter) throw std::runtime_error("No Vulkan adapter supports this surface.");

  struct DeviceRequest {
    wgpu::Device device;
    bool done = false;
  };
  auto deviceRequest = std::make_shared<DeviceRequest>();
  wgpu::DeviceDescriptor deviceDescriptor;
  deviceDescriptor.SetUncapturedErrorCallback(
      [](const wgpu::Device&, wgpu::ErrorType, wgpu::StringView) {
        validationFailed.store(true);
      });
  adapter.RequestDevice(&deviceDescriptor, wgpu::CallbackMode::AllowProcessEvents,
      [deviceRequest](wgpu::RequestDeviceStatus status, wgpu::Device result, wgpu::StringView) {
        if(status == wgpu::RequestDeviceStatus::Success) deviceRequest->device = std::move(result);
        deviceRequest->done = true;
      });
  ProgressUntil(instance, [&] { return deviceRequest->done; });
  auto device = deviceRequest->device;
  if(!device) throw std::runtime_error("Device creation failed.");

  wgpu::SurfaceCapabilities capabilities;
  if(surface.GetCapabilities(adapter, &capabilities) != wgpu::Status::Success || capabilities.formatCount == 0 || capabilities.alphaModeCount == 0) {
    throw std::runtime_error("Surface capabilities unavailable.");
  }
  wgpu::SurfaceConfiguration configuration;
  configuration.device = device;
  configuration.format = capabilities.formats[0];
  configuration.width = 320;
  configuration.height = 240;
  configuration.presentMode = wgpu::PresentMode::Fifo;
  configuration.alphaMode = capabilities.alphaModes[0];
  surface.Configure(&configuration);

  try {
    for(int frame = 0; frame < 60; ++frame) {
      glfwPollEvents();
      wgpu::SurfaceTexture acquired;
      surface.GetCurrentTexture(&acquired);
      if((acquired.status != wgpu::SurfaceGetCurrentTextureStatus::SuccessOptimal &&
          acquired.status != wgpu::SurfaceGetCurrentTextureStatus::SuccessSuboptimal) || !acquired.texture) {
        throw std::runtime_error("Surface texture acquisition failed.");
      }
      wgpu::RenderPassColorAttachment color;
      color.view = acquired.texture.CreateView();
      color.loadOp = wgpu::LoadOp::Clear;
      color.storeOp = wgpu::StoreOp::Store;
      color.clearValue = {0.05, 0.1, 0.2, 1.0};
      wgpu::RenderPassDescriptor descriptor;
      descriptor.colorAttachmentCount = 1;
      descriptor.colorAttachments = &color;
      auto encoder = device.CreateCommandEncoder();
      auto pass = encoder.BeginRenderPass(&descriptor);
      pass.End();
      auto commands = encoder.Finish();
      device.GetQueue().Submit(1, &commands);
      if(surface.Present() != wgpu::Status::Success) throw std::runtime_error("Presentation failed.");
      instance.ProcessEvents();
      std::this_thread::sleep_for(std::chrono::milliseconds(16));
    }
    if(validationFailed.load()) throw std::runtime_error("GPU validation error during presentation.");
  } catch(...) {
    surface.Unconfigure();
    device.Destroy();
    throw;
  }
  surface.Unconfigure();
  device.Destroy();
  instance.ProcessEvents();
  // Surface and GPU references are released before their GLFW window and session.
  std::cout << "GLFW/X11/Vulkan: 60 frames acquired, rendered, and presented.\n";
}

}  // namespace

int main() {
  try {
    CheckPresentation();
    return 0;
  } catch(const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
