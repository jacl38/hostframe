#pragma once

#include <algorithm>
#include <span>
#include <stdexcept>

#include <webgpu/webgpu_cpp.h>

namespace hostframe {

// Only choose advertised modes: an unsupported request must not silently become FIFO.
inline wgpu::PresentMode SelectPresentMode(std::span<const wgpu::PresentMode> modes, bool vsync) {
  auto supports = [&](wgpu::PresentMode mode) {
    return std::find(modes.begin(), modes.end(), mode) != modes.end();
  };
  if(vsync) {
    if(supports(wgpu::PresentMode::Fifo)) return wgpu::PresentMode::Fifo;
    throw std::runtime_error("vsync: true requires FIFO presentation, which this surface does not support");
  }
  if(supports(wgpu::PresentMode::Immediate)) return wgpu::PresentMode::Immediate;
  if(supports(wgpu::PresentMode::Mailbox)) return wgpu::PresentMode::Mailbox;
  throw std::runtime_error("vsync: false requires Immediate or Mailbox presentation, which this surface does not support");
}

inline const char* PresentModeName(wgpu::PresentMode mode) {
  switch(mode) {
    case wgpu::PresentMode::Fifo: return "fifo";
    case wgpu::PresentMode::Immediate: return "immediate";
    case wgpu::PresentMode::Mailbox: return "mailbox";
    default: throw std::logic_error("Unknown selected present mode");
  }
}

}
