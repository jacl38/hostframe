import { createRequire } from "node:module";

export type FixedWindow = {
  /** Submit before returning; textures/views expire afterward. Async results are rejected. */
  draw(callback: (texture: GPUTexture) => undefined): void,
  /** Idempotent; forbidden inside draw. A cleanup timeout destroys the caller's device. */
  dispose(): void
};

const require = createRequire(import.meta.url);
const addon: {
  globals: Record<string, unknown>,
  create(flags: string[]): GPU,
  Window: new (device: GPUDevice) => FixedWindow
} = require("../../build/native/cmake/ts_dawn.node");

// Experimental bridge: upstream child objects do not retain their GPU owner.
// Keep one owner rooted through callbacks, GC, and runtime teardown in both runtimes.
// This deliberately lasts until process exit, independently of window disposal.
const ownerKey = Symbol.for("ts-dawn.experimental.gpu");

export function createGPU() {
  Object.assign(globalThis, addon.globals);
  const existing = Reflect.get(globalThis, ownerKey) as GPU | undefined;
  if(existing) return existing;
  const gpu = addon.create([]);
  Object.defineProperty(globalThis, ownerKey, { value: gpu });
  return gpu;
}

/** One fixed 320×240 window, on the main thread, using a device from createGPU(). */
export function createWindow(device: GPUDevice) {
  return new addon.Window(device);
}
