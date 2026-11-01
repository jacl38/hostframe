import type { NativeWindow } from "../native/bridge.ts";
import { freezeInput, InputListeners } from "./input.ts";
import type { InputState, WindowEvents } from "./input.ts";

/** A native window owned by its Application. Dispose before destroying its device. */
export class Window {
  #native: NativeWindow;
  #listeners = new InputListeners();
  #input!: InputState;

  /** @internal Created by Application.createWindow. */
  constructor(native: NativeWindow) {
    this.#native = native;
    this.dispatchInput();
  }

  get presentMode() { return this.#native.presentMode; }
  get shouldClose() { return this.#native.shouldClose; }

  /** Immutable polled state, also updated by capture/close commands. Safe in input/draw callbacks. */
  get input() {
    this.#requireAlive();
    return this.#input;
  }

  isKeyDown(key: number) { return this.input.keys.includes(key); }
  isScancodeDown(scancode: number) { return this.input.scancodes.includes(scancode); }
  isButtonDown(button: number) { return this.input.buttons.includes(button); }

  on<Event extends keyof WindowEvents>(event: Event, listener: (event: WindowEvents[Event]) => undefined) {
    this.#requireAlive();
    return this.#listeners.on(event, listener);
  }

  /** Hidden, unlimited virtual pointer motion. Explicit raw mode throws if unsupported. */
  setPointerCapture(captured: boolean, rawMotion = false) {
    this.#input = freezeInput(this.#native.setPointerCapture(captured, rawMotion));
  }

  requestClose() { this.#input = freezeInput(this.#native.requestClose()); }

  /** Submit synchronously. Textures/views expire on return; unavailable frames skip the callback. */
  draw(callback: (texture: GPUTexture) => undefined) { this.#native.draw(callback); }

  dispose() {
    try {
      this.#native.dispose();
    } finally {
      if(this.#native.disposed) this.#listeners.clear();
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

/** @deprecated Use Window. */
export type FixedWindow = Window;
