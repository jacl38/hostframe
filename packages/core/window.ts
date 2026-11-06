import type { NativeWindow } from "../native/bridge.ts";
import { freezeInput, InputListeners } from "./input.ts";
import type { InputState, WindowInputEvents } from "./input.ts";
import { WindowGPUContext } from "./context.ts";
import { Subscriptions } from "./subscriptions.ts";
import type { RenderEvent } from "./timing.ts";

export type WindowEvents = WindowInputEvents & { render: RenderEvent };

type InputCommand = { type: "close" } | { type: "capture", captured: boolean, rawMotion: boolean };

/** A native window owned by its Application. Dispose before destroying its device. */
export class Window {
  #native: NativeWindow;
  #listeners = new InputListeners();
  #input!: InputState;
  #context: WindowGPUContext | undefined;
  #renderListeners = new Subscriptions<RenderEvent>("render", "a window");
  #renderEvent!: RenderEvent;
  #active!: () => boolean;
  #render: () => undefined;
  #inputCommands: InputCommand[] | undefined;

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
      return this.#renderListeners.add(listener as (event: RenderEvent) => undefined);
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
    this.#renderListeners.snapshot()(this.#renderEvent, this.#active);
    return undefined;
  }

  /** Hidden virtual pointer motion. In input listeners, applied after the successful batch. */
  setPointerCapture(captured: boolean, rawMotion = false) {
    if(this.#inputCommands) {
      if(typeof captured !== "boolean" || typeof rawMotion !== "boolean") throw new TypeError("Pointer capture arguments must be booleans");
      this.#inputCommands.push({ type: "capture", captured, rawMotion });
      return;
    }
    this.#input = freezeInput(this.#native.setPointerCapture(captured, rawMotion));
  }

  /** In input listeners, requested after the successful batch; cancels later capture commands. */
  requestClose() {
    if(this.#inputCommands) {
      this.#inputCommands.push({ type: "close" });
      return;
    }
    this.#input = freezeInput(this.#native.requestClose());
  }

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
    const commands: InputCommand[] = [];
    this.#native.dispatchInput((state, events) => {
      this.#input = freezeInput(state);
      this.#inputCommands = commands;
      try {
        this.#listeners.dispatch(events);
      } finally {
        this.#inputCommands = undefined;
      }
    });
    // Native dispatch must return successfully, releasing ApplicationOperation,
    // before any commands run. A listener/native failure drops this local queue.
    // No JavaScript listener is invoked while applying commands; resulting native
    // notifications stay queued until the next poll, with no recursive dispatch.
    for(const command of commands) {
      if(command.type === "close") {
        this.requestClose();
        break;
      }
      this.setPointerCapture(command.captured, command.rawMotion);
    }
  }

  #requireAlive() {
    if(this.#native.disposed) throw new Error("Window is disposed");
  }
}
