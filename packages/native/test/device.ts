import assert from "node:assert/strict";

export async function assertDeviceAlive(device: GPUDevice) {
  const buffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    device.queue.writeBuffer(buffer, 0, new Uint32Array([42]));
    await buffer.mapAsync(GPUMapMode.READ);
    assert.equal(new Uint32Array(buffer.getMappedRange())[0], 42);
    buffer.unmap();
  } finally {
    buffer.destroy();
  }
}
