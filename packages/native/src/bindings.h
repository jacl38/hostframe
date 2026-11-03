#pragma once

#include <memory>
#include "binding_types.h"

namespace hostframe {
class ApplicationState;
class WindowState;
class Window;

template <class Owner, auto Method> struct Computed {
  Owner* owner;
  auto Get() const { return (owner->*Method)(); }
};

class Application {
 public:
  explicit Application(napi_env env);
  ~Application();
  Application(const Application&) = delete;
  Application& operator=(const Application&) = delete;
  Window* CreateWindow(DawnDevice device, WindowOptionsArgument options);
  bool PollEvents();
  bool HasOpenWindows();
  bool Disposed();
  void Dispose();
  Computed<Application, &Application::HasOpenWindows> hasOpenWindows{this};
  Computed<Application, &Application::Disposed> disposed{this};

 private:
  static void Cleanup(void* data);
  napi_env env_;
  std::shared_ptr<ApplicationState> state_;
  bool cleanupRegistered_ = false;
};

class Window {
 public:
  Window(napi_env env, std::shared_ptr<WindowState> state) : env_(env), state_(std::move(state)) {}
  bool Disposed();
  bool ShouldClose();
  PresentMode GetPresentMode();
  void Draw(DrawCallback callback);
  void DispatchInput(InputCallback callback);
  InputState SetPointerCapture(bool captured, bool rawMotion);
  InputState RequestClose();
  void Dispose();
  Computed<Window, &Window::Disposed> disposed{this};
  Computed<Window, &Window::ShouldClose> shouldClose{this};
  Computed<Window, &Window::GetPresentMode> presentMode{this};

 private:
  std::shared_ptr<ApplicationState> RequireAvailable();
  napi_env env_;
  std::shared_ptr<WindowState> state_;
};
}
