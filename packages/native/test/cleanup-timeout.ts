import assert from "node:assert/strict";
import { readdirSync, readlinkSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { installWebGPUGlobals, Application } from "../../../index.ts";
import { assertDeviceAlive } from "./device.ts";
import { configureWindow, renderFrames } from "./frames.ts";

installWebGPUGlobals();

const operation = process.argv[2]!;
assert.ok(["unconfigure", "reconfigure", "window", "application"].includes(operation));
const gc = (globalThis as { gc?: () => void }).gc;
assert.ok(gc, "Run with --expose-gc");

function sockets() {
  if(process.platform !== "linux") return [];
  return readdirSync("/proc/self/fd").flatMap(descriptor => {
    try {
      const target = readlinkSync(`/proc/self/fd/${descriptor}`);
      return target.startsWith("socket:") ? [target] : [];
    } catch {
      return [];
    }
  });
}

async function exercise() {
  const before = sockets();
  const app = new Application();
  const session = sockets().filter(socket => !before.includes(socket));
  if(process.platform === "linux") assert.ok(session.length);
  const window = app.createWindow();
  const context = window.getContext("webgpu");
  const adapter = await context.requestAdapter();
  assert.ok(adapter);
  const replacement = await adapter.requestDevice();
  const format = app.gpu.getPreferredCanvasFormat();
  const weakDevice = await failCleanup();
  async function failCleanup() {
    const oldAdapter = await context.requestAdapter();
    assert.ok(oldAdapter);
    const device = await oldAdapter.requestDevice();
    const weak = new WeakRef(device);
    context.configure({ device, format });
    await renderFrames(app, window);
    const sibling = app.createWindow({ title: "hostframe shared timeout sibling" });
    const siblingContext = configureWindow(app, sibling, device);
    await renderFrames(app, sibling);

    // Failed validation and callback errors must preserve their original values
    // and must not consume the fault (neither operation drains the device).
    const sentinel = new Error("configuration getter sentinel");
    assert.throws(() => context.configure({ get device(): GPUDevice { throw sentinel; }, format }), error => error === sentinel);
    assert.equal(context.getConfiguration()?.device, device);
    const off = window.on("render", () => { throw sentinel; });
    await assert.rejects(renderFrames(app, window), error => error === sentinel);
    off();
    await renderFrames(app, window);

    if(operation === "window" || operation === "application") {
      window.on("render", () => { void device.label; });
    }
    if(operation === "application") app.on("fixedUpdate", () => { void device.label; });
    const cleanup = {
      unconfigure: () => context.unconfigure(),
      reconfigure: () => context.configure({ device: replacement, format }),
      window: () => window.dispose(),
      application: () => app.dispose()
    }[operation]!;
    assert.throws(cleanup, error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "GPU cleanup timed out; device was destroyed");
      return true;
    });
    assert.equal((await device.lost).reason, "destroyed", "Timeout must destroy the old caller device");
    if(operation === "application") {
      assert.throws(() => siblingContext.getConfiguration(), /disposed/);
    } else {
      // The bounded cleanup policy destroys the stalled caller-owned device,
      // including other surfaces sharing it. They fail explicitly, then dispose.
      await assert.rejects(renderFrames(app, sibling), /lost or destroyed/);
    }
    sibling.dispose();
    assert.throws(() => siblingContext.getConfiguration(), /disposed/);
    return weak;
  }
  await collected(weakDevice);
  await assertDeviceAlive(replacement);
  if(operation === "unconfigure" || operation === "reconfigure") {
    assert.equal(context.getConfiguration(), null, "Native cleanup must clear the TS cache even on throw");
    assert.throws(() => window.presentMode, /not configured/);
    context.unconfigure();
    context.unconfigure();
    context.configure({ device: replacement, format });
    await renderFrames(app, window);
    context.unconfigure();
    assert.equal(context.getConfiguration(), null);
  } else {
    assert.throws(() => context.getConfiguration(), /disposed/);
    assert.throws(() => window.on("render", () => undefined), /disposed/);
    window.dispose();
    window.dispose();
  }
  if(operation !== "application") {
    for(const socket of session) assert.ok(sockets().includes(socket), "Window cleanup must retain the session");
    window.dispose();
    const nextWindow = app.createWindow();
    configureWindow(app, nextWindow, replacement);
    await renderFrames(app, nextWindow);
  }
  app.dispose();
  app.dispose();
  window.dispose();
  assert.throws(() => app.createWindow(), /disposed/);
  for(const socket of session) assert.ok(!sockets().includes(socket), "Application cleanup must release the session");
  await assertDeviceAlive(replacement);
  replacement.destroy();
  // Keep wrappers alive while collecting: a native persistent reference or the
  // TS configuration cache must not retain the timed-out device through them.
  return { weakDevice, app, window, context };
}

async function collected(reference: WeakRef<GPUDevice>) {
  for(let attempt = 0; attempt < 100; attempt++) {
    gc!();
    await setTimeout(10);
    if(!reference.deref()) return;
    await setTimeout(0);
  }
  assert.fail("Cleanup must release retained device references");
}

const retained = await exercise();
await collected(retained.weakDevice);
// Keep the wrappers observably reachable through the collection assertion.
assert.throws(() => retained.context.getConfiguration(), /disposed/);
retained.window.dispose();
retained.app.dispose();
const next = new Application();
try {
  const window = next.createWindow();
  const adapter = await window.getContext("webgpu").requestAdapter();
  assert.ok(adapter);
  const device = await adapter.requestDevice();
  configureWindow(next, window, device);
  await renderFrames(next, window);
  next.dispose();
  await assertDeviceAlive(device);
  device.destroy();
} finally {
  next.dispose();
}
console.log(`${process.versions.bun ? "Bun" : "Node.js"}: forced ${operation} cleanup passed.`);
