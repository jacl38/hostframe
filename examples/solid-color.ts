import { setTimeout } from "node:timers/promises";
import { createGPU, createWindow } from "../packages/native/bridge.ts";

const gpu = createGPU();
const adapter = await gpu.requestAdapter();
if(!adapter) throw new Error("No compatible GPU adapter");
const device = await adapter.requestDevice();
try {
  const window = createWindow(device);
  try {
    for(let frame = 0; frame < 180; frame++) {
      window.draw(texture => {
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: texture.createView(),
            clearValue: { r: 0.05, g: 0.1, b: 0.8, a: 1 },
            loadOp: "clear",
            storeOp: "store"
          }]
        });
        pass.end();
        device.queue.submit([encoder.finish()]);
      });
      await setTimeout(16);
    }
    await device.queue.onSubmittedWorkDone();
  } finally {
    window.dispose();
  }
} finally {
  device.destroy();
}
