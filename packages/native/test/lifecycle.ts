import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { Application, Key, type CloseRequestEvent } from "../../../index.ts";
import { getProcessGPU, NativeApplication } from "../bridge.ts";
import { configureWindow, renderFrames } from "./frames.ts";
import { checkAdapter } from "./adapter.ts";

const execute = promisify(execFile);
async function xdo(...args: string[]) {
  return (await execute("xdotool", args, { timeout: 3000 })).stdout.trim();
}
async function closeRequest(id: string, count = 1) {
  await execute(resolve(import.meta.dirname, "../../../build/native/cmake/native_close_request"), [id, String(count)], { timeout: 3000 });
}

const app = new Application();
let device: GPUDevice | undefined;
let running: Promise<void> | undefined;
let runError: unknown;
let runEnded = false;
try {
  const first = app.createWindow({ title: "hostframe lifecycle first", width: 480, height: 300, resizable: true });
  const second = app.createWindow({ title: "hostframe lifecycle second", width: 360, height: 240 });
  const adapter = await first.getContext("webgpu").requestAdapter();
  assert.ok(adapter);
  checkAdapter(adapter);
  device = await adapter.requestDevice();
  const context = configureWindow(app, first, device);
  configureWindow(app, second, device);
  const firstId = (await xdo("search", "--all", "--pid", String(process.pid), "--name", "^hostframe lifecycle first$")).split("\n")[0]!;
  const secondId = (await xdo("search", "--all", "--pid", String(process.pid), "--name", "^hostframe lifecycle second$")).split("\n")[0]!;
  assert.notEqual(firstId, secondId, "Native windows must have distinct X11 identities");
  async function until(predicate: () => boolean | Promise<boolean>) {
    const deadline = performance.now() + 4000;
    while(!await predicate()) {
      assert.ok(performance.now() < deadline, "Lifecycle transition timed out");
      if(runError) throw runError;
      assert.equal(runEnded, false, "Run ended before lifecycle transition");
      if(!running) app.pollEvents();
      await setTimeout(10);
    }
  }
  function controls() {
    return [
      () => first.setTitle("changed"),
      () => first.setSize(640, 400),
      () => first.setPosition(100, 100),
      () => first.setVisible(false)
    ];
  }
  function guards() {
    for(const control of controls()) assert.throws(control, /in progress/);
    assert.throws(() => app.pollEvents(), /in progress/);
    assert.throws(() => first.dispatchInput(), /in progress/);
    assert.throws(() => first.dispose(), /in progress/);
    assert.throws(() => app.dispose(), /in progress/);
    assert.throws(() => app.createWindow(), /in progress/);
    assert.throws(() => second.setTitle("cross-window"), /in progress/);
    assert.throws(() => context.unconfigure(), /in progress/);
  }

  // Observe native title, client geometry and visibility rather than setter success.
  async function visibleIds() {
    try {
      // Visibility follows established IDs. Legacy WM_NAME searches can differ
      // from UTF-8 title readback under the C locale used by minimal containers.
      return (await xdo("search", "--onlyvisible", "--pid", String(process.pid))).split("\n");
    } catch (error) {
      // xdotool exits 1 for no matches. Mapping can lag GLFW's cached visible
      // state on either transition; keep polling without hiding tool failures.
      if(error instanceof Error && "code" in error && error.code === 1 && "stderr" in error && error.stderr === "") return [];
      throw error;
    }
  }
  const original = first.status;
  first.setTitle("hostframe lifecycle edited — λ");
  assert.equal(await xdo("getwindowname", firstId), "hostframe lifecycle edited — λ");
  let metricsEvents = 0;
  first.on("metrics", event => {
    assert.deepEqual(event.metrics, first.metrics);
    assert.ok(Object.isFrozen(event.metrics));
    metricsEvents++;
    guards();
  });
  first.setSize(640, 400);
  await until(() => first.metrics.width === 640 && first.metrics.height === 400);
  assert.ok(metricsEvents > 0);
  assert.match(await xdo("getwindowgeometry", "--shell", firstId), /WIDTH=640\nHEIGHT=400/);
  assert.equal(second.metrics.width, 360);
  first.setPosition(180, 160);
  await until(() => first.status.x === 180 && first.status.y === 160);
  assert.match(await xdo("getwindowgeometry", "--shell", firstId), /X=180\nY=160/);
  assert.ok(Object.isFrozen(first.status));
  assert.notEqual(original, first.status);
  await until(async () => (await visibleIds()).includes(firstId));
  first.setVisible(false);
  await until(() => !first.status.visible);
  await until(async () => !(await visibleIds()).includes(firstId));
  assert.equal(second.status.visible, true, "Hiding one window must preserve its sibling's visibility");
  assert.equal(first.shouldClose, false);
  // Both hidden exercises the real no-match exit; the same query must also
  // retry an empty result while either window is being shown asynchronously.
  second.setVisible(false);
  await until(() => !second.status.visible);
  await until(async () => (await visibleIds()).length === 0);
  assert.deepEqual(await visibleIds(), []);
  second.setVisible(true);
  await until(() => second.status.visible);
  await until(async () => (await visibleIds()).includes(secondId));
  first.setVisible(true);
  await until(() => first.status.visible);
  await until(async () => (await visibleIds()).includes(firstId));
  // Programmatic sizing also works for a non-resizable window; WM user resizing remains disabled.
  second.setSize(380, 260);
  await until(() => second.metrics.width === 380 && second.metrics.height === 260);

  for(const size of [0, -1, 1.5, NaN, Infinity, 2147483648]) {
    assert.throws(() => first.setSize(size, 300), /Size/);
    assert.throws(() => first.setSize(300, size), /Size/);
  }
  for(const coordinate of [1.5, NaN, Infinity, -2147483649, 2147483648]) {
    assert.throws(() => first.setPosition(coordinate, 100), /Position/);
    assert.throws(() => first.setPosition(100, coordinate), /Position/);
  }
  assert.throws(() => first.setTitle("bad\0title"), /null/);
  assert.throws(() => Reflect.apply(first.setTitle, first, [42]), /string/i);
  assert.throws(() => Reflect.apply(first.setVisible, first, ["yes"]), /boolean/i);
  assert.throws(() => Reflect.apply(first.setSize, first, ["640", 400]), /number/i);

  const transitions: string[] = [];
  first.on("minimize", event => {
    assert.ok(Object.isFrozen(event));
    assert.equal(first.status.minimized, true);
    assert.equal(first.metrics.drawable, false);
    transitions.push(event.type);
    guards();
  });
  first.on("restore", event => {
    assert.equal(first.status.minimized, false);
    assert.equal(first.metrics.drawable, true);
    transitions.push(event.type);
  });
  await xdo("windowminimize", "--sync", firstId);
  await until(() => transitions.length === 1);
  await xdo("windowmap", "--sync", firstId);
  await xdo("windowactivate", "--sync", firstId);
  await until(() => transitions.length === 2 && first.input.focused);
  assert.deepEqual(transitions, ["minimize", "restore"]);
  assert.equal(second.status.minimized, false);

  // A canceled OS close preserves capture/held input and a usable presentation.
  await xdo("keydown", "w");
  await until(() => first.isKeyDown(Key.W));
  first.setPointerCapture(true);
  let requests = 0;
  let retained: CloseRequestEvent | undefined;
  const offCancel = first.on("closeRequest", event => {
    requests++;
    retained = event;
    assert.throws(() => first.shouldClose, /in progress/);
    assert.equal(event.defaultPrevented, false);
    event.preventDefault();
    event.preventDefault();
    guards();
    assert.ok(Object.isFrozen(event));
  });
  const canceledSeen: boolean[] = [];
  const offSeen = first.on("closeRequest", event => { canceledSeen.push(event.defaultPrevented); });
  await closeRequest(firstId, 3);
  await until(() => requests === 1);
  assert.deepEqual(canceledSeen, [true]);
  assert.equal(first.shouldClose, false);
  assert.equal(first.input.pointerCaptured, true);
  assert.equal(first.isKeyDown(Key.W), true);
  assert.throws(() => retained!.preventDefault(), /synchronous/);
  const renderGuard = first.on("render", () => { guards(); });
  await renderFrames(app, first);
  renderGuard();
  first.setPointerCapture(false);
  await xdo("keyup", "w");
  await until(() => !first.isKeyDown(Key.W));
  offCancel();
  offSeen();

  // Failure consumes/cancels the request and drops all commands; a retry works.
  for(const sentinel of [undefined, Symbol("close listener failed")]) {
    let attempted = false;
    const enqueue = first.on("closeRequest", () => { first.requestClose(); first.setPointerCapture(true); });
    const off = first.on("closeRequest", () => { attempted = true; throw sentinel; });
    await closeRequest(firstId);
    let failed = false;
    const deadline = performance.now() + 3000;
    while(!failed) {
      assert.ok(performance.now() < deadline);
      try { app.pollEvents(); } catch (error) { assert.equal(error, sentinel); failed = true; }
      if(!failed) await setTimeout(10);
    }
    assert.equal(attempted, true);
    enqueue();
    off();
    assert.equal(first.shouldClose, false);
    assert.equal(first.input.pointerCaptured, false);
    app.pollEvents();
    assert.equal(first.shouldClose, false);
  }
  const offAsync = Reflect.apply(first.on, first, ["closeRequest", async () => {
    first.requestClose();
    throw new Error("Consumed close listener rejection");
  }]) as () => void;
  await closeRequest(firstId);
  await assert.rejects(app.run(), /return undefined synchronously/);
  offAsync();
  assert.equal(first.shouldClose, false);

  // Auto-acceptance is queued at the close event, but a later event failure
  // still cancels it. Deliver both real native events in one manual poll.
  let earlierClose = false;
  const offEarlier = first.on("closeRequest", () => { earlierClose = true; });
  const laterFailure = Symbol("later key listener");
  const offLater = first.on("key", event => { if(event.key === Key.V) throw laterFailure; });
  await closeRequest(firstId);
  await xdo("keydown", "v");
  await xdo("keyup", "v");
  await setTimeout(30);
  assert.throws(() => app.pollEvents(), error => error === laterFailure);
  assert.equal(earlierClose, true);
  assert.equal(first.shouldClose, false);
  offEarlier();
  offLater();

  // Native command failure before default acceptance leaves the window open.
  await xdo("windowactivate", "--sync", secondId);
  await until(() => !first.input.focused && second.input.focused);
  const offBadCapture = first.on("closeRequest", () => { first.setPointerCapture(true); });
  await closeRequest(firstId);
  await setTimeout(30);
  assert.throws(() => app.pollEvents(), /open, focused/);
  assert.equal(first.shouldClose, false);
  offBadCapture();
  await xdo("windowactivate", "--sync", firstId);
  await until(() => first.input.focused);

  // Shared subscription semantics: additions wait a batch, removals are immediate,
  // and duplicate subscriptions remain independently removable.
  let duplicates = 0;
  function duplicate(event: CloseRequestEvent) { duplicates++; event.preventDefault(); return undefined; }
  const offDuplicate = first.on("closeRequest", duplicate);
  const offOtherDuplicate = first.on("closeRequest", duplicate);
  await closeRequest(firstId);
  await until(() => duplicates === 2);
  offDuplicate();
  offDuplicate();
  let late = 0;
  let added = false;
  let offLate: (() => void) | undefined;
  const offMutate = first.on("closeRequest", event => {
    event.preventDefault();
    removed();
    if(!added) { added = true; offLate = first.on("closeRequest", () => { late++; }); }
  });
  const removed = first.on("closeRequest", () => { assert.fail("Removed listener ran"); });
  await closeRequest(firstId);
  await until(() => duplicates === 3);
  assert.equal(late, 0);
  await closeRequest(firstId);
  await until(() => duplicates === 4);
  assert.equal(late, 1);
  offMutate();
  offOtherDuplicate();
  offLate?.();

  // Paused runs continue lifecycle progress. First close leaves the other window
  // active; accepting the final OS close ends the run without disposal.
  let pausedRequests = 0;
  const offPaused = first.on("closeRequest", event => { pausedRequests++; event.preventDefault(); });
  let secondRequests = 0;
  second.on("closeRequest", () => { secondRequests++; });
  const offTick = app.on("fixedUpdate", () => { assert.fail("Paused fixed update"); });
  const offFrame = first.on("render", () => { assert.fail("Paused render"); });
  running = app.run().catch(error => { runError = error ?? new Error("Run threw undefined"); }).finally(() => { runEnded = true; });
  app.pause();
  await closeRequest(firstId);
  await until(() => pausedRequests === 1);
  assert.equal(first.shouldClose, false);
  first.setTitle("hostframe paused title");
  assert.equal(await xdo("getwindowname", firstId), "hostframe paused title");
  first.setSize(600, 360);
  await until(() => first.metrics.width === 600 && first.metrics.height === 360);
  offPaused();
  await closeRequest(firstId);
  await until(() => first.shouldClose);
  assert.equal(second.shouldClose, false);
  assert.equal(app.pollEvents(), true);
  for(const control of controls()) assert.throws(control, /closed/);
  offTick();
  offFrame();
  await closeRequest(secondId);
  await until(() => second.shouldClose);
  await running;
  running = undefined;
  if(runError) throw runError;
  assert.equal(secondRequests, 1);
  assert.equal(app.pollEvents(), false);
  assert.equal(context.getConfiguration()!.device, device);
  first.dispose();
  first.dispose();
  for(const control of controls()) assert.throws(control, /disposed/);
  assert.throws(() => first.status, /disposed/);
  assert.throws(() => first.on("closeRequest", () => {}), /disposed/);
  const force = app.createWindow();
  force.on("closeRequest", () => { assert.fail("requestClose must remain the force path"); });
  force.requestClose();
  assert.equal(app.pollEvents(), false);
  force.dispose();
  // Stopping in a close listener does not cancel a successful batch's acceptance.
  const stopped = app.createWindow({ title: "hostframe lifecycle stop" });
  const stoppedId = (await xdo("search", "--all", "--pid", String(process.pid), "--name", "^hostframe lifecycle stop$")).split("\n")[0]!;
  let stopRequest = false;
  stopped.on("closeRequest", () => { stopRequest = true; app.stop(); });
  await closeRequest(stoppedId);
  await app.run();
  assert.equal(stopRequest, true);
  assert.equal(stopped.shouldClose, true);
  stopped.dispose();

  // Force-close suppresses an OS request that has not yet been delivered.
  const pending = app.createWindow({ title: "hostframe lifecycle pending" });
  const pendingId = (await xdo("search", "--all", "--pid", String(process.pid), "--name", "^hostframe lifecycle pending$")).split("\n")[0]!;
  pending.on("closeRequest", () => { assert.fail("Force-closed window delivered a stale prompt"); });
  await closeRequest(pendingId);
  pending.requestClose();
  assert.equal(app.pollEvents(), false);
  pending.dispose();
  app.dispose();

  // Check operation and argument guards directly at the native boundary too.
  const native = new NativeApplication();
  try {
    const window = native.createWindow(getProcessGPU());
    window.dispatchInput(() => {
      assert.throws(() => window.setTitle("reentrant"), /in progress/);
      assert.throws(() => window.setSize(10, 20), /in progress/);
      assert.throws(() => window.setPosition(10, 20), /in progress/);
      assert.throws(() => window.setVisible(false), /in progress/);
    });
    assert.throws(() => window.setSize(1.5, 20), /Size/);
    assert.throws(() => window.setPosition(NaN, 20), /Position/);
    window.dispose();
    assert.throws(() => window.setTitle("disposed"), /disposed/);
  } finally { native.dispose(); }
  console.log(`${process.versions.bun ? "Bun" : "Node.js"}: lifecycle controls, native WM_DELETE_WINDOW cancellation/retry/accept, pause, multiwindow isolation, listener policy, guards and disposal passed.`);
} finally {
  await xdo("keyup", "w").catch(() => {});
  app.stop();
  await running;
  try { app.dispose(); } finally { device?.destroy(); }
}
