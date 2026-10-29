import assert from "node:assert/strict";
import { readdirSync, readlinkSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { isMainThread, parentPort, Worker } from "node:worker_threads";
import { Application } from "../../../index.ts";

function processSockets() {
  const sockets = new Set<string>();
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

async function assertDeviceAlive(device: GPUDevice) {
  const buffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    device.queue.writeBuffer(buffer, 0, new Uint32Array([42]));
    await buffer.mapAsync(GPUMapMode.READ);
    assert.equal(new Uint32Array(buffer.getMappedRange())[0], 42);
    buffer.unmap();
  } finally {
    buffer.destroy();
  }
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

  if(process.argv.includes("--no-display")) {
    // The verifier clears DISPLAY before launching: Bun's JS env mutations do
    // not reliably change the environment observed by native GLFW.
    for(let attempt = 0; attempt < 2; attempt++) {
      assert.throws(() => new Application(), /GLFW initialization failed/);
    }
    console.log(`${process.versions.bun ? "Bun" : "Node.js"}: Application initialization failure passed.`);
  } else {
    // Fail GPU-global installation after GLFW succeeds. The public constructor
    // must close its native session before rethrowing and permit a later retry.
    const originalGPU = Object.getOwnPropertyDescriptor(globalThis, "GPU");
    try {
      Object.defineProperty(globalThis, "GPU", { value: undefined, writable: false, configurable: true });
      for(let attempt = 0; attempt < 2; attempt++) assert.throws(() => new Application(), TypeError);
    } finally {
      if(originalGPU) Object.defineProperty(globalThis, "GPU", originalGPU);
      else Reflect.deleteProperty(globalThis, "GPU");
    }
    const beforeApplication = processSockets();
    const app = new Application();
    const sessionSockets = [...processSockets()].filter(socket => !beforeApplication.has(socket));
    assert.ok(sessionSockets.length > 0, "Application must open an X11 connection");
    const gpu = app.gpu;
    assert.throws(() => new Application(), /Only one native application/);
    assert.throws(() => app.createWindow({} as GPUDevice), /GPUDevice/);
    assert.throws(() => app.createWindow(gpu as unknown as GPUDevice), /GPUDevice/);
    const adapter = await gpu.requestAdapter();
    assert.ok(adapter, "No compatible GPU adapter");
    const device = await adapter.requestDevice();
    const failures: string[] = [];
    device.addEventListener("uncapturederror", event => failures.push(event.error.message));
    if(process.argv.includes("--shutdown")) {
      app.createWindow(device).draw(() => {});
      // Only retain the application: it owns the window even if its JS wrapper is collected.
      Object.defineProperty(globalThis, "__tsDawnShutdownApplication", { value: app });
      (globalThis as { gc?: () => void }).gc?.();
      console.log(`${process.versions.bun ? "Bun" : "Node.js"}: Application shutdown fixture ready.`);
    } else {
      try {
        const invalidAdapter = await gpu.requestAdapter();
        assert.ok(invalidAdapter);
        const invalidDevice = await invalidAdapter.requestDevice();
        invalidDevice.destroy();
        // A constructor failure after device retention must leave the app usable.
        assert.throws(() => app.createWindow(invalidDevice), /lost or destroyed/);
        const window = app.createWindow(device);
        try {
          assert.throws(() => app.createWindow(device), /Only one native window/);
          // These deliberately bypass the TypeScript contract to test the native boundary.
          assert.throws(() => Reflect.apply(window.draw, window, [null]), /draw callback/);
          assert.throws(() => Reflect.apply(window.draw, window, [() => Promise.resolve()]), /synchronously/);
          const sentinel = new Error("render failed");
          assert.throws(() => window.draw(() => { throw sentinel; }), error => error === sentinel);
          window.draw(() => {
            assert.throws(() => window.draw(() => {}), /in progress/);
            assert.throws(() => window.dispose(), /in progress/);
            assert.throws(() => app.dispose(), /in progress/);
            assert.throws(() => app.createWindow(device), /in progress/);
          });

          let escaped: GPUTexture | undefined;
          for(let frame = 0; frame < 60; frame++) {
            window.draw(texture => {
              assert.equal(texture.width, 320);
              assert.equal(texture.height, 240);
              escaped = texture;
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
            // Exercise collection while native window/device references are live.
            if(frame === 30) (globalThis as { gc?: () => void }).gc?.();
            await setTimeout(16);
          }
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
          assert.ok(await device.popErrorScope(), "Frame textures must expire after draw");
        } finally {
          window.dispose();
        }
        window.dispose();
        assert.throws(() => window.draw(() => {}), /disposed/);
        assert.throws(() => new Application(), /Only one native application/);
        // Linux socket identities prove GLFW's X11 connection survives window
        // disposal/recreation, rather than closing and reopening the session.
        for(const socket of sessionSockets) assert.ok(processSockets().has(socket));
        const replacement = app.createWindow(device);
        replacement.draw(() => {});
        replacement.dispose();
        for(const socket of sessionSockets) assert.ok(processSockets().has(socket));
        await assertDeviceAlive(device);
        // Dispose the application with live, rendered swapchain resources.
        const liveWindow = app.createWindow(device);
        liveWindow.draw(() => {});
        app.dispose();
        app.dispose();
        for(const socket of sessionSockets) assert.ok(!processSockets().has(socket));
        liveWindow.dispose();
        assert.throws(() => liveWindow.draw(() => {}), /disposed/);
        assert.throws(() => app.createWindow(device), /Application is disposed/);
        assert.throws(() => window.draw(() => {}), /disposed/);
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
      const lostWindow = nextApp.createWindow(lostDevice);
      lostWindow.draw(() => {});
      lostDevice.destroy();
      assert.throws(() => lostWindow.draw(() => {}), /lost or destroyed/);
      lostWindow.dispose();
      assert.throws(() => nextApp.createWindow(lostDevice), /lost or destroyed/);
      nextApp.dispose();
      nextApp.dispose();
      assert.deepEqual(lostFailures, []);
      console.log(`${process.versions.bun ? "Bun" : "Node.js"}: Application rendering/lifecycle passed.`);
    }
  }
}
