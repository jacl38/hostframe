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
  const existing = Reflect.get(globalThis, ownerKey) as GPU | undefined;
  if(existing) return existing;
  const gpu = addon.create([]);
  Object.defineProperty(globalThis, ownerKey, { value: gpu });
  return gpu;
}

export const NativeApplication = addon.Application;
export const webGPUGlobals = addon.globals;

/** Installs missing WebGPU globals; rejects foreign values and accessors before writing. */
export function installWebGPUGlobals() {
  const missing: PropertyDescriptorMap = {};
  for(const [name, value] of Object.entries(addon.globals)) {
    let owner: object | null = globalThis;
    let descriptor: PropertyDescriptor | undefined;
    while(owner) {
      descriptor = Object.getOwnPropertyDescriptor(owner, name);
      if(descriptor) break;
      owner = Object.getPrototypeOf(owner);
    }
    if(descriptor) {
      if(!Object.hasOwn(descriptor, "value") || !Object.is(descriptor.value, value)) {
        throw new TypeError(`Conflicting WebGPU global: ${name}`);
      }
    } else {
      missing[name] = { value, writable: true, configurable: true, enumerable: true };
    }
  }
  if(Object.keys(missing).length && !Object.isExtensible(globalThis)) {
    throw new TypeError("Cannot install WebGPU globals on a nonextensible globalThis");
  }
  Object.defineProperties(globalThis, missing);
}
