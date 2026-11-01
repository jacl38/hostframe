#pragma once

#include <stdexcept>

#include <webgpu/webgpu_cpp.h>

namespace ts_dawn {
// Keep recovery bounded and release any unusable texture before reconfiguration.
// Callers provide native operations; the same sequence can be tested without a compositor race.
template <typename Prepare, typename Acquire, typename Recover>
auto AcquireSurfaceTexture(Prepare prepare, Acquire acquire, Recover recover) {
  using Frame = decltype(acquire());
  using Status = wgpu::SurfaceGetCurrentTextureStatus;
  for(int attempt = 0; attempt < 2; ++attempt) {
    if(!prepare()) return Frame{};
    auto frame = acquire();
    if((frame.status == Status::SuccessOptimal || frame.status == Status::SuccessSuboptimal) && frame.texture) {
      return frame;
    }
    if(frame.texture) frame.texture.Destroy();
    frame.texture = nullptr;
    recover(frame.status == Status::Lost);
    switch(frame.status) {
      case Status::Outdated:
      case Status::Lost:
        break;
      case Status::Timeout:
        return Frame{};
      default:
        throw std::runtime_error("Surface texture acquisition failed");
    }
  }
  return Frame{};
}
}
