import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { checkAdapter } from "./adapter.ts";
import type * as Native from "../../../build/native/generated/native";

const require = createRequire(import.meta.url);
const addon: typeof Native = require("../../../build/native/cmake/ts_dawn.node");
Object.assign(globalThis, addon.globals);
assert.throws(() => addon.create(["invalid-flag"]), /key=value/);

// The upstream binding does not retain its originating GPU through child objects.
// Pin it for the process lifetime, including queued callbacks and runtime teardown.
const gpu = addon.create([]);
Object.defineProperty(globalThis, "__tsDawnSmokeOwner", { value: gpu });
const adapter = await gpu.requestAdapter();
assert.ok(adapter, "No compatible GPU adapter; check Vulkan drivers and permissions.");
checkAdapter(adapter);
const device = await adapter.requestDevice();
const failures: string[] = [];
device.addEventListener("uncapturederror", event => failures.push(event.error.message));
const input = new Uint32Array([0, 1, 7, 42]);
const storage = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
const readback = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
try {
  device.queue.writeBuffer(storage, 0, input);
  const module = device.createShaderModule({ code: `
    @group(0) @binding(0) var<storage, read_write> values: array<u32>;
    @compute @workgroup_size(1)
    fn main(@builtin(global_invocation_id) id: vec3u) {
      values[id.x] = values[id.x] * 2u + 1u;
    }
  ` });
  const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: storage } }] });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(input.length);
  pass.end();
  encoder.copyBufferToBuffer(storage, 0, readback, 0, input.byteLength);
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  assert.deepEqual([...new Uint32Array(readback.getMappedRange())], [1, 3, 15, 85]);
  readback.unmap();
  await device.queue.onSubmittedWorkDone();
  assert.deepEqual(failures, []);
  console.log(`${process.versions.bun ? "Bun" : "Node.js"}: WebGPU compute/readback passed.`);
} finally {
  storage.destroy();
  readback.destroy();
  device.destroy();
}
