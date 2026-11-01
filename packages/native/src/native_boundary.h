#pragma once

#include "src/dawn/node/interop/NodeAPI.h"

namespace ts_dawn {
// Never transport a node-addon-api C++ exception across the Dawn/nobind ABI
// boundary. Keep the actual JS exception pending, including arbitrary thrown values.
template <class Function> auto NativeBoundary(napi_env raw, Function&& function) {
  using Result = decltype(function());
  Napi::Env env(raw);
  try {
    return function();
  } catch(const Napi::Error& error) {
    error.ThrowAsJavaScriptException();
  } catch(const std::exception& error) {
    Napi::Error::New(env, error.what()).ThrowAsJavaScriptException();
  }
  if constexpr(!std::is_void_v<Result>) return Result{};
}
}
