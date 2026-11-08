import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Application, Key, type Window } from "../../index.ts";
import { getWindowGPUContextController } from "../../packages/core/context.ts";

// Load the real example after installing timing hooks. Flags are the example's
// usual --no-vsync and --max-fps options; measurements are CPU wall times.
const duration = Number(process.env.HOSTFRAME_PROFILE_MS ?? "15000");
const warmup = 3000;
assert.ok(Number.isFinite(duration) && duration >= 6000, "HOSTFRAME_PROFILE_MS must be at least 6000");
const intervals: number[] = [];
const draws: Array<{ beforeCallback: number, callback: number, afterCallback: number, total: number }> = [];
const stalls: Array<{ at: number, interval: number, draw: (typeof draws)[number] | undefined }> = [];
let started = 0;
let measuredFrom = 0;
let previous = 0;
let frames = 0;
let updates = 0;
let skipped = 0;
let droppedTime = 0;
let scatterPresses = 0;
let scatter: Promise<void> | undefined;
let failure: unknown;
const execute = promisify(execFile);

async function xdo(...args: string[]) {
  const result = await execute("xdotool", args, { timeout: 3000 });
  return result.stdout.trim();
}

async function sendScatter() {
  const id = (await xdo("search", "--onlyvisible", "--pid", String(process.pid))).split("\n")[0];
  assert.ok(id, "Physics window was not found");
  await xdo("windowactivate", "--sync", id);
  await xdo("key", "--window", id, "space");
}

function percentile(values: number[], fraction: number) {
  const ordered = values.toSorted((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))] ?? 0;
}

const createWindow = Application.prototype.createWindow;
let capturedWindow: Window;
Application.prototype.createWindow = function profileWindow(options) {
  const window = createWindow.call(this, options);
  capturedWindow = window;
  window.on("key", event => {
    if(event.key === Key.SPACE && event.action === "press") scatterPresses++;
  });
  const context = window.getContext("webgpu");
  const controller = getWindowGPUContextController(context);
  const originalRender = controller.render.bind(controller);
  controller.render = function profileRender(callback) {
    const before = performance.now();
    let entered: number | undefined;
    let exited = before;
    const didDraw = originalRender(() => {
      entered = performance.now();
      const result = callback();
      exited = performance.now();
      return result;
    });
    const ended = performance.now();
    if(!started || before - started < warmup) return didDraw;
    if(entered === undefined) {
      skipped++;
      return didDraw;
    }
    draws.push({ beforeCallback: entered - before, callback: exited - entered, afterCallback: ended - exited, total: ended - before });
    return didDraw;
  };
  return window;
};

const run = Application.prototype.run;
Application.prototype.run = async function profileRun(options) {
  const adapter = await this.gpu.requestAdapter();
  assert.ok(adapter);
  if(process.env.HOSTFRAME_EXPECT_VENDOR) {
    assert.equal(adapter.info.vendor, process.env.HOSTFRAME_EXPECT_VENDOR);
    assert.equal(adapter.info.isFallbackAdapter, false);
  }
  this.on("fixedUpdate", () => {
    const elapsed = performance.now() - started;
    if(elapsed >= 2000) {
      scatter ??= sendScatter().catch(error => { failure = error; this.stop(); });
    }
    if(elapsed >= warmup) updates++;
  });
  capturedWindow.on("render", event => {
    const now = performance.now();
    if(now - started >= warmup) {
      measuredFrom ||= now;
      frames++;
      droppedTime += event.droppedTime;
      if(previous) {
        const interval = now - previous;
        intervals.push(interval);
        if(interval > 30) stalls.push({ at: now - started, interval, draw: draws.at(-1) });
      }
      previous = now;
    }
    if(now - started >= duration) this.stop();
  });
  started = performance.now();
  await run.call(this, options);
  await scatter;
  if(failure) throw failure;
  assert.equal(scatterPresses, 1, "The real example must receive the scatter key press");
  assert.ok(previous - started >= duration, "Physics profile stopped before completion");
  const elapsed = previous - measuredFrom;
  console.log(JSON.stringify({
    runtime: process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.versions.node}`,
    vendor: adapter.info.vendor,
    fallback: adapter.info.isFallbackAdapter,
    options,
    elapsedMs: elapsed,
    frames,
    fps: intervals.length * 1000 / elapsed,
    updateHz: updates * 1000 / elapsed,
    skipped,
    droppedTime,
    scatterPresses,
    frameP50Ms: percentile(intervals, 0.5),
    frameP95Ms: percentile(intervals, 0.95),
    frameP99Ms: percentile(intervals, 0.99),
    frameMaxMs: percentile(intervals, 1),
    draws: Object.fromEntries((["beforeCallback", "callback", "afterCallback", "total"] as const).map(stage => {
      const values = draws.map(draw => draw[stage]);
      return [stage, { p50Ms: percentile(values, 0.5), p99Ms: percentile(values, 0.99), maxMs: percentile(values, 1) }];
    })),
    stalls
  }));
};

await import("../../examples/three/physics.ts");
