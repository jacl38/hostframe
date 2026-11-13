import assert from "node:assert/strict";
import { gpu, GPUTextureUsage, GPUBufferUsage, GPUMapMode } from "../../../globals.ts";
import { getProcessGPU } from "../bridge.ts";

assert.equal(process.env.DISPLAY || "", "", "Run without a display");
assert.equal(process.env.WAYLAND_DISPLAY || "", "", "Run without a Wayland display");
assert.equal(gpu, getProcessGPU(), "Headless and application paths share their GPU owner");
assert.equal(Object.hasOwn(globalThis, "GPUTextureUsage"), false);

const adapter = await gpu.requestAdapter();
assert.ok(adapter, "No compatible GPU adapter");
const device = await adapter.requestDevice();
const errors: string[] = [];
device.addEventListener("uncapturederror", event => errors.push(event.error.message));
try {
  // A single clear/readback proves public GPU access and asynchronous progress
  // without GLFW. Shader and row-layout correctness belong to Dawn.
  const width = 1;
  const height = 1;
  const bytesPerRow = 256;
  const texture = device.createTexture({
    size: [width, height],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
  });
  try {
    const readback = device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    try {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{
        view: texture.createView(),
        clearValue: { r: 1, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store"
      }] });
      pass.end();
      encoder.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow }, [width, height]);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      try {
        const mapped = new Uint8Array(readback.getMappedRange());
        assert.deepEqual([...mapped.subarray(0, 4)], [255, 0, 0, 255]);
      } finally {
        readback.unmap();
      }
      await device.queue.onSubmittedWorkDone();
      assert.deepEqual(errors, []);
    } finally {
      readback.destroy();
    }
  } finally {
    texture.destroy();
  }
} finally {
  device.destroy();
}
console.log(`${process.versions.bun ? "Bun" : "Node.js"}: Headless render/readback passed.`);
