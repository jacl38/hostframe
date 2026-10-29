import { setTimeout } from "node:timers/promises";
import { Application } from "../index.ts";

const app = new Application();
let device: GPUDevice | undefined;
try {
  const adapter = await app.gpu.requestAdapter();
  if(!adapter) throw new Error("No compatible GPU adapter");
  device = await adapter.requestDevice();
  const renderingDevice = device;
  const window = app.createWindow(renderingDevice);
  for(let frame = 0; frame < 180; frame++) {
    window.draw(texture => {
      const encoder = renderingDevice.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: texture.createView(),
          clearValue: { r: 0.05, g: 0.1, b: 0.8, a: 1 },
          loadOp: "clear",
          storeOp: "store"
        }]
      });
      pass.end();
      renderingDevice.queue.submit([encoder.finish()]);
    });
    await setTimeout(16);
  }
  await device.queue.onSubmittedWorkDone();
} finally {
  try {
    app.dispose();
  } finally {
    device?.destroy();
  }
}
