import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Application, Key, PointerButton, type InputEvent } from "../../../index.ts";
import { configureWindow, renderFrames } from "./frames.ts";

if(process.platform !== "win32") throw new Error("Windows interaction verification requires Windows");
const execute = promisify(execFile);
const helper = resolve(dirname(fileURLToPath(import.meta.url)), "../../../build/native/cmake/native_windows_interaction.exe");
const title = `hostframe Windows interactions ${process.pid}`;
const otherTitle = `${title} second`;
const app = new Application();
let device: GPUDevice | undefined;
let savedCursor: string[] | undefined;

async function drive(windowTitle: string, action: string, ...arguments_: string[]) {
  let done = false;
  const operation = execute(helper, [String(process.pid), windowTitle, action, ...arguments_], { timeout: 5000 })
    .then(result => ({ result }), error => ({ error })).finally(() => { done = true; });
  // Some Win32 window-management calls wait for the owning thread to pump.
  while(!done) {
    app.pollEvents();
    await setTimeout(5);
  }
  const outcome = await operation;
  if("error" in outcome) throw outcome.error;
  return outcome.result.stdout.trim();
}
async function until(predicate: () => boolean, message: string) {
  const deadline = performance.now() + 5000;
  while(true) {
    app.pollEvents();
    if(predicate()) return;
    assert.ok(performance.now() < deadline, message);
    await setTimeout(10);
  }
}

try {
  const adapter = await app.gpu.requestAdapter();
  assert.ok(adapter);
  device = await adapter.requestDevice();
  const window = app.createWindow({ title, width: 480, height: 300, resizable: true });
  const context = configureWindow(app, window, device);
  const second = app.createWindow({ title: otherTitle, width: 240, height: 160 });
  const events: InputEvent[] = [];
  for(const name of ["key", "text", "pointerMove", "pointerButton", "scroll", "focus", "pointerCapture"] as const) {
    window.on(name, event => { events.push(event); });
  }
  savedCursor = (await drive(title, "cursor")).split(" ");
  await drive(title, "focus");
  await until(() => window.input.focused, "First window did not receive focus");

  // SendInput enters the system input queue; these are not direct GLFW callbacks.
  await drive(title, "key", "65", "down");
  await until(() => window.isKeyDown(Key.A), "A key press was not delivered");
  await drive(title, "key", "65", "up");
  await until(() => !window.isKeyDown(Key.A), "A key release was not delivered");
  assert.ok(events.some(event => event.type === "key" && event.key === Key.A && event.action === "press"));
  assert.ok(events.some(event => event.type === "key" && event.key === Key.A && event.action === "release"));
  await drive(title, "text");
  await until(() => events.some(event => event.type === "text" && event.codepoint === 0xe9), "Unicode text was not delivered");

  await drive(title, "mouse", "40", "50");
  await until(() => Math.abs(window.input.x - 40) <= 1 && Math.abs(window.input.y - 50) <= 1, "Pointer move was not delivered");
  await drive(title, "button", "down");
  await until(() => window.isButtonDown(PointerButton.LEFT), "Mouse button press was not delivered");
  await drive(title, "button", "up");
  await until(() => !window.isButtonDown(PointerButton.LEFT), "Mouse button release was not delivered");
  await drive(title, "wheel");
  await until(() => events.some(event => event.type === "scroll" && event.deltaY > 0), "Mouse wheel was not delivered");

  window.setPointerCapture(true);
  assert.equal(window.input.pointerCaptured, true);
  await drive(title, "relative", "20", "15");
  await setTimeout(40);
  await drive(title, "relative", "30", "25");
  await until(() => events.some(event => event.type === "pointerMove" && event.captured && (event.deltaX !== 0 || event.deltaY !== 0)), "Captured relative movement was not delivered");
  await drive(title, "key", "87", "down");
  await until(() => window.isKeyDown(Key.W), "Held W key was not delivered");
  await drive(title, "button", "down");
  await until(() => window.isButtonDown(PointerButton.LEFT), "Held button was not delivered");
  await drive(otherTitle, "focus");
  await until(() => !window.input.focused && second.input.focused, "Focus did not transfer to the second window");
  assert.deepEqual(window.input.keys, []);
  assert.deepEqual(window.input.buttons, []);
  assert.equal(window.input.pointerCaptured, false);
  assert.ok(events.some(event => event.type === "key" && event.key === Key.W && event.action === "release" && event.synthetic));
  assert.ok(events.some(event => event.type === "pointerButton" && event.button === PointerButton.LEFT && event.action === "release" && event.synthetic));
  await drive(otherTitle, "key", "87", "up");
  await drive(otherTitle, "button", "up");

  await drive(title, "resize", "520", "340");
  await until(() => window.metrics.width === 520 && window.metrics.height === 340, "Native resize did not update client metrics");
  assert.ok(window.metrics.framebufferWidth > 0 && window.metrics.framebufferHeight > 0);
  assert.deepEqual(window.toFramebuffer(260, 170), {
    x: window.metrics.framebufferWidth / 2, y: window.metrics.framebufferHeight / 2
  });
  await renderFrames(app, window, 2);
  await drive(title, "minimize");
  await until(() => window.status.minimized && !window.metrics.drawable, "Minimization did not make the window non-drawable");
  await drive(title, "restore");
  await until(() => !window.status.minimized && window.metrics.drawable, "Restore did not recover drawable metrics");
  await renderFrames(app, window, 2);
  assert.equal(context.getConfiguration()?.device, device);

  let closeRequests = 0;
  const offClose = window.on("closeRequest", event => { closeRequests++; event.preventDefault(); });
  await drive(title, "close");
  await until(() => closeRequests === 1, "Close request was not delivered");
  assert.equal(window.shouldClose, false);
  offClose();
  await drive(title, "close");
  await until(() => window.shouldClose, "Accepted close request was not applied");
  second.dispose();
  console.log(`${process.versions.bun ? "Bun" : "Node.js"}: Win32 real keyboard, Unicode text, mouse, focus, capture, resize, minimize/restore, close and rendering passed.`);
} finally {
  // Release injected input even when an assertion fails.
  await drive(title, "key", "65", "up").catch(() => {});
  await drive(title, "key", "87", "up").catch(() => {});
  await drive(title, "button", "up").catch(() => {});
  if(savedCursor?.length === 2) await drive(title, "cursor-screen", ...savedCursor).catch(() => {});
  try { app.dispose(); } finally { device?.destroy(); }
}
