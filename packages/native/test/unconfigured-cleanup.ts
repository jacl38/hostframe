import assert from "node:assert/strict";
import { Application, installWebGPUGlobals } from "../../../index.ts";
import { assertDeviceAlive } from "./device.ts";

installWebGPUGlobals();
const app = new Application();
const devices: GPUDevice[] = [];
try {
  const window = app.createWindow({ title: "hostframe unconfigured cleanup" });
  const context = window.getContext("webgpu");
  // Reuse the native window with another device after releasing the first
  // configuration. Neither caller-owned device may depend on the GLFW lifetime.
  for(let generation = 0; generation < 2; generation++) {
    const adapter = await context.requestAdapter();
    assert.ok(adapter);
    const device = await adapter.requestDevice();
    devices.push(device);
    context.configure({ device, format: app.gpu.getPreferredCanvasFormat() });
    assert.equal(context.draw(() => {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: [1, 0, 0, 1],
        loadOp: "clear",
        storeOp: "store"
      }] });
      pass.end();
      device.queue.submit([encoder.finish()]);
    }), true);
    context.unconfigure();
    context.unconfigure();
    assert.equal(context.getConfiguration(), null);
    assert.equal(context.draw(() => { assert.fail("Unconfigured callback"); }), false);
    // Advance the queue after unconfiguration. A recycled swapchain left on
    // the old surface otherwise gets deleted only during final device teardown,
    // after GLFW has already closed the X11 connection it still needs.
    await assertDeviceAlive(device);
  }
  window.dispose();
  app.dispose();
  for(const device of devices) {
    await assertDeviceAlive(device);
    device.destroy();
  }
} finally {
  try { app.dispose(); } finally { for(const device of devices) device.destroy(); }
}
console.log(`${process.versions.bun ? "Bun" : "Node.js"}: unconfigured swapchain cleanup, surface reuse and caller-owned devices passed.`);
