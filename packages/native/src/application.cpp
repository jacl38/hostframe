#include "application.h"

#include <algorithm>
#include <stdexcept>
#include <sys/syscall.h>
#include <unistd.h>

#include <GLFW/glfw3.h>

#include "window.h"

namespace ts_dawn {

void RequireMainThread(Napi::Env env) {
  // This target is Linux-only. A worker cannot become GLFW's main thread.
  if(syscall(SYS_gettid) != getpid()) {
    throw Napi::Error::New(env, "Native applications require the process main thread");
  }
}

class GlfwSession {
 public:
  GlfwSession() {
    if(active_) throw std::runtime_error("Only one native application is supported in this increment");
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

namespace {
class Application final : public Napi::ObjectWrap<Application> {
 public:
  static void Initialize(Napi::Env env, Napi::Object exports) {
    exports.Set("Application", DefineClass(env, "Application", {
      InstanceMethod("createWindow", &Application::CreateWindow),
      InstanceMethod("pollEvents", &Application::PollEvents),
      InstanceAccessor("hasOpenWindows", &Application::HasOpenWindows, nullptr),
      InstanceAccessor("disposed", &Application::Disposed, nullptr),
      InstanceMethod("dispose", &Application::Dispose)
    }));
  }

  explicit Application(const Napi::CallbackInfo& info) : Napi::ObjectWrap<Application>(info) {
    try {
      RequireMainThread(info.Env());
      state_ = std::make_shared<ApplicationState>();
      windowConstructor_ = Napi::Persistent(DefineWindow(info.Env()));
      if(napi_add_env_cleanup_hook(info.Env(), Cleanup, this) != napi_ok) {
        throw Napi::Error::New(info.Env(), "Could not register application cleanup");
      }
      cleanupRegistered_ = true;
    } catch(const Napi::Error& error) {
      state_.reset();
      error.ThrowAsJavaScriptException();
    } catch(const std::exception& error) {
      state_.reset();
      Napi::Error::New(info.Env(), error.what()).ThrowAsJavaScriptException();
    }
  }

  ~Application() override {
    if(cleanupRegistered_) napi_remove_env_cleanup_hook(Env(), Cleanup, this);
  }

 private:
  static void Cleanup(void* data) {
    // Before JS finalizers: close surfaces and windows while devices are retained,
    // then terminate GLFW. Window wrappers can safely outlive this operation.
    auto* application = static_cast<Application*>(data);
    application->state_->Close();
    application->cleanupRegistered_ = false;
  }

  Napi::Value CreateWindow(const Napi::CallbackInfo& info) {
    try {
      RequireMainThread(info.Env());
      state_->RequireAvailable(info.Env());
      if(state_->HasWindow()) throw Napi::Error::New(info.Env(), "Only one native window is supported in this increment");
      ApplicationOperation operation(*state_);
      bool vsync = true;
      if(!info[1].IsUndefined()) {
        if(!info[1].IsObject() || info[1].IsNull() || info[1].IsArray() || info[1].IsFunction()) {
          throw Napi::TypeError::New(info.Env(), "Expected window options object");
        }
        auto value = info[1].As<Napi::Object>().Get("vsync");
        if(info.Env().IsExceptionPending()) return info.Env().Undefined();
        if(!value.IsUndefined()) {
          if(!value.IsBoolean()) throw Napi::TypeError::New(info.Env(), "vsync must be a boolean");
          vsync = value.As<Napi::Boolean>().Value();
        }
      }
      auto window = std::make_shared<WindowState>(info.Env(), info[0], state_, vsync);
      // The external is private to this synchronous constructor call and is copied
      // by the wrapper. Neither a raw window nor its constructor is exported.
      auto result = windowConstructor_.New({Napi::External<std::shared_ptr<WindowState>>::New(info.Env(), &window)});
      if(info.Env().IsExceptionPending()) return info.Env().Undefined();
      state_->Register(window);
      return result;
    } catch(const Napi::Error& error) {
      error.ThrowAsJavaScriptException();
    } catch(const std::exception& error) {
      Napi::Error::New(info.Env(), error.what()).ThrowAsJavaScriptException();
    }
    return info.Env().Undefined();
  }

  Napi::Value Dispose(const Napi::CallbackInfo& info) {
    try {
      RequireMainThread(info.Env());
      if(state_->executing) throw Napi::Error::New(info.Env(), "An application operation is already in progress");
      ApplicationOperation operation(*state_);
      if(!state_->Close()) throw Napi::Error::New(info.Env(), "GPU cleanup timed out; device was destroyed");
    } catch(const Napi::Error& error) {
      error.ThrowAsJavaScriptException();
    }
    return info.Env().Undefined();
  }

  Napi::Value PollEvents(const Napi::CallbackInfo& info) {
    try {
      RequireMainThread(info.Env());
      state_->RequireAvailable(info.Env());
      ApplicationOperation operation(*state_);
      glfwPollEvents();
      return Napi::Boolean::New(info.Env(), state_->HasOpenWindows());
    } catch(const Napi::Error& error) {
      error.ThrowAsJavaScriptException();
    }
    return info.Env().Undefined();
  }

  Napi::Value HasOpenWindows(const Napi::CallbackInfo& info) {
    try {
      RequireMainThread(info.Env());
      if(!state_->IsDisposed()) state_->RequireAvailable(info.Env());
      return Napi::Boolean::New(info.Env(), state_->HasOpenWindows());
    } catch(const Napi::Error& error) {
      error.ThrowAsJavaScriptException();
    }
    return info.Env().Undefined();
  }

  Napi::Value Disposed(const Napi::CallbackInfo& info) {
    try {
      RequireMainThread(info.Env());
      return Napi::Boolean::New(info.Env(), state_->IsDisposed());
    } catch(const Napi::Error& error) {
      error.ThrowAsJavaScriptException();
    }
    return info.Env().Undefined();
  }

  std::shared_ptr<ApplicationState> state_;
  Napi::FunctionReference windowConstructor_;
  bool cleanupRegistered_ = false;
};
}

void InitializeApplication(Napi::Env env, Napi::Object exports) {
  Application::Initialize(env, exports);
}
}
