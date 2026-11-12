import {
  gpu, GPUBufferUsage, GPUTextureUsage, GPUMapMode, GPUShaderStage,
  GPUColorWrite, GPUValidationError, GPUBuffer
} from "hostframe/globals";

// This fixture also typechecks with no Node/Bun ambient types.
function check(condition: boolean) {
  if(!condition) throw new Error("Explicit WebGPU globals contract failed");
}

check(!Object.hasOwn(globalThis, "GPUBufferUsage"));
check(GPUBufferUsage.COPY_DST === 8);
check(GPUTextureUsage.RENDER_ATTACHMENT === 16);
check(GPUMapMode.READ === 1);
check(GPUShaderStage.VERTEX === 1);
check(GPUColorWrite.ALL === 15);
check(new GPUValidationError("test").message === "test");

const adapter = await gpu.requestAdapter();
if(!adapter) throw new Error("No compatible GPU adapter");
const device = await adapter.requestDevice();
try {
  const buffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
  });
  try {
    check(buffer instanceof GPUBuffer);
    const upload = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true
    });
    try {
      new Uint32Array(upload.getMappedRange())[0] = 42;
      upload.unmap();
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(upload, 0, buffer, 0, 4);
      device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      try {
        check(new Uint32Array(buffer.getMappedRange())[0] === 42);
      } finally {
        buffer.unmap();
      }
    } finally {
      upload.destroy();
    }
  } finally {
    buffer.destroy();
  }
} finally {
  device.destroy();
}

// Both entry points use identical native values; installing remains opt-in.
const base = await import("hostframe");
check(base.gpu === gpu);
check(!Object.hasOwn(globalThis, "GPUBufferUsage"));
base.installWebGPUGlobals();
check(globalThis.GPUBufferUsage === GPUBufferUsage);
console.log("Explicit WebGPU globals and headless readback passed");
