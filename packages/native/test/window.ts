import assert from "node:assert/strict";
import { readdirSync, readlinkSync } from "node:fs";
import { isMainThread, parentPort, Worker } from "node:worker_threads";
import { installWebGPUGlobals, Application } from "../../../index.ts";
import { checkAdapter } from "./adapter.ts";
import { assertFramebufferSize } from "./framebuffer.ts";
import { assertDeviceAlive } from "./device.ts";
import { configureWindow, renderFrames } from "./frames.ts";

function processSockets() {
  const sockets = new Set<string>();
  if(process.platform !== "linux") return sockets;
  for(const descriptor of readdirSync("/proc/self/fd")) {
    try {
      const target = readlinkSync(`/proc/self/fd/${descriptor}`);
      if(target.startsWith("socket:")) sockets.add(target);
    } catch (error) {
      if(!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
  }
  return sockets;
}

if(!isMainThread) {
  assert.throws(() => new Application(), /main thread/);
  parentPort!.postMessage("worker rejected");
} else {
  const worker = new Worker(new URL(import.meta.url));
  let message: unknown;
  worker.on("message", value => { message = value; });
  await new Promise<void>((resolve, reject) => {
    worker.on("error", reject);
    worker.on("exit", code => {
      if(code !== 0) reject(new Error(`Worker exited with ${code}`));
      else resolve();
    });
  });
  assert.equal(message, "worker rejected");

  if(process.argv.includes("--thread-only")) {
    console.log(`${process.versions.bun ? "Bun" : "Node.js"}: Application main-thread guard passed.`);
  } else if(process.argv.includes("--no-display")) {
    // The verifier clears DISPLAY before launching: Bun's JS env mutations do
    // not reliably change the environment observed by native GLFW.
    for(let attempt = 0; attempt < 2; attempt++) {
      assert.throws(() => new Application(), /GLFW initialization failed/);
    }
    console.log(`${process.versions.bun ? "Bun" : "Node.js"}: Application initialization failure passed.`);
  } else {
    const originalGPU = Object.getOwnPropertyDescriptor(globalThis, "GPU");
    assert.equal(originalGPU, undefined);
    const plain = new Application();
    plain.dispose();
    assert.equal(Object.hasOwn(globalThis, "GPU"), false);
    assert.equal(Object.hasOwn(globalThis, "GPUBufferUsage"), false);
    Object.defineProperty(globalThis, "GPU", { value: undefined, writable: false, configurable: true });
    const isolated = new Application();
    isolated.dispose();
    assert.equal(Object.getOwnPropertyDescriptor(globalThis, "GPU")?.value, undefined);
    assert.throws(() => installWebGPUGlobals(), /Conflicting WebGPU global/);
    assert.equal(Object.hasOwn(globalThis, "GPUBufferUsage"), false);
    Reflect.deleteProperty(globalThis, "GPU");
    installWebGPUGlobals();
    const constructor = GPU;
    Object.defineProperty(globalThis, "GPU", { writable: false });
    installWebGPUGlobals();
    assert.equal(GPU, constructor);
    const beforeApplication = processSockets();
    const app = new Application();
    const sessionSockets = [...processSockets()].filter(socket => !beforeApplication.has(socket));
    if(process.platform === "linux") assert.ok(sessionSockets.length > 0, "Application must open an X11 connection");
    const gpu = app.gpu;
    assert.throws(() => new Application(), /Only one native application/);
    const adapter = await gpu.requestAdapter();
    assert.ok(adapter, "No compatible GPU adapter");
    checkAdapter(adapter);
    const device = await adapter.requestDevice();
    const failures: string[] = [];
    device.addEventListener("uncapturederror", event => failures.push(event.error.message));
    if(process.argv.includes("--shutdown")) {
      const window = app.createWindow();
      configureWindow(app, window, device);
      await renderFrames(app, window);
      // Only retain the application: it owns the window even if its JS wrapper is collected.
      Object.defineProperty(globalThis, "__hostframeShutdownApplication", { value: app });
      (globalThis as { gc?: () => void }).gc?.();
      console.log(`${process.versions.bun ? "Bun" : "Node.js"}: Application shutdown fixture ready.`);
    } else {
      try {
        const invalidAdapter = await gpu.requestAdapter();
        assert.ok(invalidAdapter);
        const invalidDevice = await invalidAdapter.requestDevice();
        invalidDevice.destroy();
        const window = app.createWindow();
        const context = window.getContext("webgpu");
        const format = gpu.getPreferredCanvasFormat();
        // Configuration failure retains the surface and permits retry.
        assert.throws(() => context.configure({ device: invalidDevice, format }), /lost or destroyed/);
        context.configure({ device, format });
        try {
          const second = app.createWindow();
          second.dispose();
          assert.equal("draw" in window, false);
          assert.throws(() => Reflect.apply(app.on, app, ["render", () => {}]), /Unknown application event/);
          const sentinel = new Error("render failed");
          const offFailure = window.on("render", () => { throw sentinel; });
          await assert.rejects(renderFrames(app, window), error => error === sentinel);
          offFailure();
          let escaped: GPUTexture | undefined;
          let frames = 0;
          const offRender = window.on("render", () => {
            assert.throws(() => window.dispose(), /in progress/);
            assert.throws(() => app.dispose(), /in progress/);
            assert.throws(() => app.createWindow(), /in progress/);
            const texture = context.getCurrentTexture();
            assertFramebufferSize(texture, 320, 240);
            escaped = texture;
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginRenderPass({ colorAttachments: [{
              view: texture.createView(),
              clearValue: { r: 0.05, g: 0.1, b: 0.8, a: 1 },
              loadOp: "clear", storeOp: "store"
            }] });
            pass.end();
            device.queue.submit([encoder.finish()]);
            // Exercise collection while native window/device references are live.
            if(++frames === 30) (globalThis as { gc?: () => void }).gc?.();
          });
          await renderFrames(app, window, 60);
          offRender();
          await device.queue.onSubmittedWorkDone();
          assert.deepEqual(failures, []);
          device.pushErrorScope("validation");
          assert.ok(escaped);
          const expiredEncoder = device.createCommandEncoder();
          const expiredPass = expiredEncoder.beginRenderPass({
            colorAttachments: [{ view: escaped.createView(), loadOp: "clear", storeOp: "store" }]
          });
          expiredPass.end();
          device.queue.submit([expiredEncoder.finish()]);
          assert.ok(await device.popErrorScope(), "Frame textures must expire after render dispatch");
        } finally {
          window.dispose();
        }
        window.dispose();
        assert.throws(() => context.getCurrentTexture(), /disposed/);
        assert.throws(() => new Application(), /Only one native application/);
        // Linux socket identities prove GLFW's X11 connection survives window
        // disposal/recreation, rather than closing and reopening the session.
        for(const socket of sessionSockets) assert.ok(processSockets().has(socket));
        const replacement = app.createWindow();
        configureWindow(app, replacement, device);
        await renderFrames(app, replacement);
        replacement.dispose();
        for(const socket of sessionSockets) assert.ok(processSockets().has(socket));
        await assertDeviceAlive(device);
        // Dispose the application with live, rendered swapchain resources.
        const liveWindow = app.createWindow();
        const liveContext = configureWindow(app, liveWindow, device);
        await renderFrames(app, liveWindow);
        app.dispose();
        app.dispose();
        for(const socket of sessionSockets) assert.ok(!processSockets().has(socket));
        liveWindow.dispose();
        assert.throws(() => liveContext.getCurrentTexture(), /disposed/);
        assert.throws(() => app.createWindow(), /Application is disposed/);
        assert.throws(() => context.getCurrentTexture(), /disposed/);
        await assertDeviceAlive(device);
        assert.deepEqual(failures, []);
      } finally {
        try {
          app.dispose();
        } finally {
          device.destroy();
        }
      }
      const nextApp = new Application();
      app.dispose();
      assert.equal(nextApp.gpu, gpu, "GPU owner must survive application disposal");
      const lostAdapter = await nextApp.gpu.requestAdapter();
      assert.ok(lostAdapter);
      const lostDevice = await lostAdapter.requestDevice();
      const lostFailures: string[] = [];
      lostDevice.addEventListener("uncapturederror", event => lostFailures.push(event.error.message));
      const lostWindow = nextApp.createWindow();
      configureWindow(nextApp, lostWindow, lostDevice);
      await renderFrames(nextApp, lostWindow);
      lostDevice.destroy();
      await assert.rejects(renderFrames(nextApp, lostWindow), /lost or destroyed/);
      lostWindow.dispose();
      const retry = nextApp.createWindow();
      assert.throws(() => configureWindow(nextApp, retry, lostDevice), /lost or destroyed/);
      retry.dispose();
      nextApp.dispose();
      nextApp.dispose();
      assert.deepEqual(lostFailures, []);
      // Retain the process GPU while repeatedly closing/reopening GLFW's X11
      // connection. Mesa may reuse cached WSI data when its address is recycled.
      for(let session = 0; session < 4; session++) {
        const recreated = new Application();
        let recreatedDevice: GPUDevice | undefined;
        try {
          assert.equal(recreated.gpu, gpu);
          const recreatedAdapter = await recreated.gpu.requestAdapter();
          assert.ok(recreatedAdapter);
          checkAdapter(recreatedAdapter);
          recreatedDevice = await recreatedAdapter.requestDevice();
          const recreatedWindow = recreated.createWindow();
          configureWindow(recreated, recreatedWindow, recreatedDevice);
          await renderFrames(recreated, recreatedWindow);
          await recreatedDevice.queue.onSubmittedWorkDone();
        } finally {
          try {
            recreated.dispose();
          } finally {
            recreatedDevice?.destroy();
          }
        }
      }
      console.log(`${process.versions.bun ? "Bun" : "Node.js"}: Application rendering/lifecycle passed.`);
    }
  }
}
