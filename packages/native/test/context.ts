import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { Application } from "../../../index.ts";
import { checkAdapter } from "./adapter.ts";
import { assertFramebufferSize } from "./framebuffer.ts";
import { assertDeviceAlive } from "./device.ts";

const app = new Application();
let device: GPUDevice | undefined;
try {
  // A real surface exists before any adapter/device has been requested.
  const window = app.createWindow({ title: "hostframe context verification", width: 320, height: 240, resizable: true });
  const context = window.getContext("webgpu");
  assert.equal(context, window.getContext("webgpu"));
  assert.equal(context.getConfiguration(), null);
  assert.equal(app.pollEvents(), true);
  assert.throws(() => context.getCurrentTexture(), /active.*render/);
  assert.throws(() => window.presentMode, /not configured/);
  assert.throws(() => Reflect.apply(window.getContext, window, ["2d"]), TypeError);
  await assert.rejects(context.requestAdapter({ powerPreference: "invalid" as GPUPowerPreference }));
  assert.equal(await context.requestAdapter({ featureLevel: "unavailable" }), null);
  const sentinel = Symbol("adapter getter");
  await assert.rejects(context.requestAdapter({ get powerPreference(): GPUPowerPreference { throw sentinel; } }), error => error === sentinel);

  // Unconfigured windows still pump events and fixed updates, without rendering.
  let frames = 0;
  const offUnconfigured = window.on("render", () => { frames++; });
  const offUpdate = app.on("fixedUpdate", () => { app.stop(); });
  await app.run();
  offUpdate();
  offUnconfigured();
  assert.equal(frames, 0);

  const adapter = await context.requestAdapter({ powerPreference: "high-performance" });
  assert.ok(adapter);
  checkAdapter(adapter);
  device = await adapter.requestDevice();
  const renderingDevice = device;
  const format = app.gpu.getPreferredCanvasFormat();
  const errors: string[] = [];
  device.addEventListener("uncapturederror", event => { errors.push(event.error.message); });
  const configuration = { device, format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC };
  context.configure(configuration);
  assert.equal(window.presentMode, "fifo");
  assert.equal(context.getConfiguration()?.device, device);
  assert.equal(context.getConfiguration()?.format, format);
  const snapshot = context.getConfiguration()!;
  snapshot.format = "r8unorm";
  snapshot.viewFormats = ["r8unorm"];
  assert.equal(context.getConfiguration()?.format, format);
  assert.deepEqual(context.getConfiguration()?.viewFormats, []);

  // Invalid reconfiguration preserves the working device and configuration.
  for(const invalid of [
    null, undefined, [], true, () => {},
    { device, format: "r8unorm" },
    { device, format, usage: 0 },
    { device, format, viewFormats: ["r8unorm"] },
    { device, format, colorSpace: "display-p3" },
    { device, format, toneMapping: { mode: "extended" } },
    { device: {}, format },
    { device: Object.create(GPUDevice.prototype), format },
    { device: app.gpu, format }
  ]) {
    assert.throws(() => Reflect.apply(context.configure, context, [invalid]));
    assert.equal(context.getConfiguration()?.format, format);
  }
  assert.throws(() => context.configure({ get device(): GPUDevice { throw sentinel; }, format }), error => error === sentinel);
  context.configure({ device, format, get usage() {
    assert.throws(() => app.dispose(), /in progress/);
    assert.throws(() => context.unconfigure(), /in progress/);
    return configuration.usage;
  } });

  const readback = device.createBuffer({ size: 256 * 240, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  let texture: GPUTexture | undefined;
  let view: GPUTextureView | undefined;
  const offRender = window.on("render", event => {
    assert.ok(event.alpha >= 0 && event.alpha < 1);
    texture = context.getCurrentTexture();
    assert.equal(context.getCurrentTexture(), texture);
    assertFramebufferSize(texture, 320, 240);
    view = texture.createView();
    assert.throws(() => context.configure(configuration), /in progress/);
    assert.throws(() => context.unconfigure(), /in progress/);
    assert.throws(() => window.dispose(), /in progress/);
    assert.throws(() => app.dispose(), /in progress/);
    const encoder = renderingDevice.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{
      view, clearValue: [0, 0, 1, 1], loadOp: "clear", storeOp: "store"
    }] });
    pass.end();
    // Read a column, including the native presentation texture boundary.
    encoder.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow: 256 }, [1, 240]);
    renderingDevice.queue.submit([encoder.finish()]);
    frames++;
  });
  const offSecond = window.on("render", () => {
    assert.equal(context.getCurrentTexture(), texture, "All listeners share one acquired frame");
    if(frames === 3) app.stop();
  });
  await app.run({ maxFPS: 60 });
  assert.equal(frames, 3);
  assert.throws(() => context.getCurrentTexture(), /active.*render/);
  offRender();
  offSecond();
  await readback.mapAsync(GPUMapMode.READ);
  const bytes = new Uint8Array(readback.getMappedRange());
  const expected = format === "bgra8unorm" ? [255, 0, 0, 255] : [0, 0, 255, 255];
  for(let row = 0; row < 240; row++) assert.deepEqual([...bytes.subarray(row * 256, row * 256 + 4)], expected);
  readback.unmap();
  readback.destroy();
  assert.deepEqual(errors, []);

  // Frame views expire even when retained by application code.
  device.pushErrorScope("validation");
  const staleEncoder = device.createCommandEncoder();
  const stalePass = staleEncoder.beginRenderPass({ colorAttachments: [{ view: view!, loadOp: "clear", storeOp: "store" }] });
  stalePass.end();
  device.queue.submit([staleEncoder.finish()]);
  assert.ok(await device.popErrorScope());

  const offFailure = window.on("render", () => {
    texture = context.getCurrentTexture();
    throw sentinel;
  });
  await assert.rejects(app.run(), error => error === sentinel);
  assert.throws(() => context.getCurrentTexture(), /active.*render/);
  offFailure();
  const offAsync = window.on("render", (() => Promise.reject(sentinel)) as unknown as () => undefined);
  await assert.rejects(app.run(), /undefined synchronously/);
  offAsync();
  const offRecovered = window.on("render", () => { context.getCurrentTexture(); app.stop(); });
  await app.run();
  offRecovered();

  // Listener additions start on the next frame; removals and stop apply immediately.
  const calls: string[] = [];
  let offAdded: (() => void) | undefined;
  let offRemoved: () => void;
  const offFirst = window.on("render", () => {
    calls.push("first");
    offRemoved();
    offAdded ??= window.on("render", () => { calls.push("added"); });
    if(calls.length > 1) app.stop();
  });
  offRemoved = window.on("render", () => { calls.push("removed"); });
  await app.run();
  assert.deepEqual(calls, ["first", "first"]);
  offFirst();
  offRemoved();
  offAdded?.();

  if(process.argv.includes("--interactions")) {
    const execute = promisify(execFile);
    async function xdo(...args: string[]) {
      return (await execute("xdotool", args, { timeout: 3000 })).stdout.trim();
    }
    const id = (await xdo("search", "--onlyvisible", "--pid", String(process.pid), "--name", "^hostframe context verification$")).split("\n")[0]!;
    assert.ok(id);
    let size = "";
    let rendered = 0;
    let ticks = 0;
    let failure: unknown;
    const offTick = app.on("fixedUpdate", () => { ticks++; });
    const offResize = window.on("render", () => {
      const texture = context.getCurrentTexture();
      size = `${texture.width}x${texture.height}`;
      const encoder = renderingDevice.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{
        view: texture.createView(), clearValue: [0, 0, 1, 1], loadOp: "clear", storeOp: "store"
      }] });
      pass.end();
      renderingDevice.queue.submit([encoder.finish()]);
      rendered++;
    });
    const running = app.run({ maxFPS: 60 }).catch(error => { failure = error; });
    async function until(expected: string) {
      const deadline = performance.now() + 4000;
      while(size !== expected) {
        if(failure) throw failure;
        assert.ok(performance.now() < deadline, `Expected ${expected}, got ${size}`);
        await setTimeout(10);
      }
    }
    async function capture(name: string) {
      const directory = process.env.HOSTFRAME_CAPTURE_DIRECTORY;
      if(!directory) return;
      await mkdir(directory, { recursive: true });
      const runtime = process.versions.bun ? "bun" : "node";
      await execute("import", ["-window", id, resolve(directory, `context-${runtime}-${name}.png`)], { timeout: 3000 });
    }
    try {
      await until("320x240");
      await capture("initial");
      await xdo("windowsize", "--sync", id, "480", "300");
      await until("480x300");
      await capture("resized");
      await xdo("windowminimize", "--sync", id);
      await setTimeout(150);
      const before = rendered;
      const ticksBefore = ticks;
      await setTimeout(150);
      assert.equal(rendered, before, "Minimized windows must emit no render events");
      assert.ok(ticks > ticksBefore, "Fixed updates must continue while minimized");
      size = "";
      await xdo("windowmap", "--sync", id);
      await xdo("windowactivate", "--sync", id);
      await until("480x300");
      await capture("restored");
      await xdo("windowsize", "--sync", id, "360", "260");
      await until("360x260");
    } finally {
      app.stop();
      await running;
      offTick();
      offResize();
    }
    if(failure) throw failure;
  }

  context.unconfigure();
  context.unconfigure();
  assert.equal(context.getConfiguration(), null);
  assert.throws(() => window.presentMode, /not configured/);
  await assertDeviceAlive(device);
  const secondAdapter = await app.gpu.requestAdapter();
  assert.ok(secondAdapter);
  const secondDevice = await secondAdapter.requestDevice();
  try {
    context.configure({ device: secondDevice, format });
    assert.equal(context.getConfiguration()?.device, secondDevice);
    const offSecondDevice = window.on("render", () => { context.getCurrentTexture(); app.stop(); });
    try { await app.run(); } finally { offSecondDevice(); }
    context.configure(configuration);
    await assertDeviceAlive(secondDevice);
  } finally {
    // Ensure the context no longer retains the caller-owned replacement device.
    context.configure(configuration);
    secondDevice.destroy();
  }
  context.configure(configuration);
  const offFinalRender = window.on("render", () => { context.getCurrentTexture(); });
  const offClose = app.on("fixedUpdate", () => { window.requestClose(); });
  await app.run();
  offClose();
  offFinalRender();
  window.dispose();
  await assert.rejects(context.requestAdapter(), /disposed/);
  assert.throws(() => context.configure(configuration), /disposed/);
  assert.throws(() => context.getConfiguration(), /disposed/);
  assert.throws(() => context.getCurrentTexture(), /disposed/);

  // Ordinary WebGPU selection remains usable, with compatibility checked at configure.
  const replacement = app.createWindow();
  const replacementContext = replacement.getContext("webgpu");
  replacementContext.configure(configuration);
  device.destroy();
  const offLost = replacement.on("render", () => {});
  await assert.rejects(app.run(), /lost or destroyed/);
  offLost();
  replacement.dispose();
  app.createWindow().dispose(); // Disposal before configuration is safe.
} finally {
  try { app.dispose(); } finally { device?.destroy(); }
}
console.log(`${process.versions.bun ? "Bun" : "Node.js"}: context setup, clear/readback, frame lifetime, recovery, configuration and disposal passed.`);
