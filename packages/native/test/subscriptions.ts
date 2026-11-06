import assert from "node:assert/strict";
import { Application } from "../../../index.ts";
import { InputListeners } from "../../core/input.ts";
import { checkAdapter } from "./adapter.ts";
import { configureWindow } from "./frames.ts";

// Exercise the same contract through each owner, independently of its storage.
const app = new Application();
let device: GPUDevice | undefined;
try {
  const window = app.createWindow();
  const adapter = await app.gpu.requestAdapter();
  assert.ok(adapter);
  checkAdapter(adapter);
  device = await adapter.requestDevice();
  configureWindow(app, window, device);
  const input = new InputListeners();
  const owners = [
    { name: "fixedUpdate", on: (listener: () => undefined) => app.on("fixedUpdate", listener), dispatch: () => app.run({ updateHz: 1000 }) },
    { name: "render", on: (listener: () => undefined) => window.on("render", listener), dispatch: () => app.run() },
    { name: "input", on: (listener: () => undefined) => input.on("focus", listener), dispatch: async () => { input.dispatch([{ type: "focus", focused: true }]); } }
  ];
  for(const owner of owners) {
    const calls: string[] = [];
    const off: Array<() => void> = [];
    let added = false;
    off.push(owner.on(() => {
      calls.push("first");
      removed();
      if(!added) {
        added = true;
        off.push(owner.on(() => { calls.push("added"); }));
      }
    }));
    const removed = owner.on(() => { calls.push("removed"); });
    function duplicate() { calls.push("duplicate"); return undefined; }
    const duplicateOne = owner.on(duplicate);
    off.push(owner.on(duplicate));
    let stopping = owner.on(() => { app.stop(); });
    await owner.dispatch();
    assert.deepEqual(calls, ["first", "duplicate", "duplicate"], owner.name);
    duplicateOne();
    duplicateOne();
    removed();
    removed();
    calls.length = 0;
    // For scheduled owners, stop skips additions after its turn. Move stop last.
    stopping();
    stopping = owner.on(() => { app.stop(); });
    await owner.dispatch();
    assert.deepEqual(calls, ["first", "duplicate", "added"], owner.name);
    stopping();
    for(const unsubscribe of off) unsubscribe();

    for(const sentinel of [undefined, null, Symbol(owner.name), new Error(owner.name)]) {
      const failure = owner.on(() => { throw sentinel; });
      const later = owner.on(() => { assert.fail("Dispatch continued after failure"); });
      let threw = false;
      try { await owner.dispatch(); } catch (error) { threw = true; assert.equal(error, sentinel); }
      assert.equal(threw, true, owner.name);
      failure();
      later();
    }
    const rejected = new Error("Returned rejection must be consumed");
    const asyncOff = owner.on((() => Promise.reject(rejected)) as unknown as () => undefined);
    await assert.rejects(owner.dispatch(), /return undefined synchronously/);
    asyncOff();
    const valueOff = owner.on((() => 42) as unknown as () => undefined);
    await assert.rejects(owner.dispatch(), /return undefined synchronously/);
    valueOff();
    await new Promise(resolve => setImmediate(resolve));
  }
  console.log(`${process.versions.bun ? "Bun" : "Node.js"}: cross-owner subscription contracts passed.`);
} finally {
  try { app.dispose(); } finally { device?.destroy(); }
}
