import { createRequire } from "node:module";
import type { InputEvent, InputState } from "../core/input.ts";

export type WindowOptions = {
  /** Default: "ts-dawn solid color". */
  title?: string,
  /** Initial client size in screen coordinates; positive signed 32-bit integers. Defaults: 320×240. */
  width?: number,
  height?: number,
  /** Default: false. Allows the window manager to resize the window. */
  resizable?: boolean,
  /** Default: true (FIFO). False prefers Immediate, then Mailbox; throws if neither is supported. */
  vsync?: boolean
};

export type PresentMode = "fifo" | "immediate" | "mailbox";

export type NativeWindow = {
  readonly disposed: boolean,
  dispatchInput(callback: (state: InputState, events: InputEvent[]) => undefined): void,
  setPointerCapture(captured: boolean, rawMotion: boolean): InputState,
  /** Selected from Dawn surface capabilities at creation. Throws after disposal. */
  readonly presentMode: PresentMode,
  /** Close requests do not dispose the window. Throws after disposal. */
  readonly shouldClose: boolean,
  requestClose(): InputState,
  /**
   * Submit before returning; textures/views expire afterward. Async results are rejected.
   * Texture dimensions are framebuffer pixels. Skips the callback while minimized,
   * at zero framebuffer size, or if acquisition is temporarily unavailable.
   */
  draw(callback: (texture: GPUTexture) => undefined): void,
  /** Unregisters from the application; forbidden inside draw. Idempotent. */
  dispose(): void
};

export type NativeApplication = {
  createWindow(device: GPUDevice, options?: WindowOptions): NativeWindow,
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
