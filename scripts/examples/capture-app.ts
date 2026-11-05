import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { Application, type Window } from "../../index.ts";

// Capture the real entry point. Profiling and X11 automation stay outside demos.
const [entry, directory, runtime] = process.argv.slice(2);
assert.ok(entry && directory && runtime);
process.argv.splice(2, process.argv.length - 2, "--max-fps=10000");
const timeline: Array<{ at: number, interval: number, dropped: number }> = [];
const keys: number[] = [];
let moves = 0;
let resizes = 0;
let mode = "";
const createWindow = Application.prototype.createWindow;
let capturedWindow: Window;
Application.prototype.createWindow = function captureWindow(options) {
  const window = createWindow.call(this, options);
  capturedWindow = window;
  window.on("key", event => { if(event.action === "press") keys.push(event.key); });
  window.on("pointerMove", () => { moves++; });
  const context = window.getContext("webgpu");
  const configure = context.configure.bind(context);
  context.configure = configuration => {
    configure(configuration);
    mode = window.presentMode;
  };
  let width = 0;
  let height = 0;
  window.on("render", () => {
    const texture = context.getCurrentTexture();
    if(width && (width !== texture.width || height !== texture.height)) resizes++;
    width = texture.width;
    height = texture.height;
  });
  return window;
};
const run = Application.prototype.run;
Application.prototype.run = async function captureRun(options) {
  const adapter = await this.gpu.requestAdapter();
  assert.ok(adapter);
  assert.equal(adapter.info.isFallbackAdapter, false, "Capture requires a hardware GPU");
  capturedWindow.on("render", event => {
    timeline.push({ at: performance.timeOrigin + performance.now(), interval: event.frameTime * 1000, dropped: event.droppedTime });
    if(timeline.length === 30) writeFileSync(`${directory}/ready.json`, JSON.stringify({ runtime, entry, adapter: adapter.info.device }));
  });
  await run.call(this, options);
  writeFileSync(`${directory}/timing.json`, JSON.stringify({
    entry, runtime, adapter: { device: adapter.info.device, vendor: adapter.info.vendor, fallback: adapter.info.isFallbackAdapter },
    mode, keys, moves, resizes, timeline
  }));
};
await import(`../../examples/three/${entry}.ts`);
