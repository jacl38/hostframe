import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { Application, Key } from "../../../index.ts";
import { getWindowController } from "../../core/window.ts";
import { configureWindow, renderFrames } from "./frames.ts";
import { checkAdapter } from "./adapter.ts";

const execute = promisify(execFile);
async function xdo(...args: string[]) {
  return (await execute("xdotool", args, { timeout: 3000 })).stdout.trim();
}

const app = new Application();
let device: GPUDevice | undefined;
let running: Promise<void> | undefined;
try {
  const window = app.createWindow({ title: "hostframe input actions", width: 480, height: 300 });
  const adapter = await app.gpu.requestAdapter();
  assert.ok(adapter);
  checkAdapter(adapter);
  device = await adapter.requestDevice();
  const context = configureWindow(app, window, device);
  const id = (await xdo("search", "--onlyvisible", "--pid", String(process.pid), "--name", "^hostframe input actions$")).split("\n")[0]!;
  async function until(predicate: () => boolean) {
    const deadline = performance.now() + 3000;
    while(!predicate()) {
      assert.ok(performance.now() < deadline, "Input command/state transition timed out");
      if(!running) app.pollEvents();
      await setTimeout(10);
    }
  }
  async function keyBatch(key: string) {
    await xdo("keydown", key);
    await xdo("keyup", key);
    await setTimeout(40);
  }
  await xdo("windowactivate", "--sync", id);
  await until(() => window.input.focused);
  app.pollEvents();

  // Commands do not mutate the snapshot or interrupt any listener/event in the
  // current batch. Duplicates are safe; distinct mode transitions retain order.
  const captureEvents: boolean[] = [];
  const offCapture = window.on("pointerCapture", event => { captureEvents.push(event.captured); });
  const before = window.input;
  const delivered: string[] = [];
  let batchState = window.input;
  const first = window.on("key", event => {
    if(event.key !== Key.B) return;
    delivered.push(`first:${event.action}`);
    if(event.action === "press") batchState = window.input;
    assert.equal(window.input, batchState);
    if(event.action !== "press") return;
    window.setPointerCapture(true);
    // Rejected nested dispatch must leave the outer queue intact.
    assert.throws(() => app.pollEvents(), /in progress/);
    assert.throws(() => getWindowController(window).dispatchInput(), /in progress/);
    assert.throws(() => app.createWindow(), /in progress/);
    assert.throws(() => window.dispose(), /in progress/);
    assert.throws(() => app.dispose(), /in progress/);
    assert.throws(() => context.configure({ device: device!, format: app.gpu.getPreferredCanvasFormat() }), /in progress/);
    assert.throws(() => context.getCurrentTexture(), /active window render/);
    assert.throws(() => Reflect.apply(window.setPointerCapture, window, ["yes"]), /booleans/);
    window.setPointerCapture(true);
    window.setPointerCapture(false);
    window.setPointerCapture(true);
    app.stop(); // Stop does not cancel a successful input batch's commands.
  });
  const second = window.on("key", event => {
    if(event.key !== Key.B) return;
    delivered.push(`second:${event.action}`);
    assert.equal(window.input.pointerCaptured, false);
  });
  await keyBatch("b");
  assert.equal(app.pollEvents(), true);
  first();
  second();
  assert.deepEqual(delivered, ["first:press", "second:press", "first:release", "second:release"]);
  assert.equal(window.input.pointerCaptured, true);
  assert.equal(before.pointerCaptured, false);
  assert.deepEqual(captureEvents, [], "Commands must not recursively deliver their notifications");
  app.pollEvents();
  assert.deepEqual(captureEvents, [true, false, true]);
  window.setPointerCapture(false);
  app.pollEvents();

  // No command from a failed listener batch survives, even if an earlier listener
  // requested close. Preserve arbitrary thrown values, including undefined.
  for(const sentinel of [undefined, Symbol("input action failure")]) {
    const enqueue = window.on("key", () => { window.requestClose(); window.setPointerCapture(true); });
    const fail = window.on("key", () => { throw sentinel; });
    await keyBatch("c");
    let threw = false;
    try { app.pollEvents(); } catch (error) { threw = true; assert.equal(error, sentinel); }
    assert.equal(threw, true);
    enqueue();
    fail();
    assert.equal(window.shouldClose, false);
    assert.equal(window.input.pointerCaptured, false);
    app.pollEvents();
    assert.equal(window.shouldClose, false, "Failed batch commands leaked into a later poll");
  }
  const offAsync = Reflect.apply(window.on, window, ["key", async () => {
    window.requestClose();
    throw new Error("Consumed input rejection");
  }]) as () => void;
  await keyBatch("c");
  await assert.rejects(app.run(), /return undefined synchronously/);
  offAsync();
  assert.equal(window.shouldClose, false);

  // The native final focus state governs capture, even for requests made while
  // delivering the focus-loss batch. A failed command drops the later close.
  const offBlur = window.on("focus", event => {
    if(!event.focused) { window.setPointerCapture(true); window.requestClose(); }
  });
  await xdo("windowminimize", "--sync", id);
  let captureFailed = false;
  for(let attempt = 0; attempt < 100 && !captureFailed; attempt++) {
    await setTimeout(10);
    try { app.pollEvents(); } catch (error) {
      assert.match(String(error), /open, focused/);
      captureFailed = true;
    }
  }
  assert.equal(captureFailed, true);
  offBlur();
  assert.equal(window.input.focused, false);
  assert.equal(window.shouldClose, false);
  app.pollEvents();
  await xdo("windowmap", "--sync", id);
  await xdo("windowactivate", "--sync", id);
  await until(() => window.input.focused);
  assert.equal(window.input.pointerCaptured, false);

  // Rendering retains the native guard: these methods only defer during input.
  const offRender = window.on("render", () => {
    assert.throws(() => window.requestClose(), /in progress/);
    assert.throws(() => window.setPointerCapture(true), /in progress/);
  });
  await renderFrames(app, window);
  offRender();

  const offUpdate = app.on("fixedUpdate", () => { assert.fail("Update ran while paused"); });
  const offPausedRender = window.on("render", () => { assert.fail("Render ran while paused"); });
  const offPaused = window.on("key", event => {
    if(event.action !== "press") return;
    if(event.key === Key.A) window.setPointerCapture(true);
    if(event.key === Key.Q) {
      window.requestClose();
      window.requestClose();
      window.setPointerCapture(true); // Canceled by close, which also releases capture.
    }
  });
  running = app.run();
  app.pause();
  await xdo("keydown", "a");
  await until(() => window.input.pointerCaptured);
  await xdo("keyup", "a");
  await until(() => !window.isKeyDown(Key.A));
  await xdo("keydown", "q");
  await running;
  running = undefined;
  offPaused();
  offPausedRender();
  offUpdate();
  offCapture();
  assert.equal(window.shouldClose, true);
  assert.equal(window.input.pointerCaptured, false);
  assert.deepEqual(window.input.keys, []);
  assert.equal(app.pollEvents(), false);
  window.dispose();
  assert.throws(() => window.requestClose(), /disposed/);
  assert.throws(() => window.setPointerCapture(true), /disposed/);

  await xdo("keyup", "q");

  // Manual polling reports an input-requested close in the very same call.
  const replacement = app.createWindow({ title: "hostframe input actions replacement" });
  const replacementId = (await xdo("search", "--onlyvisible", "--pid", String(process.pid), "--name", "^hostframe input actions replacement$")).split("\n")[0]!;
  await xdo("windowactivate", "--sync", replacementId);
  await until(() => replacement.input.focused);
  replacement.on("key", () => { replacement.requestClose(); });
  await keyBatch("q");
  assert.equal(app.pollEvents(), false);
  assert.equal(replacement.shouldClose, true);
  console.log(`${process.versions.bun ? "Bun" : "Node.js"}: native input commands, batch boundaries, failures, guards, paused capture/close and disposal passed.`);
} finally {
  await xdo("keyup", "a", "b", "c", "q").catch(() => {});
  app.stop();
  await running;
  try { app.dispose(); } finally { device?.destroy(); }
}
