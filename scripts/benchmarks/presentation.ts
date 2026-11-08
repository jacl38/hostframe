import assert from "node:assert/strict";
import { Application } from "../../index.ts";
import { getWindowGPUContextController } from "../../packages/core/context.ts";

// Usage: node|bun scripts/benchmarks/presentation.ts <clear|shader> <on|off> <uncapped|FPS> [milliseconds]
const [workload = "clear", vsyncArgument = "off", cap = "uncapped", durationArgument = "3000"] = process.argv.slice(2);
assert.ok(workload === "clear" || workload === "shader");
assert.ok(vsyncArgument === "on" || vsyncArgument === "off");
const maxFPS = cap === "uncapped" ? undefined : Number(cap);
const duration = Number(durationArgument);
assert.ok(maxFPS === undefined || Number.isFinite(maxFPS) && maxFPS > 0);
assert.ok(Number.isFinite(duration) && duration >= 1000);

function percentile(values: number[], quantile: number) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ?? 0;
}

const app = new Application();
let device: GPUDevice | undefined;
try {
  const window = app.createWindow({
    title: "hostframe presentation benchmark",
    width: 960,
    height: 540,
    vsync: vsyncArgument === "on"
  });
  const context = window.getContext("webgpu");
  const adapter = await context.requestAdapter();
  assert.ok(adapter);
  if(process.env.HOSTFRAME_EXPECT_VENDOR) {
    assert.equal(adapter.info.vendor, process.env.HOSTFRAME_EXPECT_VENDOR);
    assert.equal(adapter.info.isFallbackAdapter, false);
  }
  device = await adapter.requestDevice();
  const renderingDevice = device;
  const errors: string[] = [];
  device.addEventListener("uncapturederror", event => { errors.push(event.error.message); });
  context.configure({ device, format: app.gpu.getPreferredCanvasFormat() });
  let pipeline: GPURenderPipeline | undefined;
  const shader = workload === "shader" ? device.createShaderModule({ code: `
    @vertex fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
      let points = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
      return vec4f(points[i], 0, 1);
    }
    @fragment fn fragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
      var value = position.xy * 0.003;
      for(var i = 0u; i < 32u; i++) {
        value = sin(value.yx * 1.07 + vec2f(f32(i) * 0.013, 0.37)) + cos(value * 0.93);
      }
      return vec4f(value * 0.25 + 0.5, 0.7, 1);
    }
  ` }) : undefined;
  const intervals: number[] = [];
  const draws: number[] = [];
  let started = 0;
  let finished = 0;
  let previous = 0;
  let cpu = process.cpuUsage();
  let cpuMilliseconds = 0;
  let frames = 0;
  let updates = 0;
  let droppedTime = 0;
  const warmupDeadline = performance.now() + 1000;
  app.on("fixedUpdate", ({ dt }) => {
    assert.equal(dt, 1 / 120);
    if(started) updates++;
  });
  let rendered = false;
  let frameDroppedTime = 0;
  window.on("render", event => {
    frameDroppedTime = event.droppedTime;
    const texture = context.getCurrentTexture();
    assert.equal(texture.width, 960);
    assert.equal(texture.height, 540);
    const encoder = renderingDevice.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{
      view: texture.createView(),
      clearValue: { r: 0.05, g: 0.1, b: 0.8, a: 1 },
      loadOp: "clear",
      storeOp: "store"
    }] });
    if(shader) {
      pipeline ??= renderingDevice.createRenderPipeline({
        layout: "auto",
        vertex: { module: shader, entryPoint: "vertex" },
        fragment: { module: shader, entryPoint: "fragment", targets: [{ format: texture.format }] }
      });
      pass.setPipeline(pipeline);
      pass.draw(3);
    }
    pass.end();
    renderingDevice.queue.submit([encoder.finish()]);
    rendered = true;
  });
  // Measure acquisition, all render listeners, and presentation together.
  const controller = getWindowGPUContextController(context);
  const renderFrame = controller.render.bind(controller);
  controller.render = function measureFrame(dispatch) {
    const before = performance.now();
    rendered = false;
    const didDraw = renderFrame(dispatch);
    const after = performance.now();
    if(!started) {
      if(after >= warmupDeadline) {
        started = after;
        previous = after;
        cpu = process.cpuUsage();
      }
      return didDraw;
    }
    if(rendered) {
      droppedTime += frameDroppedTime;
      frames++;
      intervals.push(after - previous);
      draws.push(after - before);
      previous = after;
    }
    if(after - started >= duration) {
      finished = after;
      const usage = process.cpuUsage(cpu);
      cpuMilliseconds = (usage.user + usage.system) / 1000;
      app.stop();
    }
    return didDraw;
  };
  await app.run({ updateHz: 120, maxFPS });
  assert.ok(finished > started && frames > 0, "Benchmark interrupted before completion");
  const drainStarted = performance.now();
  await device.queue.onSubmittedWorkDone();
  const drainMs = performance.now() - drainStarted;
  assert.deepEqual(errors, []);
  const elapsed = finished - started;
  console.log(JSON.stringify({
    runtime: process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.versions.node}`,
    vendor: adapter.info.vendor,
    device: adapter.info.device,
    fallback: adapter.info.isFallbackAdapter,
    workload,
    width: 960,
    height: 540,
    presentMode: window.presentMode,
    maxFPS: maxFPS ?? null,
    elapsedMs: elapsed,
    frames,
    fps: frames * 1000 / elapsed,
    frameP50Ms: percentile(intervals, 0.5),
    frameP95Ms: percentile(intervals, 0.95),
    frameP99Ms: percentile(intervals, 0.99),
    drawP50Ms: percentile(draws, 0.5),
    drawP95Ms: percentile(draws, 0.95),
    drawMaxMs: draws.reduce((maximum, value) => Math.max(maximum, value), 0),
    cpuPercent: cpuMilliseconds / elapsed * 100,
    updateHz: updates * 1000 / elapsed,
    droppedTime,
    drainMs
  }));
} finally {
  try { app.dispose(); } finally { device?.destroy(); }
}
