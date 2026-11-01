import { expect, test } from "bun:test";
import { freezeInput, InputListeners } from "../input.ts";
import type { InputEvent } from "../input.ts";

const press: InputEvent = { type: "key", key: 65, scancode: 38, action: "press", modifiers: 0, synthetic: false };

test("input additions wait until next batch, removals apply immediately, duplicates are independent", () => {
  const listeners = new InputListeners();
  const calls: string[] = [];
  let added = false;
  listeners.on("key", () => {
    calls.push("first");
    removed();
    if(!added) {
      added = true;
      listeners.on("key", () => { calls.push("added"); });
    }
  });
  const removed = listeners.on("key", () => { calls.push("removed"); });
  function duplicate() { calls.push("duplicate"); return undefined; }
  const off = listeners.on("key", duplicate);
  listeners.on("key", duplicate);
  listeners.dispatch([press, press]);
  expect(calls).toEqual(["first", "duplicate", "duplicate", "first", "duplicate", "duplicate"]);
  calls.length = 0;
  removed();
  off();
  off();
  listeners.dispatch([press]);
  expect(calls).toEqual(["first", "duplicate", "added"]);
});

test("input errors preserve thrown values and drop the rest of a batch; async returns are rejected", async () => {
  const listeners = new InputListeners();
  const sentinel = Symbol("input failure");
  const off = listeners.on("key", () => { throw sentinel; });
  listeners.on("key", () => { throw new Error("Must not run"); });
  try {
    listeners.dispatch([press]);
    throw new Error("Must throw");
  } catch (error) {
    expect(error).toBe(sentinel);
  }
  off();
  listeners.clear();
  Reflect.apply(listeners.on, listeners, ["key", async () => { throw new Error("Rejected promise is consumed"); }]);
  expect(() => listeners.dispatch([press])).toThrow("return undefined synchronously");
  await Promise.resolve();
});

test("input contracts reject invalid subscriptions and protect retained snapshots/events", () => {
  const listeners = new InputListeners();
  expect(() => Reflect.apply(listeners.on, listeners, ["unknown", () => {}])).toThrow("Unknown window event");
  expect(() => Reflect.apply(listeners.on, listeners, ["key", null])).toThrow("listener");
  const snapshot = freezeInput({ keys: [65], scancodes: [38], buttons: [0], focused: true, pointerCaptured: false, rawMotion: false, x: 1.5, y: 2.5 });
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.keys)).toBe(true);
  expect(Object.isFrozen(snapshot.scancodes)).toBe(true);
  expect(Object.isFrozen(snapshot.buttons)).toBe(true);
  listeners.on("key", event => { expect(Object.isFrozen(event)).toBe(true); });
  listeners.dispatch([press]);
  listeners.clear();
  listeners.dispatch([press]);
});
