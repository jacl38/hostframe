import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { isMainThread, parentPort, Worker } from "node:worker_threads";
import { createGPU, createWindow } from "../bridge.ts";

if(!isMainThread) {
  assert.throws(() => createWindow({} as GPUDevice), /main thread/);
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

  const gpu = createGPU();
  assert.equal(createGPU(), gpu);
  assert.throws(() => createWindow({} as GPUDevice), /GPUDevice/);
  const adapter = await gpu.requestAdapter();
  assert.ok(adapter, "No compatible GPU adapter");
  const device = await adapter.requestDevice();
  const failures: string[] = [];
  device.addEventListener("uncapturederror", event => failures.push(event.error.message));
  if(process.argv.includes("--no-display")) {
    try {
      // Failed initialization must release GLFW state so retrying remains safe.
      for(let attempt = 0; attempt < 2; attempt++) {
        assert.throws(() => createWindow(device), /GLFW initialization failed/);
      }
    } finally {
      device.destroy();
    }
  } else if(process.argv.includes("--shutdown")) {
    const window = createWindow(device);
    window.draw(() => {});
    // Exercise the environment cleanup hook with live presentation resources.
    // The process must exit normally without explicit window/device disposal.
    Object.defineProperty(globalThis, "__tsDawnShutdownWindow", { value: window });
  } else {
    try {
      const window = createWindow(device);
      try {
        assert.throws(() => createWindow(device), /Only one native window/);
        // These deliberately bypass the TypeScript contract to test the native boundary.
        assert.throws(() => Reflect.apply(window.draw, window, [null]), /draw callback/);
        assert.throws(() => Reflect.apply(window.draw, window, [() => Promise.resolve()]), /synchronously/);
        const sentinel = new Error("render failed");
        assert.throws(() => window.draw(() => { throw sentinel; }), error => error === sentinel);
        window.draw(() => {
          assert.throws(() => window.draw(() => {}), /in progress/);
          assert.throws(() => window.dispose(), /in progress/);
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
      // GLFW and surface ownership can be reacquired after disposal.
      const replacement = createWindow(device);
      replacement.draw(() => {});
      replacement.dispose();
      assert.deepEqual(failures, []);
    } finally {
      device.destroy();
    }
    const lostAdapter = await gpu.requestAdapter();
    assert.ok(lostAdapter);
    const lostDevice = await lostAdapter.requestDevice();
    const lostFailures: string[] = [];
    lostDevice.addEventListener("uncapturederror", event => lostFailures.push(event.error.message));
    const lostWindow = createWindow(lostDevice);
    lostWindow.draw(() => {});
    lostDevice.destroy();
    assert.throws(() => lostWindow.draw(() => {}), /lost or destroyed/);
    lostWindow.dispose();
    assert.throws(() => createWindow(lostDevice), /lost or destroyed/);
    assert.deepEqual(lostFailures, []);
  }
  const check = process.argv.includes("--no-display") ? "initialization failure passed" : process.argv.includes("--shutdown") ? "shutdown fixture ready" : "rendering/lifecycle passed";
  console.log(`${process.versions.bun ? "Bun" : "Node.js"}: JavaScript window ${check}.`);
}
