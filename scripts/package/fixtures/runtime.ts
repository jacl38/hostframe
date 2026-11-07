import assert from "node:assert/strict";
import { installWebGPUGlobals, Application, Key, Modifier, PointerButton } from "hostframe";

installWebGPUGlobals();

assert.equal(Key.W, 87);
assert.equal(PointerButton.LEFT, 0);
assert.equal(Modifier.SHIFT, 1);

if(process.argv.includes("--no-display")) {
  for(let attempt = 0; attempt < 2; attempt++) {
    assert.throws(() => new Application(), /GLFW initialization failed/);
  }
} else {
  const app = new Application();
  let device: GPUDevice | undefined;
  try {
    const window = app.createWindow({ title: "hostframe package verification", width: 320, height: 240 });
    assert.equal(window.metrics.width, 320);
    assert.deepEqual(window.toFramebuffer(160, 120), { x: window.metrics.framebufferWidth / 2, y: window.metrics.framebufferHeight / 2 });
    const context = window.getContext("webgpu");
    const adapter = await context.requestAdapter();
    assert.ok(adapter, "No compatible GPU adapter");
    device = await adapter.requestDevice();
    const renderingDevice = device;
    const errors: string[] = [];
    device.addEventListener("uncapturederror", event => { errors.push(event.error.message); });
    const storage = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    try {
      device.queue.writeBuffer(storage, 0, new Uint32Array([0, 1, 7, 42]));
      const module = device.createShaderModule({ code: `
        @group(0) @binding(0) var<storage, read_write> values: array<u32>;
        @compute @workgroup_size(1)
        fn main(@builtin(global_invocation_id) id: vec3u) {
          values[id.x] = values[id.x] * 2u + 1u;
        }
      ` });
      const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
      const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: storage } }] });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(4);
      pass.end();
      encoder.copyBufferToBuffer(storage, 0, readback, 0, 16);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      assert.deepEqual([...new Uint32Array(readback.getMappedRange())], [1, 3, 15, 85]);
      readback.unmap();
    } finally {
      storage.destroy();
      readback.destroy();
    }
    context.configure({ device, format: app.gpu.getPreferredCanvasFormat() });
    assert.equal(window.presentMode, "fifo");
    const second = app.createWindow({ title: "hostframe package second", width: 240, height: 180 });
    const secondContext = second.getContext("webgpu");
    secondContext.configure({ device, format: app.gpu.getPreferredCanvasFormat() });
    let secondFrames = 0;
    second.on("render", () => {
      assert.equal(secondContext.getCurrentTexture().width, 240);
      secondFrames++;
      if(secondFrames === 5) app.stop();
    });
    let frames = 0;
    window.on("render", () => {
      const texture = context.getCurrentTexture();
      assert.equal(texture.width, 320);
      assert.equal(texture.height, 240);
      const encoder = renderingDevice.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{
        view: texture.createView(),
        clearValue: { r: 0.05, g: 0.1, b: 0.8, a: 1 },
        loadOp: "clear",
        storeOp: "store"
      }] });
      pass.end();
      renderingDevice.queue.submit([encoder.finish()]);
      frames++;
      if(frames === 3) app.stop();
    });
    await app.run({ maxFPS: 30 });
    assert.equal(frames, 3);
    assert.equal(secondFrames, 2, "Stopping in first window must skip second");
    window.requestClose();
    await app.run({ maxFPS: 30 });
    assert.equal(frames, 3);
    assert.equal(secondFrames, 5);
    second.dispose();
    window.dispose();
    window.dispose();
    assert.throws(() => context.getCurrentTexture(), /disposed/);
    const replacement = app.createWindow();
    replacement.dispose();
    await device.queue.onSubmittedWorkDone();
    assert.deepEqual(errors, []);
    app.dispose();
    app.dispose();
    assert.throws(() => app.createWindow(), /disposed/);
  } finally {
    app.dispose();
    device?.destroy();
  }
}
console.log(`${process.versions.bun ? "Bun" : "Node.js"}: packed-package ${process.argv.includes("--no-display") ? "initialization failure" : "compute, presentation, loop, and disposal"} passed.`);
