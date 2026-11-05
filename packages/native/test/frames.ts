import assert from "node:assert/strict";
import type { Application, Window } from "../../../index.ts";

/** Exercises scheduling and presentation through the public window event API. */
export async function renderFrames(app: Application, window: Window, count = 1) {
  let rendered = 0;
  const off = window.on("render", () => {
    if(++rendered === count) app.stop();
  });
  try {
    await app.run({ maxFPS: 240 });
    assert.equal(rendered, count);
  } finally {
    off();
  }
}

export function configureWindow(app: Application, window: Window, device: GPUDevice) {
  const context = window.getContext("webgpu");
  context.configure({ device, format: app.gpu.getPreferredCanvasFormat() });
  return context;
}
