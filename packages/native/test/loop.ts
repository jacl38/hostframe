import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { installWebGPUGlobals, Application, type RenderEvent } from "../../../index.ts";
import { checkAdapter } from "./adapter.ts";
import { configureWindow, renderFrames } from "./frames.ts";

function render(device: GPUDevice, texture: GPUTexture) {
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: texture.createView(),
      clearValue: { r: 0.05, g: 0.1, b: 0.8, a: 1 },
      loadOp: "clear",
      storeOp: "store"
    }]
  });
  pass.end();
  device.queue.submit([encoder.finish()]);
}

installWebGPUGlobals();

const app = new Application();
let device: GPUDevice | undefined;
try {
  assert.equal(app.pollEvents(), false);
  app.stop();
  assert.throws(() => app.pause(), /not running/);
  assert.throws(() => app.resume(), /not running/);
  assert.throws(() => Reflect.apply(app.on, app, ["unknown", () => {}]), /Unknown application event/);
  assert.throws(() => Reflect.apply(app.on, app, ["fixedUpdate", null]), /listener/);
  assert.throws(() => app.run({ updateHz: 0 }), /updateHz/);
  await app.run();

  const adapter = await app.gpu.requestAdapter();
  assert.ok(adapter);
  checkAdapter(adapter);
  device = await adapter.requestDevice();
  const renderingDevice = device;
  const failures: string[] = [];
  device.addEventListener("uncapturederror", event => failures.push(event.error.message));
  let window = app.createWindow();
  let context = configureWindow(app, window, device);
  assert.equal(window.shouldClose, false);
  assert.equal(app.pollEvents(), true);
  const offGuards = window.on("render", () => {
    assert.throws(() => app.pollEvents(), /in progress/);
    assert.throws(() => app.run(), /already running/);
    assert.throws(() => window.requestClose(), /in progress/);
    assert.throws(() => window.shouldClose, /in progress/);
  });

  await renderFrames(app, window);
  offGuards();

  if(process.argv.includes("--external-close")) {
    window.on("render", () => { render(renderingDevice, context.getCurrentTexture()); });
    console.log(`Ready for native close: ${process.pid}`);
    await app.run({ updateHz: 120 });
    assert.equal(window.shouldClose, true);
    console.log("Native close stopped the loop normally.");
  } else {
    let ticks = 0;
    let frames = 0;
    let hostTaskRan = false;
    const hostTask = setTimeout(1).then(() => { hostTaskRan = true; });
    const buffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    device.queue.writeBuffer(buffer, 0, new Uint32Array([42]));
    let mapped = false;
    const readback = buffer.mapAsync(GPUMapMode.READ).then(() => {
      assert.equal(new Uint32Array(buffer.getMappedRange())[0], 42);
      buffer.unmap();
      mapped = true;
    });
    const offUpdate = app.on("fixedUpdate", event => {
      assert.equal(event.dt, 1 / 120);
      assert.equal(event.tick, ++ticks);
    });
    const offRender = window.on("render", event => {
      assert.equal(event.frame, ++frames);
      assert.ok(event.alpha >= 0 && event.alpha < 1);
      render(renderingDevice, context.getCurrentTexture());
      assert.throws(() => app.dispose(), /in progress/);
      if(frames === 20) {
        assert.ok(hostTaskRan, "Host timers must progress during rendering");
        assert.ok(mapped, "Asynchronous GPU readback must progress during rendering");
        app.stop();
      }
    });
    const running = app.run({ updateHz: 120, maxFPS: 240 });
    assert.throws(() => app.run(), /already running/);
    await running;
    await hostTask;
    await readback;
    buffer.destroy();
    offUpdate();
    offRender();
    assert.ok(ticks > 0);
    assert.equal(frames, 20);

    // Snapshot new subscriptions, apply removals immediately, and skip remaining
    // listeners after stop. Unsubscription remains safe when repeated.
    const calls: string[] = [];
    let added: (() => void) | undefined;
    const first = window.on("render", event => {
      calls.push(`first:${event.frame}`);
      removed();
      if(event.frame === 1) added = window.on("render", () => { calls.push("added"); });
      else app.stop();
    });
    const removed = window.on("render", () => { calls.push("removed"); });
    await app.run();
    first();
    removed();
    removed();
    added?.();
    assert.deepEqual(calls, ["first:1", "first:2"]);

    let duplicateCalls = 0;
    function duplicate() {
      duplicateCalls++;
      return undefined;
    }
    const duplicateOne = window.on("render", duplicate);
    const duplicateTwo = window.on("render", duplicate);
    const offStopDuplicates = window.on("render", () => { app.stop(); });
    await app.run();
    assert.equal(duplicateCalls, 2);
    duplicateOne();
    await app.run();
    assert.equal(duplicateCalls, 3);
    duplicateTwo();
    offStopDuplicates();

    const sentinel = Symbol("loop callback failure");
    const offFailure = window.on("render", () => { throw sentinel; });
    await assert.rejects(app.run(), error => error === sentinel);
    offFailure();
    const offAsync = Reflect.apply(window.on, window, ["render", async () => { throw new Error("async listener"); }]) as () => void;
    await assert.rejects(app.run(), /return undefined synchronously/);
    offAsync();
    const offReturn = Reflect.apply(app.on, app, ["fixedUpdate", () => 42]) as () => void;
    await assert.rejects(app.run({ updateHz: 1000 }), /return undefined synchronously/);
    offReturn();

    const resumed: RenderEvent[] = [];
    let resumeTask: Promise<void> | undefined;
    const offPause = window.on("render", event => {
      resumed.push(event);
      if(event.frame === 1) {
        app.pause();
        resumeTask = setTimeout(30).then(() => {
          assert.equal(resumed.length, 1, "Paused loops must not dispatch callbacks");
          app.resume();
        });
      } else {
        assert.equal(event.frameTime, 0);
        assert.equal(event.alpha, 0);
        assert.equal(event.droppedTime, 0);
        app.stop();
      }
    });
    await app.run({ updateHz: 120 });
    await resumeTask;
    offPause();
    assert.equal(resumed.length, 2);

    // Stop releases a pending long render-cap timer promptly.
    let stopTask: Promise<void> | undefined;
    const offCapped = window.on("render", () => { stopTask = setTimeout(5).then(() => { app.stop(); }); });
    await app.run({ maxFPS: 0.001 });
    await stopTask;
    offCapped();

    // Close requests are observed even while paused, without dispatching render.
    let unexpectedRender = false;
    const offClosed = window.on("render", () => { unexpectedRender = true; });
    const closing = app.run();
    app.pause();
    const closeTask = setTimeout(5).then(() => { window.requestClose(); });
    await closing;
    await closeTask;
    offClosed();
    assert.equal(unexpectedRender, false);
    assert.equal(window.shouldClose, true);
    assert.equal(app.pollEvents(), false);
    await app.run();
    window.dispose();
    assert.throws(() => window.requestClose(), /disposed/);
    assert.throws(() => window.shouldClose, /disposed/);
    window = app.createWindow();
    context = configureWindow(app, window, device);

    // Disposing a window during update prevents later listeners from drawing it.
    let disposedInUpdate = false;
    const offDisposeWindow = app.on("fixedUpdate", () => { disposedInUpdate = true; window.dispose(); });
    const offDisposedRender = window.on("render", () => { assert.equal(disposedInUpdate, false); });
    await app.run({ updateHz: 120, maxFPS: 240 });
    assert.equal(disposedInUpdate, true);
    offDisposeWindow();
    offDisposedRender();
    window = app.createWindow();
    context = configureWindow(app, window, device);

    const offDispose = app.on("fixedUpdate", () => { app.dispose(); });
    app.on("fixedUpdate", () => { assert.fail("Listener dispatched after application disposal"); });
    await app.run();
    offDispose();
    assert.throws(() => app.run(), /disposed/);
    assert.throws(() => window.on("render", () => {}), /disposed/);
    assert.throws(() => app.pollEvents(), /disposed/);
    assert.throws(() => app.pause(), /disposed/);
    assert.throws(() => app.resume(), /disposed/);
    assert.throws(() => context.getCurrentTexture(), /disposed/);
    app.stop();
    app.dispose();

    // Application disposal still leaves the device owned by the caller.
    const retained = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    device.queue.writeBuffer(retained, 0, new Uint32Array([7]));
    await retained.mapAsync(GPUMapMode.READ);
    assert.equal(new Uint32Array(retained.getMappedRange())[0], 7);
    retained.unmap();
    retained.destroy();
    assert.deepEqual(failures, []);
    console.log(`${process.versions.bun ? "Bun" : "Node.js"}: fixed-update scheduler, rendering, cancellation, and lifecycle passed.`);
  }
} finally {
  try {
    app.dispose();
  } finally {
    device?.destroy();
  }
}
