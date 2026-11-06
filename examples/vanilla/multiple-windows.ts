import { Key } from "../../index.ts";
import { createExample } from "../shared/application.ts";

const example = await createExample("multiple windows / blue", { width: 480, height: 320 });
try {
  const { app, device, window: blue, context: blueContext } = example;
  const orange = app.createWindow({
    title: "hostframe multiple windows / orange",
    width: 360,
    height: 280,
    resizable: true,
    vsync: !process.argv.includes("--no-vsync")
  });
  const orangeContext = orange.getContext("webgpu");
  // configure checks this device's adapter against the second surface too.
  orangeContext.configure({ device, format: app.gpu.getPreferredCanvasFormat() });
  orange.on("key", event => {
    if(event.action === "press" && (event.key === Key.Q || event.key === Key.ESCAPE)) orange.requestClose();
  });
  let elapsed = 0;
  app.on("fixedUpdate", ({ dt }) => { elapsed += dt; });
  for(const [window, context, color] of [
    [blue, blueContext, [0.05, 0.2, 0.85, 1]],
    [orange, orangeContext, [1, 0.28, 0.04, 1]]
  ] as const) {
    let bright = true;
    window.on("pointerButton", event => {
      if(event.action === "press") bright = !bright;
    });
    window.on("render", () => {
      const encoder = device.createCommandEncoder();
      const intensity = bright ? 0.8 + 0.2 * Math.sin(elapsed * 2) : 0.3;
      const pass = encoder.beginRenderPass({ colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: [color[0] * intensity, color[1] * intensity, color[2] * intensity, 1],
        loadOp: "clear",
        storeOp: "store"
      }] });
      pass.end();
      device.queue.submit([encoder.finish()]);
    });
  }
  console.log("Click either window to dim it; Q/Escape closes only that window. Close both to exit.");
  // Bound gallery verification by the blue window's frames; interactive runs
  // continue after either window closes until the final open window closes.
  await example.run();
} finally {
  await example.dispose();
}
