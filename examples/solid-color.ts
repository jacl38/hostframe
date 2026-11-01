import { Application } from "../index.ts";

// Drag the window edges to resize. --no-vsync requests Immediate/Mailbox; --max-fps=30 caps rendering only.
const args = process.argv.slice(2);
if(args.some(arg => arg !== "--no-vsync" && !arg.startsWith("--max-fps="))) {
  throw new Error("Usage: solid-color.ts [--no-vsync] [--max-fps=<positive number>]");
}
const vsync = !args.includes("--no-vsync");
const fpsArgument = args.find(arg => arg.startsWith("--max-fps="));
const maxFPS = fpsArgument === undefined ? undefined : Number(fpsArgument.slice("--max-fps=".length));

const app = new Application();
let device: GPUDevice | undefined;
try {
  const adapter = await app.gpu.requestAdapter();
  if(!adapter) throw new Error("No compatible GPU adapter");
  console.log(`Adapter: ${adapter.info.vendor}, ${adapter.info.device}; fallback: ${adapter.info.isFallbackAdapter}`);
  device = await adapter.requestDevice();
  const renderingDevice = device;
  const window = app.createWindow(renderingDevice, {
    title: "ts-dawn solid color",
    width: 640,
    height: 480,
    resizable: true,
    vsync
  });
  console.log(`Present mode: ${window.presentMode}; render cap: ${maxFPS ?? "uncapped"}`);
  let ticks = 0;
  app.on("fixedUpdate", () => { ticks++; });
  app.on("render", () => {
    window.draw(texture => {
      // texture.width/height are current framebuffer pixels, including high-DPI scaling.
      // Size dependent attachments should follow these dimensions inside this callback.
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
  await app.run({ updateHz: 120, maxFPS });
  await device.queue.onSubmittedWorkDone();
} finally {
  try {
    app.dispose();
  } finally {
    device?.destroy();
  }
}
