import assert from "node:assert/strict";
import { Application, type Window } from "../../../index.ts";
import { assertFramebufferSize } from "./framebuffer.ts";
import { checkAdapter } from "./adapter.ts";

const app = new Application();
let device: GPUDevice | undefined;
try {
  const adapter = await app.gpu.requestAdapter();
  assert.ok(adapter);
  checkAdapter(adapter);
  device = await adapter.requestDevice();
  const renderingDevice = device;
  const failures: string[] = [];
  device.addEventListener("uncapturederror", event => { failures.push(event.error.message); });

  // Runtime validation must also protect JavaScript callers at the native boundary.
  for(const options of [null, true, [], () => {}, { vsync: null }, { vsync: 0 }, { vsync: "false" }]) {
    assert.throws(() => Reflect.apply(app.createWindow, app, [device, options]), TypeError);
    assert.equal(app.pollEvents(), false);
  }
  for(const key of ["width", "height"]) {
    for(const value of [null, "320", true, 0, -1, 1.5, NaN, Infinity, 2 ** 31]) {
      assert.throws(() => Reflect.apply(app.createWindow, app, [device, { [key]: value }]), /positive/);
      assert.equal(app.pollEvents(), false);
    }
  }
  for(const options of [{ title: null }, { title: 42 }, { title: "bad\0title" }, { resizable: 1 }, { resizable: null }]) {
    assert.throws(() => Reflect.apply(app.createWindow, app, [device, options]), TypeError);
    assert.equal(app.pollEvents(), false);
  }
  const sentinel = Symbol("options getter failed");
  for(const key of ["title", "width", "height", "resizable", "vsync"]) {
    const options = Object.defineProperty({}, key, { get() { throw sentinel; } });
    assert.throws(() => app.createWindow(renderingDevice, options), error => error === sentinel);
    assert.equal(app.pollEvents(), false);
  }
  const reentrantOptions = { get title() {
    assert.throws(() => app.dispose(), /in progress/);
    assert.throws(() => app.createWindow(renderingDevice), /in progress/);
    return "Options getter";
  } };
  app.createWindow(device, reentrantOptions).dispose();

  for(const options of [undefined, {}, { title: undefined, width: undefined, height: undefined, resizable: undefined, vsync: undefined }]) {
    const window = app.createWindow(device, options);
    assert.equal(window.presentMode, "fifo");
    assert.equal(Reflect.set(window, "presentMode", "mailbox"), false);
    window.dispose();
    assert.throws(() => window.presentMode, /disposed/);
  }

  for(const resizable of [false, true]) {
    const window = app.createWindow(device, { title: "Custom title — ts-dawn", width: 480, height: 270, resizable });
    app.pollEvents();
    let rendered = false;
    window.draw(texture => {
      rendered = true;
      assertFramebufferSize(texture, 480, 270);
    });
    assert.ok(rendered);
    window.dispose();
  }

  for(const vsync of [true, false]) {
    for(const maxFPS of [undefined, 30]) {
      let window: Window;
      try {
        window = app.createWindow(device, { vsync });
      } catch (error) {
        assert.equal(vsync, false);
        assert.match(String(error), /vsync: false requires Immediate or Mailbox/);
        assert.equal(app.pollEvents(), false);
        // Constructor failure must release the partial window and allow a retry.
        const retry = app.createWindow(device);
        retry.draw(() => {});
        retry.dispose();
        console.log(`Unsupported vsync: false, maxFPS: ${maxFPS ?? "uncapped"}: explicitly rejected.`);
        continue;
      }
      try {
        if(vsync) assert.equal(window.presentMode, "fifo");
        else assert.ok(["immediate", "mailbox"].includes(window.presentMode));
        const mode = window.presentMode;
        assert.throws(() => window.draw(() => { throw sentinel; }), error => error === sentinel);
        assert.equal(window.presentMode, mode);
        let ticks = 0;
        const starts: number[] = [];
        const offUpdate = app.on("fixedUpdate", event => {
          assert.equal(event.dt, 1 / 120);
          assert.equal(event.tick, ++ticks);
        });
        const offRender = app.on("render", event => {
          starts.push(performance.now());
          assert.ok(event.alpha >= 0 && event.alpha < 1);
          window.draw(texture => {
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
          if(ticks >= 24) app.stop();
        });
        try {
          await app.run({ updateHz: 120, maxFPS });
        } finally {
          offUpdate();
          offRender();
        }
        assert.ok(ticks >= 24);
        assert.ok(starts.length >= 2);
        assert.equal(window.presentMode, mode);
        if(maxFPS !== undefined) {
          // Allow sub-millisecond callback dispatch overhead around the scheduler's timestamp.
          for(let index = 1; index < starts.length; index++) assert.ok(starts[index]! - starts[index - 1]! >= 1000 / maxFPS - 1);
        }
        await device.queue.onSubmittedWorkDone();
        assert.deepEqual(failures, []);
        console.log(`${process.versions.bun ? "Bun" : "Node.js"}: ${mode}, ${maxFPS ?? "uncapped"} FPS rendered with independent 120 Hz fixed steps.`);
      } finally {
        window.dispose();
      }
    }
  }
} finally {
  try {
    app.dispose();
  } finally {
    device?.destroy();
  }
}
