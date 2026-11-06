import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { assertFramebufferSize } from "./framebuffer.ts";
import { installWebGPUGlobals, getProcessGPU, NativeApplication } from "../bridge.ts";
import type * as Native from "../../../build/native/generated/native";

const require = createRequire(import.meta.url);
const addon: typeof Native = require("../../../build/native/cmake/hostframe.node");
assert.throws(() => Reflect.construct(addon.Window, []), TypeError);
assert.equal(Object.getOwnPropertyDescriptor(addon, "__typescript")?.writable, false);
installWebGPUGlobals();

const app = new NativeApplication();
let device: GPUDevice | undefined;
try {
  const gpu = getProcessGPU();
  const adapter = await gpu.requestAdapter();
  assert.ok(adapter);
  device = await adapter.requestDevice();
  for(const fake of [{}, app, device, Object.create(GPU.prototype)]) {
    assert.throws(() => Reflect.apply(app.createWindow, app, [fake]));
  }
  const sentinel = Symbol("options getter failure");
  assert.throws(() => app.createWindow(gpu, { get title(): string { throw sentinel; } }), error => error === sentinel);
  assert.throws(() => app.createWindow(gpu, { get width(): number { app.dispose(); return 320; } }), /in progress/);
  for(const options of [null, [], { width: 0 }, { height: Infinity }, { width: 1.5 }, { title: "a\0b" }, { resizable: 1 }]) {
    assert.throws(() => Reflect.apply(app.createWindow, app, [gpu, options]));
  }
  const window = app.createWindow(gpu); // Optional argument through nobind itself.
  try {
    window.configure({ device, format: gpu.getPreferredCanvasFormat() });
    assert.equal(window.disposed, false);
    assert.equal(window.presentMode, "fifo");
    assert.equal(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window), "disposed")?.set, undefined);
    assert.throws(() => Reflect.apply(window.renderFrame, window, [null]), TypeError);
    assert.throws(() => Reflect.apply(window.setPointerCapture, window, [1, false]), TypeError);
    assert.throws(() => Reflect.apply(window.dispatchInput, window, [() => 1]), /synchronously/);
    assert.throws(() => window.dispatchInput(() => { throw sentinel; }), error => error === sentinel);
    window.dispatchInput((state, events) => {
      assert.deepEqual(state.keys, []);
      assert.ok(Array.isArray(events));
      assert.throws(() => window.dispose(), /in progress/);
      assert.throws(() => app.pollEvents(), /in progress/);
    });
    window.renderFrame(texture => {
      assert.ok(texture instanceof GPUTexture, "Surface texture must retain Dawn's wrapper");
      assertFramebufferSize(texture, 320, 240);
      assert.ok(texture.createView() instanceof GPUTextureView);
      assert.throws(() => window.renderFrame(() => {}), /in progress/);
    });
    assert.throws(() => window.renderFrame(() => { throw sentinel; }), error => error === sentinel);
    assert.throws(() => Reflect.apply(window.renderFrame, window, [() => 1]), /synchronously/);
    window.renderFrame(() => {});
  } finally {
    window.dispose();
  }
  assert.equal(window.disposed, true);
  window.dispose();
  assert.throws(() => window.renderFrame(() => {}), /disposed/);
  const replacement = app.createWindow(gpu, undefined);
  app.dispose();
  assert.equal(replacement.disposed, true);
  replacement.dispose();
} finally {
  try { app.dispose(); } finally { device?.destroy(); }
}
console.log(`${process.versions.bun ? "Bun" : "Node.js"}: nobind typed boundaries, Dawn wrappers, guarded getters, callbacks and disposal passed.`);
