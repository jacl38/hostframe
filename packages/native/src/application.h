#pragma once

#include <memory>
#include <vector>

#include "src/dawn/node/interop/NodeAPI.h"

namespace hostframe {
class GlfwSession;
class WindowState;

void RequireMainThread(Napi::Env env);

// Native ownership outlives an individual JS wrapper during render dispatch.
// Windows refer back weakly; there is no application/window reference cycle.
class ApplicationState {
 public:
  ApplicationState();
  ~ApplicationState();
  void RequireAvailable(Napi::Env env) const;
  void Register(std::shared_ptr<WindowState> window);
  void Unregister(WindowState* window);
  bool Close();
  bool HasOpenWindows() const;
  bool IsDisposed() const { return !session_; }
  bool executing = false;

 private:
  std::unique_ptr<GlfwSession> session_;
  std::vector<std::shared_ptr<WindowState>> windows_;
};

struct ApplicationOperation {
  bool& active;
  explicit ApplicationOperation(ApplicationState& application) : active(application.executing) { active = true; }
  ~ApplicationOperation() { active = false; }
};

}
