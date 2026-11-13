import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { installWebGPUGlobals, Application, Key } from "../../../index.ts";
import { configureWindow } from "./frames.ts";
import { assertDeviceAlive } from "./device.ts";

const execute = promisify(execFile);
async function xdo(...args: string[]) {
  return (await execute("xdotool", args, { timeout: 3000 })).stdout.trim();
}
installWebGPUGlobals();

const app = new Application();
let device: GPUDevice | undefined;
let running: Promise<void> | undefined;
try {
  const windows = [
    app.createWindow({ title: "hostframe multi input blue", width: 400, height: 280, resizable: true }),
    app.createWindow({ title: "hostframe multi input orange", width: 320, height: 240, resizable: true })
  ];
  const adapter = await windows[0]!.getContext("webgpu").requestAdapter();
  assert.ok(adapter);
  device = await adapter.requestDevice();
  const shared = device;
  const contexts = windows.map(window => configureWindow(app, window, shared));
  const ids: string[] = [];
  const frames = [0, 0];
  const sizes = [[0, 0], [0, 0]];
  const keys: number[][] = [[], []];
  for(const [index, window] of windows.entries()) {
    ids.push((await xdo("search", "--all", "--onlyvisible", "--pid", String(process.pid), "--name", index ? "^hostframe multi input orange$" : "^hostframe multi input blue$")).split("\n")[0]!);
    await xdo("windowmove", ids[index]!, String(40 + index * 560), "100");
    window.on("key", event => { if(event.action === "press") keys[index]!.push(event.key); });
    window.on("render", () => {
      frames[index]!++;
      const texture = contexts[index]!.getCurrentTexture();
      sizes[index] = [texture.width, texture.height];
      const encoder = shared.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{
        view: texture.createView(), clearValue: index ? [1, 0.28, 0.04, 1] : [0.05, 0.2, 0.85, 1],
        loadOp: "clear", storeOp: "store"
      }] });
      pass.end();
      shared.queue.submit([encoder.finish()]);
    });
  }
  assert.notEqual(ids[0], ids[1], "Window searches must identify distinct native windows");
  async function until(predicate: () => boolean) {
    const deadline = performance.now() + 3000;
    while(!predicate()) {
      if(performance.now() >= deadline) {
        console.error("Focus:", await xdo("getwindowfocus"), "ids:", ids, "states:", windows.map(window => window.input), "keys:", keys);
        assert.fail("Multi-window transition timed out");
      }
      if(!running) app.pollEvents();
      await delay(10);
    }
  }
  async function focus(index: number, otherDisposed = false) {
    await xdo("windowactivate", "--sync", ids[index]!);
    // A new window can already report focus before the previous one's loss is polled.
    await until(() => windows[index]!.input.focused && (otherDisposed || !windows[1 - index]!.input.focused));
  }
  await focus(0);
  await xdo("keydown", "a");
  await until(() => windows[0]!.isKeyDown(Key.A));
  assert.equal(windows[1]!.isKeyDown(Key.A), false);
  windows[0]!.setPointerCapture(true);
  await focus(1);
  assert.equal(windows[0]!.isKeyDown(Key.A), false);
  assert.equal(windows[0]!.input.pointerCaptured, false);
  await xdo("keyup", "a");
  await xdo("key", "b");
  await until(() => keys[1]!.includes(Key.B));
  assert.equal(JSON.stringify(keys), JSON.stringify([[Key.A], [Key.B]]));
  await focus(0);

  // Each window keeps its own batch snapshot and command queue. Failure in the
  // first drops its commands and leaves the second's native batch for next poll.
  const sentinel = Symbol("multi input failure");
  const enqueue = windows[0]!.on("key", () => {
    windows[0]!.requestClose();
    assert.throws(() => windows[1]!.requestClose(), /in progress/);
    assert.throws(() => windows[1]!.dispose(), /in progress/);
    assert.throws(() => contexts[1]!.unconfigure(), /in progress/);
  });
  const fail = windows[0]!.on("key", () => { throw sentinel; });
  await xdo("windowactivate", "--sync", ids[0]!);
  await xdo("key", "c");
  await xdo("windowactivate", "--sync", ids[1]!);
  await xdo("key", "d");
  await delay(40);
  let caught = false;
  try { app.pollEvents(); } catch (error) { caught = true; assert.equal(error, sentinel); }
  assert.equal(caught, true);
  enqueue();
  fail();
  assert.equal(windows[0]!.shouldClose, false);
  assert.equal(keys[1]!.includes(Key.D), false);
  await until(() => keys[1]!.includes(Key.D));

  running = app.run({ maxFPS: 120 });
  await until(() => frames.every(count => count >= 3));
  await xdo("windowsize", "--sync", ids[0]!, "520", "340");
  await until(() => sizes[0]![0] === 520 && sizes[0]![1] === 340);
  assert.deepEqual(sizes[1], [320, 240]);
  await xdo("windowminimize", "--sync", ids[0]!);
  await delay(100);
  const minimized = [...frames];
  await delay(100);
  assert.equal(frames[0], minimized[0]);
  assert.ok(frames[1]! > minimized[1]!);
  await xdo("windowmap", "--sync", ids[0]!);
  await until(() => frames[0]! > minimized[0]!);
  const directory = process.env.HOSTFRAME_CAPTURE_DIRECTORY;
  if(directory) {
    await mkdir(directory, { recursive: true });
    await execute("import", ["-window", "root", join(directory, `multiple-${process.versions.bun ? "bun" : "node"}.png`)]);
  }

  // Paused polling still applies per-window commands, and closing the first
  // leaves the promise active until the final open window closes.
  app.pause();
  const pausedFrames = [...frames];
  let finished = false;
  void running.then(() => { finished = true; });
  for(const window of windows) {
    window.on("key", event => {
      if(event.action === "press" && event.key === Key.Q) {
        window.requestClose();
        window.setPointerCapture(true); // Later commands are canceled by close.
      }
    });
  }
  await focus(0);
  await xdo("key", "q");
  await until(() => windows[0]!.shouldClose);
  assert.equal(finished, false);
  assert.deepEqual(frames, pausedFrames);
  const closedFrames = frames[0];
  app.resume();
  const otherFrames = frames[1]!;
  await until(() => frames[1]! > otherFrames + 2);
  assert.equal(frames[0], closedFrames);
  windows[0]!.dispose();
  await assertDeviceAlive(shared);
  await focus(1, true);
  await xdo("key", "q");
  await running;
  running = undefined;
  assert.equal(app.pollEvents(), false);
  assert.equal(windows[1]!.shouldClose, true);
  windows[1]!.dispose();
  await assertDeviceAlive(shared);
  console.log(`${process.versions.bun ? "Bun" : "Node.js"}: two-window focus/input routing, failed batches, resize, minimize, paused commands, independent close/disposal and rendering passed.`);
} finally {
  await xdo("keyup", "a", "b", "c", "d", "q").catch(() => {});
  app.stop();
  await running;
  try { app.dispose(); } finally { device?.destroy(); }
}
