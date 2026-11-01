// Copyright 2021 The Dawn & Tint Authors
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
// 1. Redistributions of source code must retain the above copyright notice, this
//    list of conditions and the following disclaimer.
//
// 2. Redistributions in binary form must reproduce the above copyright notice,
//    this list of conditions and the following disclaimer in the documentation
//    and/or other materials provided with the distribution.
//
// 3. Neither the name of the copyright holder nor the names of its
//    contributors may be used to endorse or promote products derived from
//    this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
// DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
// FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
// DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
// SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
// CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
// OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

#include "binding_types.h"
#include "native_boundary.h"
#include "src/dawn/node/binding/Flags.h"
#include "src/dawn/node/binding/GPU.h"

namespace ts_dawn {
DawnGPU CreateGPU(napi_env raw, std::vector<std::string> arguments) {
  Napi::Env env(raw);
  return NativeBoundary(raw, [&]() -> DawnGPU {
    wgpu::binding::Flags flags;
    for(const auto& argument : arguments) {
      const auto separator = argument.find('=');
      if(separator == std::string::npos) {
        Napi::TypeError::New(env, "GPU flags must have key=value form")
            .ThrowAsJavaScriptException();
        return {};
      }
      flags.Set(argument.substr(0, separator), argument.substr(separator + 1));
    }
    return {wgpu::interop::GPU::Create<wgpu::binding::GPU>(env, std::move(flags))};
  });
}

DawnGlobals InitializeDawn(napi_env raw) {
  return NativeBoundary(raw, [&]() -> DawnGlobals {
    return {wgpu::interop::Initialize(Napi::Env(raw))};
  });
}
}
