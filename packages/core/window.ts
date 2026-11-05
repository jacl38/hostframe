import type { NativeWindow } from "../native/bridge.ts";
import { freezeInput, InputListeners } from "./input.ts";
import type { InputState, WindowInputEvents } from "./input.ts";
import { WindowGPUContext } from "./context.ts";
import type { RenderEvent } from "./timing.ts";

export type WindowEvents = WindowInputEvents & { render: RenderEvent };

/** A native window owned by its Application. Dispose before destroying its device. */
export class Window {
  #native: NativeWindow;
  #listeners = new InputListeners();
  #input!: InputState;
  #context: WindowGPUContext | undefined;
  #renderListeners = new Set<{ callback: (event: RenderEvent) => undefined }>();
  #renderEvent!: RenderEvent;
  #active!: () => boolean;
  #render: () => undefined;

  /** @internal Created by Application.createWindow. */
  constructor(native: NativeWindow) {
    this.#native = native;
    this.#render = this.#emitRender.bind(this);
    this.dispatchInput();
  }

  get presentMode() { return this.#native.presentMode; }
  get shouldClose() { return this.#native.shouldClose; }

  /** Immutable polled state, also updated by capture/close commands. Safe in input/render callbacks. */
  get input() {
    this.#requireAlive();
    return this.#input;
  }

  isKeyDown(key: number) { return this.input.keys.includes(key); }
  isScancodeDown(scancode: number) { return this.input.scancodes.includes(scancode); }
  isButtonDown(button: number) { return this.input.buttons.includes(button); }

  on<Event extends keyof WindowEvents>(event: Event, listener: (event: WindowEvents[Event]) => undefined) {
    this.#requireAlive();
    if(event === "render") {
      if(typeof listener !== "function") throw new TypeError("Expected a window listener");
      const entry = { callback: listener as (event: RenderEvent) => undefined };
      this.#renderListeners.add(entry);
      return () => { this.#renderListeners.delete(entry); };
    }
    return this.#listeners.on(event as keyof WindowInputEvents, listener as (event: WindowInputEvents[keyof WindowInputEvents]) => undefined);
  }

  getContext(type: "webgpu") {
    this.#requireAlive();
    if(type !== "webgpu") throw new TypeError("Only the webgpu context is supported");
    this.#context ??= new WindowGPUContext(this.#native);
    return this.#context;
  }

  /** @internal The application owns scheduling; the context owns the native frame. */
  dispatchRender(event: RenderEvent, active: () => boolean) {
    if(this.#native.disposed || !this.#renderListeners.size) return;
    this.#renderEvent = event;
    this.#active = active;
    this.#context?.render(this.#render);
  }

  #emitRender() {
    const snapshot = Array.from(this.#renderListeners);
    for(const entry of snapshot) {
      if(!this.#active()) break;
      if(!this.#renderListeners.has(entry)) continue;
      const result: unknown = entry.callback(this.#renderEvent);
      if(result !== undefined) {
        void Promise.resolve(result).catch(() => {});
        throw new TypeError("render listeners must return undefined synchronously");
      }
    }
    return undefined;
  }

  /** Hidden, unlimited virtual pointer motion. Explicit raw mode throws if unsupported. */
  setPointerCapture(captured: boolean, rawMotion = false) {
    this.#input = freezeInput(this.#native.setPointerCapture(captured, rawMotion));
  }

  requestClose() { this.#input = freezeInput(this.#native.requestClose()); }

  dispose() {
    try {
      this.#native.dispose();
    } finally {
      if(this.#native.disposed) {
        this.#listeners.clear();
        this.#renderListeners.clear();
        this.#context?.release();
        this.#context = undefined;
      }
    }
  }

  /** @internal Dispatch under the native application operation guard. */
  dispatchInput() {
    if(this.#native.disposed) return;
    this.#native.dispatchInput((state, events) => {
      this.#input = freezeInput(state);
      this.#listeners.dispatch(events);
    });
  }

  #requireAlive() {
    if(this.#native.disposed) throw new Error("Window is disposed");
  }
}
