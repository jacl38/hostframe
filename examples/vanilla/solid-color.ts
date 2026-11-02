import { createExample } from "../shared/application.ts";

// --no-vsync requests Immediate/Mailbox; --max-fps=30 caps rendering only.
const example = await createExample("vanilla / solid color", { width: 640, height: 480, maxFPS: undefined });
try {
  const { device } = example;
  console.log(`Present mode: ${example.window.presentMode}`);
  let ticks = 0;
  example.app.on("fixedUpdate", () => { ticks++; });
  example.app.on("render", () => {
    example.draw(texture => {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{
        view: texture.createView(), clearValue: [0.05, 0.1, 0.8, 1], loadOp: "clear", storeOp: "store"
      }] });
      pass.end();
      device.queue.submit([encoder.finish()]);
    });
    // Preserve the introductory demo's three-second lifetime, unless bounded by frames.
    if(ticks >= 360 && !process.argv.some(arg => arg.startsWith("--frames="))) example.app.stop();
  });
  await example.run();
} finally {
  await example.dispose();
}
