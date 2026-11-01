import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { Application, Key, Modifier, PointerButton } from "../../../index.ts";
import type { InputEvent } from "../../../index.ts";
import { checkAdapter } from "./adapter.ts";

const execute = promisify(execFile);
async function xdo(...args: string[]) {
  return (await execute("xdotool", args, { timeout: 3000 })).stdout.trim();
}

const app = new Application();
let device: GPUDevice | undefined;
let running: Promise<void> | undefined;
let loopError: unknown;
try {
  const adapter = await app.gpu.requestAdapter();
  assert.ok(adapter);
  checkAdapter(adapter);
  device = await adapter.requestDevice();
  const window = app.createWindow(device, { title: "ts-dawn input verification", width: 480, height: 300 });
  const id = (await xdo("search", "--onlyvisible", "--pid", String(process.pid), "--name", "^ts-dawn input verification$")).split("\n")[0]!;
  const events: InputEvent[] = [];
  for(const name of ["key", "pointerMove", "pointerButton", "scroll", "focus", "pointerCapture"] as const) {
    window.on(name, event => { events.push(event); });
  }
  async function until(predicate: () => boolean, message: string) {
    const deadline = performance.now() + 4000;
    while(!predicate()) {
      if(loopError) throw loopError;
      assert.ok(performance.now() < deadline, message);
      // Manual polling first; later the same assertions exercise app.run polling.
      if(!running) app.pollEvents();
      await setTimeout(10);
    }
  }
  await xdo("windowactivate", "--sync", id);
  await until(() => window.input.focused, "Focus gain not received");
  assert.equal(window.input.pointerCaptured, false);
  const initial = window.input;
  let guards = 0;
  const offGuards = window.on("key", () => {
    assert.throws(() => app.pollEvents(), /in progress/);
    assert.throws(() => app.dispose(), /in progress/);
    assert.throws(() => app.createWindow(device!), /in progress/);
    assert.throws(() => app.run(), /in progress/);
    assert.throws(() => window.draw(() => {}), /in progress/);
    assert.throws(() => window.dispose(), /in progress/);
    assert.throws(() => window.requestClose(), /in progress/);
    assert.throws(() => window.setPointerCapture(true), /in progress/);
    guards++;
  });
  await xdo("keydown", "Shift_L", "a");
  await until(() => window.isKeyDown(Key.A) && window.isKeyDown(Key.LeftShift), "Held key state missing");
  const a = events.find(event => event.type === "key" && event.key === Key.A && event.action === "press");
  assert.ok(a?.type === "key");
  assert.ok(a.modifiers & Modifier.Shift);
  assert.equal(window.isScancodeDown(a.scancode), true);
  assert.equal(initial.keys.length, 0, "Retained snapshots must not change");
  await until(() => events.some(event => event.type === "key" && event.key === Key.A && event.action === "repeat"), "OS key repeat missing");
  assert.equal(events.filter(event => event.type === "key" && event.key === Key.A && event.action === "press").length, 1);
  assert.equal(window.input.keys.filter(key => key === Key.A).length, 1);
  await xdo("keyup", "a", "Shift_L");
  await until(() => window.input.keys.length === 0, "Key releases missing");
  assert.ok(guards >= 4);
  offGuards();

  await xdo("mousemove", "--sync", "--window", id, "40", "50");
  await until(() => window.input.x === 40 && window.input.y === 50, "Initial client coordinates incorrect");
  events.length = 0;
  await xdo("mousemove", "--sync", "--window", id, "90", "80");
  await until(() => window.input.x === 90 && window.input.y === 80, "Pointer movement missing");
  assert.ok(events.some(event => event.type === "pointerMove" && event.deltaX === 50 && event.deltaY === 30 && !event.captured));
  for(const [xbutton, button] of [[1, PointerButton.Left], [2, PointerButton.Middle], [3, PointerButton.Right]] as const) {
    await xdo("mousedown", String(xbutton));
    await until(() => window.isButtonDown(button), `Button ${button} not held`);
    await xdo("mouseup", String(xbutton));
    await until(() => !window.isButtonDown(button), `Button ${button} stuck`);
    assert.ok(events.some(event => event.type === "pointerButton" && event.button === button && event.action === "release"));
  }
  for(const button of [4, 5, 6, 7]) await xdo("click", String(button));
  await until(() => events.filter(event => event.type === "scroll").length >= 4, "Scroll events missing");
  for(const [x, y] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    assert.ok(events.some(event => event.type === "scroll" && event.deltaX === x && event.deltaY === y), `Missing scroll ${x},${y}`);
  }

  // Native input remains active when the scheduler is paused.
  running = app.run({ maxFPS: 60 });
  running = running.catch(error => { loopError = error; });
  app.pause();
  window.setPointerCapture(true);
  assert.equal(window.input.pointerCaptured, true);
  assert.equal(window.input.rawMotion, false);
  await until(() => events.some(event => event.type === "pointerCapture" && event.captured), "Capture event missing");
  await xdo("mousemove_relative", "--", "20", "15");
  await setTimeout(40);
  await xdo("mousemove_relative", "--", "30", "25");
  await until(() => events.some(event => event.type === "pointerMove" && event.captured && event.deltaX !== 0 && event.deltaY !== 0), "Captured relative movement missing");
  // Explicit raw motion is either supported and observable or fails clearly.
  try {
    window.setPointerCapture(true, true);
    assert.equal(window.input.rawMotion, true);
    await xdo("mousemove_relative", "--", "12", "8");
  } catch (error) {
    assert.match(String(error), /Raw mouse motion is unavailable/);
  }
  window.setPointerCapture(false);
  assert.equal(window.input.pointerCaptured, false);
  assert.equal(window.input.rawMotion, false);
  window.setPointerCapture(true);
  await xdo("keydown", "w");
  await xdo("mousedown", "1");
  await until(() => window.isKeyDown(Key.W) && window.isButtonDown(PointerButton.Left), "Pre-blur held input missing");
  events.length = 0;
  await xdo("windowminimize", "--sync", id);
  await until(() => !window.input.focused, "Focus loss missing");
  assert.deepEqual(window.input.keys, []);
  assert.deepEqual(window.input.buttons, []);
  assert.deepEqual(window.input.scancodes, []);
  assert.equal(window.input.pointerCaptured, false);
  assert.equal(window.input.rawMotion, false);
  assert.ok(events.some(event => event.type === "key" && event.key === Key.W && event.action === "release" && event.synthetic));
  assert.ok(events.some(event => event.type === "pointerButton" && event.button === 0 && event.action === "release" && event.synthetic));
  assert.throws(() => window.setPointerCapture(true), /focused/);
  await xdo("keyup", "w");
  await xdo("mouseup", "1");
  await xdo("windowmap", "--sync", id);
  await xdo("windowactivate", "--sync", id);
  await until(() => window.input.focused, "Focus not restored");
  assert.equal(window.input.pointerCaptured, false, "Focus gain must not recapture");
  assert.equal(events.filter(event => event.type === "key" && event.key === Key.W && event.action === "release").length, 1);
  app.stop();
  await running;
  running = undefined;
  if(loopError) throw loopError;

  // Throwing input listeners preserve arbitrary values, reconcile state and permit later polls.
  const sentinel = Symbol("input callback failure");
  const offThrow = window.on("key", () => { throw sentinel; });
  await xdo("keydown", "d");
  let threw = false;
  for(let attempt = 0; attempt < 50 && !threw; attempt++) {
    await setTimeout(10);
    try { app.pollEvents(); } catch (error) { assert.equal(error, sentinel); threw = true; }
  }
  assert.equal(threw, true);
  assert.equal(window.isKeyDown(Key.D), true);
  offThrow();
  await xdo("keyup", "d");
  await until(() => !window.isKeyDown(Key.D), "State failed to recover after callback exception");

  const offAsync = Reflect.apply(window.on, window, ["key", async () => { throw new Error("async input"); }]) as () => void;
  await xdo("keydown", "s");
  await assert.rejects(app.run(), /return undefined synchronously/);
  offAsync();
  await xdo("keyup", "s");
  await until(() => !window.isKeyDown(Key.S), "Async failure left stuck input");
  window.draw(() => { assert.throws(() => window.setPointerCapture(true), /in progress/); });
  window.setPointerCapture(true);
  await xdo("keydown", "w");
  await xdo("mousedown", "1");
  await until(() => window.isKeyDown(Key.W) && window.isButtonDown(0), "Pre-close input missing");
  window.requestClose();
  assert.deepEqual(window.input.keys, []);
  assert.deepEqual(window.input.buttons, []);
  assert.equal(window.input.pointerCaptured, false);
  await xdo("keydown", "d");
  await setTimeout(30);
  assert.equal(app.pollEvents(), false);
  assert.deepEqual(window.input.keys, [], "Close-requested windows must ignore new controls");
  await xdo("keyup", "w", "d");
  await xdo("mouseup", "1");
  window.dispose();
  window.dispose();
  assert.throws(() => window.input, /disposed/);
  assert.throws(() => window.on("key", () => {}), /disposed/);
  assert.throws(() => window.setPointerCapture(true), /disposed/);
  const replacement = app.createWindow(device);
  assert.deepEqual(replacement.input.keys, []);
  assert.deepEqual(replacement.input.buttons, []);
  const replacementId = (await xdo("search", "--onlyvisible", "--pid", String(process.pid), "--name", "^ts-dawn solid color$")).split("\n")[0]!;
  await xdo("windowactivate", "--sync", replacementId);
  await until(() => replacement.input.focused, "Replacement window not focused");
  replacement.setPointerCapture(true);
  await xdo("keydown", "a");
  await until(() => replacement.isKeyDown(Key.A), "Replacement held state missing");
  app.dispose(); // Dispose with capture and a held key still active.
  assert.throws(() => replacement.input, /disposed/);
  console.log(`${process.versions.bun ? "Bun" : "Node.js"}: real X11 keys, repeats, modifiers, pointer, buttons, scroll, capture, focus reset, callback failures and lifecycle passed.`);
} finally {
  // Ensure a failed assertion never leaves injected desktop input held.
  await xdo("keyup", "a", "w", "d", "s", "Shift_L").catch(() => {});
  await xdo("mouseup", "1").catch(() => {});
  app.stop();
  await running;
  try { app.dispose(); } finally { device?.destroy(); }
}
