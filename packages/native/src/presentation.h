#pragma once

#include <memory>
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
  bool HasDevice() const { return static_cast<bool>(device_); }
  Napi::Value Configure(Napi::Env env, Napi::Value configuration);
  void Unconfigure();

 private:
  bool DeviceLost() const;
  bool Prepare(Napi::Env env);
  wgpu::SurfaceTexture Acquire(Napi::Env env);
  void Abort();
  bool Drain();
  void ConfigureDevice(wgpu::Device device, wgpu::SurfaceConfiguration configuration);

  std::unique_ptr<GLFWwindow, decltype(&glfwDestroyWindow)> window_{nullptr, glfwDestroyWindow};
  wgpu::Device device_;
  wgpu::Instance instance_;
  wgpu::Surface surface_;
  wgpu::SurfaceConfiguration configuration_;
  uint32_t max_dimension_ = 0;
  bool configured_ = false;
  bool reconfigure_ = false;
  bool vsync_ = true;
  std::vector<wgpu::TextureFormat> view_formats_;
};
}
