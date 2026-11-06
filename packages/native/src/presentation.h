#pragma once

#include <functional>
#include <memory>
#include <optional>
#include <vector>

#include <GLFW/glfw3.h>
#include <webgpu/webgpu_cpp.h>

#include "src/dawn/node/interop/NodeAPI.h"
#include "window_options.h"

namespace hostframe {
// Members release in reverse order: surface/device before the native window.
// The application's GLFW session outlives all presentation resources.
class Presentation {
 public:
  Presentation(wgpu::Instance instance, const WindowOptions& options);
  ~Presentation();
  bool Close();
  void RenderFrame(Napi::Env env, Napi::Function callback);
  GLFWwindow* NativeWindow() const { return window_.get(); }
  bool ShouldClose() const;
  void RequestClose();
  const char* PresentMode() const;
  wgpu::Surface Surface() const { return surface_; }
  bool HasContextConfiguration() const { return context_.has_value(); }
  Napi::Value Configure(Napi::Env env, Napi::Value configuration);
  void Unconfigure();

 private:
  bool DeviceLost() const;
  bool PrepareSurface(Napi::Env env);
  wgpu::SurfaceTexture Acquire(Napi::Env env);
  void DeactivateSurface();
  bool DrainDevice();
  void ReplaceContextConfiguration(wgpu::Device device, wgpu::SurfaceConfiguration configuration);

  std::unique_ptr<GLFWwindow, decltype(&glfwDestroyWindow)> window_{nullptr, glfwDestroyWindow};
  wgpu::Instance instance_;
  wgpu::Surface surface_;

  // Exists from successful context.configure until unconfigure/close, including
  // while minimized, recovering, or device-lost. The descriptor is the sole
  // explicit native device retain; its viewFormats pointer borrows this vector's storage.
  struct ContextConfiguration {
    wgpu::SurfaceConfiguration descriptor;
    std::vector<wgpu::TextureFormat> view_formats;
    uint32_t max_dimension = 0;
    // WindowState retains the binding through cleanup; this callback borrows it.
    std::function<void()> destroy_device;
  };
  std::optional<ContextConfiguration> context_;

  // Surface configuration is lazy and independent of context configuration.
  // RefreshPending keeps the surface configured through this frame; the next
  // acquisition deactivates it after the frame expires.
  enum class SurfaceConfigurationState { Unconfigured, Current, RefreshPending };
  SurfaceConfigurationState surface_configuration_ = SurfaceConfigurationState::Unconfigured;
  bool vsync_ = true;
};
}
