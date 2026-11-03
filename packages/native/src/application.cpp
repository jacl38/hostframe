#include "application.h"

#include <algorithm>
#include <stdexcept>
#if defined(__APPLE__)
#include <pthread.h>
#else
#include <sys/syscall.h>
#endif
#include <unistd.h>

#include <GLFW/glfw3.h>
#if !defined(__APPLE__)
#define GLFW_EXPOSE_NATIVE_X11
#include <GLFW/glfw3native.h>
#include <X11/extensions/Xfixes.h>
#endif

#include "window.h"
#include "bindings.h"
#include "native_boundary.h"

namespace hostframe {

void RequireMainThread(Napi::Env env) {
#if defined(__APPLE__)
  const bool mainThread = pthread_main_np() != 0;
#else
  const bool mainThread = syscall(SYS_gettid) == getpid();
#endif
  if(!mainThread) {
    throw Napi::Error::New(env, "Native applications require the process main thread");
  }
}

class GlfwSession {
 public:
  GlfwSession() {
    if(active_) throw std::runtime_error("Only one native application is supported in this increment");
    if(!glfwInit()) {
      glfwTerminate();
      throw std::runtime_error("GLFW initialization failed; check desktop session");
    }
#if !defined(__APPLE__)
    // Mesa's Vulkan WSI caches extension data by xcb_connection_t address for
    // the instance lifetime. A new GLFW session can reuse a closed connection's
    // address while our process GPU is still alive, skipping XFixes negotiation.
    // Negotiate on every new connection before WSI can create regions on it.
    int major = 0;
    int minor = 0;
    XFixesQueryVersion(glfwGetX11Display(), &major, &minor);
#endif
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

ApplicationState::ApplicationState() : session_(std::make_unique<GlfwSession>()) {}
ApplicationState::~ApplicationState() { Close(); }

void ApplicationState::RequireAvailable(Napi::Env env) const {
  if(!session_) throw Napi::Error::New(env, "Application is disposed");
  if(executing) throw Napi::Error::New(env, "An application operation is already in progress");
}

void ApplicationState::Register(std::shared_ptr<WindowState> window) {
  windows_.push_back(std::move(window));
}

void ApplicationState::Unregister(WindowState* window) {
  std::erase_if(windows_, [window](const auto& entry) { return entry.get() == window; });
}

bool ApplicationState::HasOpenWindows() const {
  return session_ && std::any_of(windows_.begin(), windows_.end(), [](const auto& window) {
    return !window->ShouldClose();
  });
}

bool ApplicationState::Close() {
  bool drained = true;
  // Detach first: window cleanup may unregister itself, including during teardown.
  auto windows = std::move(windows_);
  windows_.clear();
  for(const auto& window : windows) drained = window->Close() && drained;
  session_.reset();
  return drained;
}

Application::Application(napi_env env) : env_(env) {
  NativeBoundary(env_, [&] {
    RequireMainThread(env_);
    state_ = std::make_shared<ApplicationState>();
    if(napi_add_env_cleanup_hook(env_, Cleanup, this) != napi_ok) {
      state_.reset();
      throw Napi::Error::New(env_, "Could not register application cleanup");
    }
    cleanupRegistered_ = true;
  });
}

Application::~Application() {
  if(cleanupRegistered_) napi_remove_env_cleanup_hook(env_, Cleanup, this);
}

void Application::Cleanup(void* data) {
  auto* application = static_cast<Application*>(data);
  application->state_->Close();
  application->cleanupRegistered_ = false;
}

Window* Application::CreateWindow(DawnDevice device, WindowOptionsArgument argument) {
  return NativeBoundary(env_, [&]() -> Window* {
    Napi::Env env(env_);
    RequireMainThread(env);
    state_->RequireAvailable(env);
    if(state_->HasWindow()) throw Napi::Error::New(env, "Only one native window is supported in this increment");
    ApplicationOperation operation(*state_);
    auto options = DecodeWindowOptions(argument);
    if(env.IsExceptionPending()) return nullptr;
    auto state = std::make_shared<WindowState>(env, Napi::Value(env, device.value), state_, options);
    auto window = std::make_unique<Window>(env, state);
    state_->Register(state);
    return window.release();
  });
}

void Application::Dispose() {
  NativeBoundary(env_, [&] {
    RequireMainThread(env_);
    if(state_->executing) throw Napi::Error::New(env_, "An application operation is already in progress");
    ApplicationOperation operation(*state_);
    if(!state_->Close()) throw Napi::Error::New(env_, "GPU cleanup timed out; device was destroyed");
  });
}

bool Application::PollEvents() {
  return NativeBoundary(env_, [&] {
    RequireMainThread(env_);
    state_->RequireAvailable(env_);
    ApplicationOperation operation(*state_);
    glfwPollEvents();
    return state_->HasOpenWindows();
  });
}

bool Application::HasOpenWindows() {
  return NativeBoundary(env_, [&] {
    RequireMainThread(env_);
    if(!state_->IsDisposed()) state_->RequireAvailable(env_);
    return state_->HasOpenWindows();
  });
}

bool Application::Disposed() {
  return NativeBoundary(env_, [&] {
    RequireMainThread(env_);
    return state_->IsDisposed();
  });
}
}
