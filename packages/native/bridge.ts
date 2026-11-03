import { createRequire } from "node:module";
import type * as Native from "../../build/native/generated/native";

export type { WindowOptions, PresentMode } from "../../build/native/generated/native";
export type NativeWindow = Native.Window;
export type NativeApplication = Native.Application;

const require = createRequire(import.meta.url);
// tsdown replaces this path when the bridge is bundled into dist/index.js.
declare const __HOSTFRAME_ADDON__: string;
const addon: typeof Native = require(typeof __HOSTFRAME_ADDON__ === "string"
  ? __HOSTFRAME_ADDON__
  : "../../build/native/cmake/hostframe.node");

// Experimental bridge: upstream child objects do not retain their GPU owner.
// Keep one owner rooted through callbacks, GC, and runtime teardown in both runtimes.
// This deliberately lasts until process exit, independently of window disposal.
const ownerKey = Symbol.for("hostframe.experimental.gpu");

export function getProcessGPU() {
  Object.assign(globalThis, addon.globals);
  const existing = Reflect.get(globalThis, ownerKey) as GPU | undefined;
  if(existing) return existing;
  const gpu = addon.create([]);
  Object.defineProperty(globalThis, ownerKey, { value: gpu });
  return gpu;
}

export const NativeApplication = addon.Application;
