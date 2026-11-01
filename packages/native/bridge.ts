import { createRequire } from "node:module";
import type * as Native from "../../build/native/generated/native";

export type { WindowOptions, PresentMode } from "../../build/native/generated/native";
export type NativeWindow = Native.Window;
export type NativeApplication = Native.Application;

const require = createRequire(import.meta.url);
const addon: typeof Native = require("../../build/native/cmake/ts_dawn.node");

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
