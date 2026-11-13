import assert from "node:assert/strict";
import { prepareShader } from "@vgpu/wgsl/prepare";
import { effect } from "vgpu";
import { createVgpuExample } from "../../examples/vgpu/adapter.ts";
import { assertDeviceAlive } from "../../packages/native/test/device.ts";

const example = await createVgpuExample("validation output", { width: 320, height: 240 });
try {
  const { app, window, context, device, gpu, output } = example;
  const shader = effect(gpu, prepareShader(`
    struct Params { color: vec4f }
    @group(0) @binding(0) var<uniform> params: Params;
    @fragment fn fs_main() -> @location(0) vec4f { return params.color; }
  `), { set: { params: { color: [1, 0, 0, 1] } } });
  await shader.compile(output);
  assert.throws(() => example.render(shader), /active.*render/);
  for(const [width, height, green] of [[320, 240, false], [480, 280, true], [256, 320, false]] as const) {
    window.setSize(width, height);
    shader.set({ params: { color: green ? [0, 1, 0, 1] : [1, 0, 0, 1] } });
    const buffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const deadline = performance.now() + 5000;
    const off = window.on("render", () => {
      example.render(shader);
      const texture = context.getCurrentTexture();
      if(texture.width !== width || texture.height !== height) return;
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture, origin: [width / 2, height / 2] }, { buffer, bytesPerRow: 256 }, [1, 1]);
      device.queue.submit([encoder.finish()]);
      app.stop();
    });
    const offDeadline = app.on("fixedUpdate", () => { assert.ok(performance.now() < deadline, "vgpu resize did not arrive"); });
    try {
      await app.run({ maxFPS: 30 });
      await example.settled();
      assert.deepEqual(output.size, [width, height]);
      await buffer.mapAsync(GPUMapMode.READ);
      const bytes = new Uint8Array(buffer.getMappedRange());
      const bgra = context.getConfiguration()!.format.startsWith("bgra");
      assert.deepEqual(Array.from(bytes.slice(0, 4)), green ? [0, 255, 0, 255] : bgra ? [0, 0, 255, 255] : [255, 0, 0, 255]);
      buffer.unmap();
    } finally { off(); offDeadline(); buffer.destroy(); }
    console.log(`PASS vgpu native output ${width}x${height}`);
  }
  gpu.dispose();
  assert.equal(context.getConfiguration(), null, "vgpu disposal must release the native surface");
  await assertDeviceAlive(device);
} finally {
  await example.dispose();
  await example.dispose();
}
assert.equal((await example.device.lost).reason, "destroyed");
console.log("PASS vgpu native frame scope, resize, wrapper disposal and caller-owned device cleanup");
