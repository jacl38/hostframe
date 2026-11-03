import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { Application, type Window } from "../../../index.ts";
import { checkAdapter } from "./adapter.ts";
import { assertDeviceAlive } from "./device.ts";

const execute = promisify(execFile);
const runtime = process.versions.bun ? "bun" : "node";
const captureDirectory = process.env.HOSTFRAME_CAPTURE_DIRECTORY;
const vsync = !process.argv.includes("--no-vsync");

async function xdo(...args: string[]) {
  const result = await execute("xdotool", args, { timeout: 3000 });
  return result.stdout.trim();
}

async function until(predicate: () => boolean | Promise<boolean>, message: string) {
  const deadline = performance.now() + 4000;
  while(!await predicate()) {
    assert.ok(performance.now() < deadline, message);
    await setTimeout(10);
  }
}

async function findWindow(title: string) {
  let id = "";
  await until(async () => {
    try {
      id = (await xdo("search", "--onlyvisible", "--pid", String(process.pid), "--name", `^${title}$`)).split("\n")[0]!;
      return Boolean(id);
    } catch {
      return false;
    }
  }, `Window did not appear: ${title}`);
  return id;
}

async function capture(id: string, name: string) {
  if(!captureDirectory) return;
  await mkdir(captureDirectory, { recursive: true });
  await execute("import", ["-window", id, resolve(captureDirectory, `${runtime}-${vsync ? "fifo" : "no-vsync"}-${name}.png`)], { timeout: 3000 });
}

async function assertExpired(device: GPUDevice, view: GPUTextureView) {
  device.pushErrorScope("validation");
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: "clear", storeOp: "store" }] });
  pass.end();
  device.queue.submit([encoder.finish()]);
  assert.ok(await device.popErrorScope(), "Retained frame views must expire");
}

const manager = await execute("xprop", ["-root", "_NET_SUPPORTING_WM_CHECK"], { timeout: 3000 });
assert.match(manager.stdout, /window id # 0x[1-9a-f]/i, "Resize interactions require an EWMH window manager, e.g. KWin");
const app = new Application();
let device: GPUDevice | undefined;
let running: Promise<void> | undefined;
try {
  const adapter = await app.gpu.requestAdapter();
  assert.ok(adapter);
  checkAdapter(adapter);
  device = await adapter.requestDevice();
  const renderingDevice = device;
  const failures: string[] = [];
  device.addEventListener("uncapturederror", event => { failures.push(event.error.message); });

  // Check actual native title, client geometry, and fixed-size WM hints for defaults.
  for(const options of [undefined, { title: "Configured fixed window", width: 400, height: 280, resizable: false }]) {
    const window = app.createWindow(device, options);
    app.pollEvents();
    const id = await findWindow(options?.title ?? "hostframe solid color");
    assert.equal(await xdo("getwindowname", id), options?.title ?? "hostframe solid color");
    const hints = (await execute("xprop", ["-id", id, "WM_NORMAL_HINTS"])).stdout;
    const size = `${options?.width ?? 320} by ${options?.height ?? 240}`;
    assert.ok(hints.includes(`minimum size: ${size}`));
    assert.ok(hints.includes(`maximum size: ${size}`));
    window.draw(texture => {
      assert.equal(texture.width, options?.width ?? 320);
      assert.equal(texture.height, options?.height ?? 240);
    });
    window.dispose();
  }

  let window: Window = app.createWindow(device, { title: "hostframe resize interactions", width: 480, height: 300, resizable: true, vsync });
  const id = await findWindow("hostframe resize interactions");
  const mode = window.presentMode;
  let frames = 0;
  let ticks = 0;
  let dimensions = "";
  let escaped: GPUTexture | undefined;
  let escapedView: GPUTextureView | undefined;
  let callbackFailure: unknown;
  let abandonedView: GPUTextureView | undefined;
  let loopError: unknown;
  const sentinel = Symbol("abandoned resized frame");
  app.on("fixedUpdate", () => { ticks++; });
  app.on("render", () => {
    try {
      window.draw(texture => {
        frames++;
        dimensions = `${texture.width}x${texture.height}`;
        escaped = texture;
        escapedView = texture.createView();
        assert.throws(() => app.pollEvents(), /in progress/);
        assert.throws(() => window.dispose(), /in progress/);
        assert.throws(() => app.dispose(), /in progress/);
        const encoder = renderingDevice.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: escapedView,
            clearValue: { r: 0.05, g: 0.1, b: 0.8, a: 1 },
            loadOp: "clear",
            storeOp: "store"
          }]
        });
        pass.end();
        renderingDevice.queue.submit([encoder.finish()]);
        if(callbackFailure) {
          abandonedView = escapedView;
          const error = callbackFailure;
          callbackFailure = undefined;
          throw error;
        }
      });
    } catch (error) {
      if(error !== sentinel) throw error;
    }
  });
  running = app.run({ updateHz: 120, maxFPS: 60 }).catch(error => { loopError = error; });
  async function rendered(size: string) {
    await until(() => {
      if(loopError) throw loopError;
      return dimensions === size;
    }, `Expected framebuffer ${size}, got ${dimensions}`);
    assert.equal(window.presentMode, mode);
  }
  async function resize(width: number, height: number) {
    dimensions = "";
    await xdo("windowsize", "--sync", id, String(width), String(height));
    await rendered(`${width}x${height}`);
  }
  async function minimize() {
    await xdo("windowminimize", "--sync", id);
    // Wait for GLFW to process iconification and prove drawing stays suspended.
    await setTimeout(120);
    const before = frames;
    const ticksBefore = ticks;
    for(let attempt = 0; attempt < 10; attempt++) {
      assert.equal(app.pollEvents(), true, "Minimizing must not close the window");
      window.draw(() => { assert.fail("Minimized window must skip its callback"); });
      await setTimeout(10);
    }
    assert.equal(frames, before);
    assert.ok(ticks > ticksBefore, "Fixed updates must continue while minimized");
    assert.throws(() => Reflect.apply(window.draw, window, [null]), /draw callback/);
    assert.equal(window.shouldClose, false);
  }

  await rendered("480x300");
  const initialView = escapedView!;
  await capture(id, "initial");
  await resize(800, 450);
  await assertExpired(device, initialView);
  await capture(id, "resized");
  callbackFailure = sentinel;
  await until(() => !callbackFailure, "Resized callback failure was not exercised");
  assert.ok(abandonedView);
  await assertExpired(device, abandonedView);
  await resize(360, 520);
  await minimize();
  await assertExpired(device, escapedView!);
  dimensions = "";
  await xdo("windowmap", "--sync", id);
  await xdo("windowactivate", "--sync", id);
  await rendered("360x520");
  await capture(id, "restored");
  // Repeated large/small transitions exercise swapchain replacement and GPU cleanup.
  for(const [width, height] of [[640, 360], [240, 180], [900, 600], [480, 300]]) await resize(width!, height!);
  await assertExpired(device, escaped!.createView());
  await minimize();
  app.stop();
  window.requestClose();
  assert.throws(() => window.draw(() => {}), /close requested/);
  await running;
  if(loopError) throw loopError;
  window.dispose();
  window.dispose();
  assert.throws(() => window.draw(() => {}), /disposed/);
  assert.throws(() => window.presentMode, /disposed/);
  assert.equal(app.pollEvents(), false);

  await assertDeviceAlive(device);

  // Application disposal with a live device and a minimized presentation.
  window = app.createWindow(device, { title: "hostframe minimized disposal", width: 420, height: 260, resizable: true, vsync });
  const replacementId = await findWindow("hostframe minimized disposal");
  app.pollEvents();
  window.draw(() => {});
  await xdo("windowminimize", "--sync", replacementId);
  app.pollEvents();
  app.dispose();
  app.dispose();
  window.dispose();
  assert.throws(() => window.shouldClose, /disposed/);
  assert.throws(() => app.createWindow(renderingDevice), /disposed/);
  await assertDeviceAlive(device);

  // Minimized draws still reject destroyed devices before deciding to skip a frame.
  const next = new Application();
  try {
    const lostWindow = next.createWindow(device, { title: "hostframe minimized lost device", resizable: true });
    lostWindow.draw(() => {});
    const lostId = await findWindow("hostframe minimized lost device");
    await xdo("windowminimize", "--sync", lostId);
    next.pollEvents();
    device.destroy();
    assert.throws(() => lostWindow.draw(() => {}), /lost or destroyed/);
    next.dispose();
    lostWindow.dispose();
  } finally {
    next.dispose();
  }
  assert.deepEqual(failures, []);
  console.log(`${runtime} (${mode}): native titles/defaults, repeated resize, minimize/restore, expired textures/views, callback recovery, and minimized disposal passed.`);
} finally {
  app.stop();
  await running;
  try {
    app.dispose();
  } finally {
    device?.destroy();
  }
}
