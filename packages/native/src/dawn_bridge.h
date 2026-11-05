#pragma once

#include "src/dawn/node/binding/GPU.h"

namespace hostframe {
wgpu::binding::GPU& RequireGPU(Napi::Env env, Napi::Value value);
}
