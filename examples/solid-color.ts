import { Application } from "../index.ts";

const app = new Application();
let device: GPUDevice | undefined;
try {
  const adapter = await app.gpu.requestAdapter();
  if(!adapter) throw new Error("No compatible GPU adapter");
  device = await adapter.requestDevice();
  const renderingDevice = device;
  const window = app.createWindow(renderingDevice);
  let ticks = 0;
  app.on("fixedUpdate", () => { ticks++; });
  app.on("render", () => {
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
    // Three seconds of simulated time; OS close requests also stop run normally.
    if(ticks >= 360) app.stop();
  });
  await app.run({ updateHz: 120 });
  await device.queue.onSubmittedWorkDone();
} finally {
  try {
    app.dispose();
  } finally {
    device?.destroy();
  }
}
