import { expect, test } from "bun:test";
import { Window } from "../window.ts";
import type { NativeWindow } from "../../native/bridge.ts";
import type { InputState, InputEvent } from "../input.ts";

// Narrow transport seam: public Window consumes native-shaped batches. The
// conversion and listener implementation are production code, not reimplemented.
test("public metrics consume atomic batches and convert actual anisotropic sizes", () => {
  let state: InputState = {
    status: { x: 0, y: 0, visible: true, minimized: false },
    metrics: { width: 400, height: 200, framebufferWidth: 800, framebufferHeight: 600, contentScaleX: 1.25, contentScaleY: 1.5, drawable: true },
    keys: [], scancodes: [], buttons: [], focused: true, pointerCaptured: false, rawMotion: false, x: 0, y: 0
  };
  let events: InputEvent[] = [];
  const transport = {
    disposed: false,
    dispatchInput(callback: Parameters<NativeWindow["dispatchInput"]>[0]) { return callback(state, events); }
  };
  const window = new Window(transport as NativeWindow);
  expect(window.toFramebuffer(100, 50)).toEqual({ x: 200, y: 150 });
  expect(window.toFramebuffer(-1, 201)).toEqual({ x: -2, y: 603 });
  expect(() => window.toFramebuffer(NaN, 0)).toThrow(TypeError);
  const old = window.metrics;
  const order: string[] = [];
  window.on("metrics", event => {
    expect(event.metrics).toBe(window.metrics);
    expect(Object.isFrozen(event.metrics)).toBe(true);
    order.push("metrics");
  });
  window.on("pointerMove", event => {
    expect(window.toFramebuffer(event.x, event.y)).toEqual({ x: 75, y: 100 });
    order.push("pointer");
  });
  state = { ...state, metrics: { ...state.metrics, framebufferWidth: 600, framebufferHeight: 400 } };
  events = [{ type: "metrics", metrics: state.metrics }, { type: "pointerMove", x: 50, y: 50, deltaX: 0, deltaY: 0, captured: false }];
  window.dispatchInput();
  expect(order).toEqual(["metrics", "pointer"]);
  expect(old.framebufferWidth).toBe(800);
  // A scale-only batch updates UI density without changing pixel conversion.
  state = { ...state, metrics: { ...state.metrics, contentScaleX: 2, contentScaleY: 2 } };
  events = [{ type: "metrics", metrics: state.metrics }];
  window.dispatchInput();
  expect(window.metrics.contentScaleX).toBe(2);
  expect(window.toFramebuffer(50, 50)).toEqual({ x: 75, y: 100 });
  expect(order).toEqual(["metrics", "pointer", "metrics"]);
  for(const metrics of [{ ...state.metrics, drawable: false }, { ...state.metrics, width: 0, drawable: false }]) {
    state = { ...state, metrics };
    events = [];
    window.dispatchInput();
    expect(window.toFramebuffer(1, 2)).toBeUndefined();
  }
  transport.disposed = true;
  expect(() => window.metrics).toThrow("disposed");
  expect(() => window.toFramebuffer(1, 2)).toThrow("disposed");
});
