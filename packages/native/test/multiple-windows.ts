import assert from "node:assert/strict";
import { installWebGPUGlobals, Application } from "../../../index.ts";
import type { Window } from "../../../index.ts";
import { assertDeviceAlive } from "./device.ts";
import { configureWindow, renderFrames } from "./frames.ts";
import { assertFramebufferSize } from "./framebuffer.ts";
import { checkAdapter } from "./adapter.ts";

installWebGPUGlobals();

const app = new Application();
let device: GPUDevice | undefined;
try {
  const first = app.createWindow({ title: "hostframe multiple first", width: 360, height: 240, resizable: true });
  const second = app.createWindow({ title: "hostframe multiple second", width: 280, height: 200, vsync: false });
  const adapter = await first.getContext("webgpu").requestAdapter();
  assert.ok(adapter);
  checkAdapter(adapter);
  device = await adapter.requestDevice();
  const shared = device;
  const errors: string[] = [];
  shared.addEventListener("uncapturederror", event => { errors.push(event.error.message); });
  const firstContext = configureWindow(app, first, shared);
  const secondContext = configureWindow(app, second, shared);
  const otherAdapter = await secondContext.requestAdapter();
  assert.ok(otherAdapter);
  const rejectedDevice = await otherAdapter.requestDevice();
  rejectedDevice.destroy();
  assert.throws(() => secondContext.configure({ device: rejectedDevice, format: app.gpu.getPreferredCanvasFormat() }), /lost or destroyed/);
  assert.equal(secondContext.getConfiguration()?.device, shared);
  assert.equal(first.presentMode, "fifo");
  assert.ok(["immediate", "mailbox"].includes(second.presentMode));
  const order: string[] = [];
  let firstFrames = 0;
  let secondFrames = 0;
  first.on("render", () => {
    firstFrames++;
    order.push("first");
    assertFramebufferSize(firstContext.getCurrentTexture(), 360, 240);
    assert.throws(() => secondContext.getCurrentTexture(), /active window render/);
    assert.throws(() => second.dispose(), /in progress/);
    assert.throws(() => second.requestClose(), /in progress/);
    assert.throws(() => secondContext.unconfigure(), /in progress/);
  });
  second.on("render", () => {
    secondFrames++;
    order.push("second");
    assertFramebufferSize(secondContext.getCurrentTexture(), 280, 200);
    assert.throws(() => firstContext.getCurrentTexture(), /active window render|disposed/);
  });
  await renderFrames(app, second, 3);
  assert.deepEqual(order, ["first", "second", "first", "second", "first", "second"]);

  // A rejected second creation must not overwrite or unregister existing owners.
  assert.throws(() => app.createWindow({ width: 0 }), /width/);
  await renderFrames(app, second);
  const sentinel = Symbol("first render failure");
  const fail = first.on("render", () => { throw sentinel; });
  const beforeFailure = secondFrames;
  await assert.rejects(app.run(), error => error === sentinel);
  fail();
  assert.equal(secondFrames, beforeFailure, "Failed earlier rendering must skip later windows");
  await renderFrames(app, second);

  // Per-window unconfiguration/disposal drains shared GPU work without destroying
  // the device or altering another surface's configuration.
  firstContext.unconfigure();
  await assertDeviceAlive(shared);
  const beforeUnconfigured = firstFrames;
  await renderFrames(app, second);
  assert.equal(firstFrames, beforeUnconfigured);
  firstContext.configure({ device: shared, format: app.gpu.getPreferredCanvasFormat() });
  first.requestClose();
  assert.equal(app.pollEvents(), true);
  const beforeClosed = firstFrames;
  await renderFrames(app, second, 2);
  assert.equal(firstFrames, beforeClosed, "Closed configured windows must skip acquisition");

  let created: Window | undefined;
  let createdFrames = 0;
  let ticks = 0;
  const offUpdate = app.on("fixedUpdate", () => {
    ticks++;
    if(ticks === 1) {
      first.dispose();
      created = app.createWindow({ title: "hostframe created during update" });
      const context = configureWindow(app, created, shared);
      created.on("render", () => { void context.getCurrentTexture(); createdFrames++; });
      // Repeated disposal must not remove the new window.
      first.dispose();
    }
    if(ticks === 3) {
      assert.ok(createdFrames > 0);
      created!.dispose();
      assert.throws(() => created!.on("render", () => undefined), /disposed/);
    }
    if(ticks === 5) second.requestClose();
  });
  await app.run({ updateHz: 30, maxFPS: 120 });
  offUpdate();
  assert.equal(ticks, 5);
  assert.equal(app.pollEvents(), false);
  assert.equal(second.shouldClose, true);
  await assertDeviceAlive(shared);

  // The final disposal ends a run too; replacement in the same update remains live.
  const old = app.createWindow();
  let replacement: Window | undefined;
  let updates = 0;
  const offReplacement = app.on("fixedUpdate", () => {
    updates++;
    if(updates === 1) {
      old.dispose();
      replacement = app.createWindow();
      configureWindow(app, replacement, shared);
    } else replacement!.dispose();
  });
  let laterUpdates = 0;
  const offLater = app.on("fixedUpdate", () => { laterUpdates++; });
  await app.run({ updateHz: 120 });
  offReplacement();
  offLater();
  assert.equal(laterUpdates, 1, "Final disposal skips later listeners; same-callback replacement preserves them");
  assert.equal(updates, 2);
  second.dispose();
  const owned = [app.createWindow(), app.createWindow()];
  const ownedContexts = owned.map(window => configureWindow(app, window, shared));
  await renderFrames(app, owned[1]!, 2);
  app.dispose();
  for(const context of ownedContexts) assert.throws(() => context.getConfiguration(), /disposed/);
  for(const window of owned) window.dispose();
  await assertDeviceAlive(shared);
  assert.deepEqual(errors, []);
  console.log(`${process.versions.bun ? "Bun" : "Node.js"}: multiple-window ordering, configuration, guards, failures, fixed-update ownership, first/final close and shared-device lifetime passed.`);
} finally {
  try { app.dispose(); } finally { device?.destroy(); }
}
