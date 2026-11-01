import { Application, Key, PointerButton } from "../index.ts";

// WASD/arrows move the square; pointer motion steers it while captured.
// Left click toggles capture, Escape releases it, wheel changes its size, Q quits.
const app = new Application();
let device: GPUDevice | undefined;
try {
  const adapter = await app.gpu.requestAdapter();
  if(!adapter) throw new Error("No compatible adapter");
  device = await adapter.requestDevice();
  const renderingDevice = device;
  const window = app.createWindow(device, {
    title: "ts-dawn input: WASD/arrows | click capture | Esc release | wheel size | Q quit",
    width: 800,
    height: 500,
    resizable: true
  });
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
  let capture: boolean | undefined;
  let close = false;
  window.on("key", event => {
    if(event.action !== "press") return; // OS repeat never drives simulation.
    if(event.key === Key.Escape) capture = false;
    if(event.key === Key.Q) close = true;
  });
  window.on("pointerButton", event => {
    if(event.button === PointerButton.Left && event.action === "press") capture = !window.input.pointerCaptured;
  });
  window.on("pointerMove", event => {
    if(event.captured) {
      x += event.deltaX / 800;
      y += event.deltaY / 500;
    }
  });
  window.on("scroll", event => { size = Math.max(10, Math.min(200, size + event.deltaY * 5)); });
  window.on("focus", event => {
    if(!event.focused) capture = undefined;
    console.log(`Focus ${event.focused ? "gained" : "lost"}; held keys: ${window.input.keys.length}`);
  });
  window.on("pointerCapture", event => { console.log(`Pointer capture ${event.captured ? "on" : "off"}`); });
  app.on("fixedUpdate", ({ dt }) => {
    // Native mutations are deferred until input dispatch has left its operation guard.
    if(close) { window.requestClose(); return; }
    if(capture !== undefined) {
      if(!capture || window.input.focused) window.setPointerCapture(capture);
      capture = undefined;
    }
    x += (Number(window.isKeyDown(Key.D) || window.isKeyDown(Key.Right)) - Number(window.isKeyDown(Key.A) || window.isKeyDown(Key.Left))) * dt * 0.5;
    y += (Number(window.isKeyDown(Key.S) || window.isKeyDown(Key.Down)) - Number(window.isKeyDown(Key.W) || window.isKeyDown(Key.Up))) * dt * 0.5;
    x = Math.max(0, Math.min(1, x));
    y = Math.max(0, Math.min(1, y));
  });
  app.on("render", () => {
    window.draw(texture => {
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
  });
  console.log("WASD/arrows move; left click captures; Escape releases; wheel resizes; Q quits.");
  await app.run({ updateHz: 120, maxFPS: 60 });
} finally {
  try { app.dispose(); } finally { device?.destroy(); }
}
