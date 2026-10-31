import { createRequire } from "node:module";

export type WindowOptions = {
  /** Default: true (FIFO). False prefers Immediate, then Mailbox; throws if neither is supported. */
  vsync?: boolean
};

export type PresentMode = "fifo" | "immediate" | "mailbox";

export type FixedWindow = {
  /** Selected from Dawn surface capabilities at creation. Throws after disposal. */
  readonly presentMode: PresentMode,
  /** Close requests do not dispose the window. Throws after disposal. */
  readonly shouldClose: boolean,
  requestClose(): void,
  /** Submit before returning; textures/views expire afterward. Async results are rejected. */
  draw(callback: (texture: GPUTexture) => undefined): void,
  /** Unregisters from the application; forbidden inside draw. Idempotent. */
  dispose(): void
};

export type NativeApplication = {
  createWindow(device: GPUDevice, options?: WindowOptions): FixedWindow,
  pollEvents(): boolean,
  readonly hasOpenWindows: boolean,
  readonly disposed: boolean,
  dispose(): void
};

const require = createRequire(import.meta.url);
const addon: {
  globals: Record<string, unknown>,
  create(flags: string[]): GPU,
  Application: new () => NativeApplication
} = require("../../build/native/cmake/ts_dawn.node");

// Experimental bridge: upstream child objects do not retain their GPU owner.
// Keep one owner rooted through callbacks, GC, and runtime teardown in both runtimes.
// This deliberately lasts until process exit, independently of window disposal.
const ownerKey = Symbol.for("ts-dawn.experimental.gpu");

export function getProcessGPU() {
  Object.assign(globalThis, addon.globals);
  const existing = Reflect.get(globalThis, ownerKey) as GPU | undefined;
  if(existing) return existing;
  const gpu = addon.create([]);
  Object.defineProperty(globalThis, ownerKey, { value: gpu });
  return gpu;
}

export const NativeApplication = addon.Application;
