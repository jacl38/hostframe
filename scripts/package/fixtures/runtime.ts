import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { gpu, installWebGPUGlobals, Application, Key, Modifier, PointerButton } from "hostframe";

installWebGPUGlobals();
const execute = promisify(execFile);
async function userClose(title: string) {
  assert.ok(process.env.HOSTFRAME_CLOSE_REQUEST, "Packed lifecycle verification needs the native X11 close helper");
  const id = (await execute("xdotool", ["search", "--all", "--pid", String(process.pid), "--name", `^${title}$`], { timeout: 3000 })).stdout.trim().split("\n")[0]!;
  await execute(process.env.HOSTFRAME_CLOSE_REQUEST, [id], { timeout: 3000 });
}

assert.equal(Key.W, 87);
assert.equal(PointerButton.LEFT, 0);
assert.equal(Modifier.SHIFT, 1);

if(process.argv.includes("--no-display")) {
  const adapter = await gpu.requestAdapter();
  assert.ok(adapter, "Headless GPU access must work without a display");
  const device = await adapter.requestDevice();
  device.destroy();
  for(let attempt = 0; attempt < 2; attempt++) {
    assert.throws(() => new Application(), /GLFW initialization failed/);
  }
} else {
  const app = new Application();
  assert.equal(app.gpu, gpu);
  let device: GPUDevice | undefined;
  try {
    const window = app.createWindow({ title: "hostframe package verification", width: 320, height: 240 });
    assert.equal(window.metrics.width, 320);
    assert.deepEqual(window.toFramebuffer(160, 120), { x: window.metrics.framebufferWidth / 2, y: window.metrics.framebufferHeight / 2 });
    let closeRequests = 0;
    window.on("closeRequest", event => { closeRequests++; event.preventDefault(); });
    window.setTitle("hostframe packed runtime controls");
    window.setPosition(100, 120);
    window.setVisible(false);
    app.pollEvents();
    assert.equal(window.status.visible, false);
    window.setVisible(true);
    app.pollEvents();
    assert.equal(window.status.visible, true);
    assert.ok(Object.isFrozen(window.status));
    // Keep the established 320x240 render assertions below.
    window.setSize(320, 240);
    await userClose("hostframe packed runtime controls");
    const closeDeadline = performance.now() + 3000;
    while(closeRequests === 0) {
      assert.ok(performance.now() < closeDeadline, "Packed close request was not delivered");
      app.pollEvents();
      await setTimeout(10);
    }
    assert.equal(window.shouldClose, false);
    const context = window.getContext("webgpu");
    const adapter = await context.requestAdapter();
    assert.ok(adapter, "No compatible GPU adapter");
    device = await adapter.requestDevice();
    const renderingDevice = device;
    const errors: string[] = [];
    device.addEventListener("uncapturederror", event => { errors.push(event.error.message); });
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
    const replacement = app.createWindow({ title: "hostframe packed accepted close" });
    await userClose("hostframe packed accepted close");
    await app.run();
    assert.equal(replacement.shouldClose, true);
    assert.equal(closeRequests, 1, "Explicit requestClose must not emit another request");
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
console.log(`${process.versions.bun ? "Bun" : "Node.js"}: packed-package ${process.argv.includes("--no-display") ? "initialization failure" : "lifecycle controls, native close, presentation, loop, and disposal"} passed.`);
