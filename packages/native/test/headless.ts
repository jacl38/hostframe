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
  // Deliberately use a width requiring row padding during readback.
  const width = 65;
  const height = 48;
  const rowBytes = width * 4;
  const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
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
      const module = device.createShaderModule({ code: `
        @vertex fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
          let positions = array(vec2f(0.0, 0.8), vec2f(-0.8, -0.8), vec2f(0.8, -0.8));
          return vec4f(positions[index], 0.0, 1.0);
        }
        @fragment fn fragmentMain() -> @location(0) vec4f {
          return vec4f(1.0, 0.0, 0.0, 1.0);
        }
      ` });
      const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vertexMain" },
        fragment: { module, entryPoint: "fragmentMain", targets: [{ format: "rgba8unorm" }] }
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{
        view: texture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store"
      }] });
      pass.setPipeline(pipeline);
      pass.draw(3);
      pass.end();
      encoder.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow }, [width, height]);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const pixels = new Uint8Array(rowBytes * height);
      try {
        const mapped = new Uint8Array(readback.getMappedRange());
        for(let y = 0; y < height; y++) {
          pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + rowBytes), y * rowBytes);
        }
      } finally {
        readback.unmap();
      }
      const center = (24 * width + 32) * 4;
      assert.deepEqual([...pixels.subarray(center, center + 4)], [255, 0, 0, 255]);
      assert.deepEqual([...pixels.subarray(0, 4)], [0, 0, 0, 255]);
      assert.deepEqual([...pixels.subarray(-4)], [0, 0, 0, 255]);
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
