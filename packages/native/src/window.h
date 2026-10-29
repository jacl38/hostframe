#pragma once

#include "src/dawn/node/interop/NodeAPI.h"

namespace ts_dawn {
void InitializeWindow(Napi::Env env, Napi::Object exports);
}
