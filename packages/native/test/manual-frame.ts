import assert from "node:assert/strict";
import { Application } from "../../../index.ts";
import { checkAdapter } from "./adapter.ts";

const app = new Application();
let device: GPUDevice | undefined;
try {
  const window = app.createWindow({ title: "hostframe manual frame verification" });
  const context = window.getContext("webgpu");
  assert.equal(context.draw(() => undefined), false, "Unconfigured contexts must not acquire a frame");
  const adapter = await context.requestAdapter();
  assert.ok(adapter);
  checkAdapter(adapter);
  device = await adapter.requestDevice();
  const renderingDevice = device;
  context.configure({
    device,
    format: app.gpu.getPreferredCanvasFormat()
  });

  let texture: GPUTexture | undefined;
  let view: GPUTextureView | undefined;
  let renderEvents = 0;
  const offRender = window.on("render", () => { renderEvents++; });
  assert.equal(context.draw(() => {
    texture = context.getCurrentTexture();
    assert.equal(context.getCurrentTexture(), texture);
    view = texture.createView();
    const encoder = renderingDevice.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{
      view,
      clearValue: [0, 0, 1, 1],
      loadOp: "clear",
      storeOp: "store"
    }] });
    pass.end();
    renderingDevice.queue.submit([encoder.finish()]);
    return undefined;
  }), true);
  assert.equal(renderEvents, 0, "Manual frames must not dispatch scheduled render listeners");
  assert.throws(() => context.getCurrentTexture(), /active window render or manual draw callback/);

  device.pushErrorScope("validation");
  const staleEncoder = device.createCommandEncoder();
  const stalePass = staleEncoder.beginRenderPass({ colorAttachments: [{ view: view!, loadOp: "clear", storeOp: "store" }] });
  stalePass.end();
  device.queue.submit([staleEncoder.finish()]);
  assert.ok(await device.popErrorScope(), "Views retained from manual frames must expire");

  const sentinel = Symbol("manual frame failure");
  assert.throws(() => context.draw(() => { throw sentinel; }), error => error === sentinel);
  assert.throws(() => context.getCurrentTexture(), /active window render or manual draw callback/);
  assert.throws(() => Reflect.apply(context.draw, context, [async () => {}]), /undefined synchronously/);
  assert.equal(context.draw(() => {
    context.getCurrentTexture();
    return undefined;
  }), true, "Manual frames must recover after callback failure");

  const offGuard = window.on("render", () => {
    assert.throws(() => context.draw(() => undefined), /Application\.run\(\) is active/);
    app.stop();
  });
  await app.run();
  offGuard();
  offRender();
  window.dispose();
} finally {
  try {
    app.dispose();
  } finally {
    device?.destroy();
  }
}

console.log(`${process.versions.bun ? "Bun" : "Node.js"}: manual frame scopes, expiration, recovery, and scheduler exclusion passed.`);
