import assert from "node:assert/strict";
import { installWebGPUGlobals } from "../../../index.ts";

assert.equal(Object.hasOwn(globalThis, "GPU"), false);
const inherited = Object.getPrototypeOf(globalThis);
Object.defineProperty(inherited, "GPU", {
  get() { throw new Error("Getter must not run"); },
  configurable: true
});
assert.throws(installWebGPUGlobals, /Conflicting WebGPU global/);
assert.equal(Object.hasOwn(globalThis, "GPUBufferUsage"), false);
Reflect.deleteProperty(inherited, "GPU");
Object.defineProperty(globalThis, "GPU", {
  get() { throw new Error("Own getter must not run"); },
  configurable: true
});
assert.throws(installWebGPUGlobals, /Conflicting WebGPU global/);
assert.equal(Object.hasOwn(globalThis, "GPUBufferUsage"), false);
Reflect.deleteProperty(globalThis, "GPU");
Object.defineProperty(globalThis, "GPU", { value: class ForeignGPU {}, configurable: true });
const foreign = Object.getOwnPropertyDescriptor(globalThis, "GPU");
assert.throws(installWebGPUGlobals, /Conflicting WebGPU global/);
assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, "GPU"), foreign);
assert.equal(Object.hasOwn(globalThis, "GPUBufferUsage"), false);
Reflect.deleteProperty(globalThis, "GPU");
if(process.argv.includes("--nonextensible")) {
  Object.preventExtensions(globalThis);
  assert.throws(installWebGPUGlobals, /nonextensible/);
  assert.equal(Object.hasOwn(globalThis, "GPU"), false);
} else {
  installWebGPUGlobals();
  const constructor = GPU;
  Object.defineProperty(globalThis, "GPU", { writable: false });
  installWebGPUGlobals();
  assert.equal(GPU, constructor);
}
console.log("WebGPU global policy passed");
