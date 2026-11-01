#include "nobind_runtime.h"
#include <napi.h>
#include <map>
#include <memory>
#include <mutex>

namespace ts_dawn {
namespace {
std::mutex environmentsMutex;
std::map<napi_env, void*> environments;
struct EnvironmentCleanup {
  napi_env env;
  void* data;
  void (*dispose)(void*);
};
}

void* NobindData(napi_env env) {
  std::lock_guard lock(environmentsMutex);
  auto entry = environments.find(env);
  return entry == environments.end() ? nullptr : entry->second;
}

void InstallNobindData(napi_env env, void* data, void (*dispose)(void*)) {
  auto cleanup = std::make_unique<EnvironmentCleanup>(env, data, dispose);
  {
    std::lock_guard lock(environmentsMutex);
    environments.emplace(env, data);
  }
  auto status = napi_add_env_cleanup_hook(env, [](void* raw) {
    std::unique_ptr<EnvironmentCleanup> cleanup(static_cast<EnvironmentCleanup*>(raw));
    {
      std::lock_guard lock(environmentsMutex);
      environments.erase(cleanup->env);
    }
    cleanup->dispose(cleanup->data);
  }, cleanup.get());
  if(status != napi_ok) {
    std::lock_guard lock(environmentsMutex);
    environments.erase(env);
    dispose(data);
    throw Napi::Error::New(env, "Could not register nobind cleanup");
  }
  cleanup.release();
}

}
