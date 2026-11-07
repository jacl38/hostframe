import { Key, PointerButton } from "../../index.ts";
import { createExample } from "../shared/application.ts";

// WASD/arrows move the square; pointer motion steers it while captured.
// Left click toggles capture, Escape releases it, wheel changes its size, Q quits.
const example = await createExample("vanilla / input", { width: 800, height: 500, escapeQuits: false });
const { app, device, window } = example;
try {
  const renderingDevice = device;
  const shader = device.createShaderModule({ code: `
    @vertex fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
      let p = array(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(-1,1), vec2f(1,-1), vec2f(1,1));
      return vec4f(p[i], 0, 1);
    }
    @fragment fn fragment() -> @location(0) vec4f { return vec4f(0.2, 0.85, 0.6, 1); }
  ` });
  let pipeline: GPURenderPipeline | undefined;
  let x = 0.5;
  let y = 0.5;
  let size = 40;
  const enteredText: string[] = [];
  window.on("key", event => {
    if(event.action !== "press") return; // OS repeat never drives simulation.
    if(event.key === Key.ESCAPE) window.setPointerCapture(false);
    if(event.key === Key.Q) window.requestClose();
  });
  window.on("pointerButton", event => {
    if(event.button === PointerButton.LEFT && event.action === "press") window.setPointerCapture(!window.input.pointerCaptured);
  });
  window.on("pointerMove", event => {
    if(event.captured) {
      if(window.metrics.drawable) {
        x += event.deltaX / window.metrics.width;
        y += event.deltaY / window.metrics.height;
      }
    } else {
      const pixel = window.toFramebuffer(event.x, event.y);
      if(pixel) {
        x = pixel.x / window.metrics.framebufferWidth;
        y = pixel.y / window.metrics.framebufferHeight;
      }
    }
  });
  window.on("scroll", event => { size = Math.max(10, Math.min(200, size + event.deltaY * 5)); });
  window.on("focus", event => {
    console.log(`Focus ${event.focused ? "gained" : "lost"}; held keys: ${window.input.keys.length}`);
  });
  window.on("pointerCapture", event => { console.log(`Pointer capture ${event.captured ? "on" : "off"}`); });
  window.on("text", event => {
    enteredText.push(String.fromCodePoint(event.codepoint));
    if(enteredText.length > 80) enteredText.shift();
    console.log(`Text input: ${enteredText.join("")}`);
  });
  app.on("fixedUpdate", ({ dt }) => {
    x += (Number(window.isKeyDown(Key.D) || window.isKeyDown(Key.RIGHT)) - Number(window.isKeyDown(Key.A) || window.isKeyDown(Key.LEFT))) * dt * 0.5;
    y += (Number(window.isKeyDown(Key.S) || window.isKeyDown(Key.DOWN)) - Number(window.isKeyDown(Key.W) || window.isKeyDown(Key.UP))) * dt * 0.5;
    x = Math.max(0, Math.min(1, x));
    y = Math.max(0, Math.min(1, y));
  });
  window.on("render", () => {
    const texture = example.context.getCurrentTexture();
    pipeline ??= renderingDevice.createRenderPipeline({ layout: "auto", vertex: { module: shader, entryPoint: "vertex" }, fragment: { module: shader, entryPoint: "fragment", targets: [{ format: texture.format }] } });
    const encoder = renderingDevice.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{
      view: texture.createView(),
      clearValue: window.input.focused ? { r: 0.04, g: 0.08, b: 0.15, a: 1 } : { r: 0.1, g: 0.1, b: 0.1, a: 1 },
      loadOp: "clear",
      storeOp: "store"
    }] });
    pass.setPipeline(pipeline);
    const width = Math.min(size, texture.width);
    const height = Math.min(size, texture.height);
    pass.setViewport(Math.max(0, Math.min(texture.width - width, x * texture.width - width / 2)), Math.max(0, Math.min(texture.height - height, y * texture.height - height / 2)), width, height, 0, 1);
    pass.draw(6);
    pass.end();
    renderingDevice.queue.submit([encoder.finish()]);
  });
  console.log("WASD/arrows move; left click captures; Escape releases; wheel resizes; Q quits. Other text logs through the text event.");
  await example.run();
} finally {
  await example.dispose();
}
