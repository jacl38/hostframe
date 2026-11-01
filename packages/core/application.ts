import { getProcessGPU, NativeApplication } from "../native/bridge.ts";
import type { WindowOptions } from "../native/bridge.ts";
import { Window } from "./window.ts";
import { ApplicationLoop } from "./loop.ts";
import type { FixedUpdateEvent, RenderEvent, RunOptions } from "./timing.ts";

type ApplicationEvents = {
  fixedUpdate: FixedUpdateEvent,
  render: RenderEvent
};

type Listeners = {
  [Event in keyof ApplicationEvents]: Set<{ callback: (event: ApplicationEvents[Event]) => undefined }>
};

/** Owns one GLFW session and its window. Construct on the process main thread. */
export class Application {
  /** Rooted until process exit: upstream child GPU objects do not retain their owner. */
  readonly gpu: GPU;
  #native: NativeApplication;
  #loop: ApplicationLoop | undefined;
  #window: Window | undefined;
  #listeners: Listeners = { fixedUpdate: new Set(), render: new Set() };

  constructor() {
    this.#native = new NativeApplication();
    try {
      this.gpu = getProcessGPU();
    } catch (error) {
      this.#native.dispose();
      throw error;
    }
  }

  /** One live window (default: fixed 320×240), retaining a caller-owned device obtained through app.gpu. */
  createWindow(device: GPUDevice, options: WindowOptions = {}) {
    this.#window = new Window(this.#native.createWindow(device, options));
    return this.#window;
  }

  /** Pumps native events without rendering. Returns whether any window is open. */
  pollEvents() {
    const open = this.#native.pollEvents();
    this.#window?.dispatchInput();
    return open;
  }

  /** Registers a synchronous listener and returns an idempotent unsubscribe function. */
  on<Event extends keyof ApplicationEvents>(event: Event, listener: (event: ApplicationEvents[Event]) => undefined) {
    this.#requireAlive();
    if(!Object.hasOwn(this.#listeners, event)) throw new TypeError(`Unknown application event: ${String(event)}`);
    const listeners = this.#listeners[event];
    if(typeof listener !== "function") throw new TypeError("Expected an application listener");
    const entry = { callback: listener };
    listeners.add(entry);
    return () => { listeners.delete(entry); };
  }

  /** Runs until stopped, disposed, or no window remains open. Callback failures reject. */
  run(options: RunOptions = {}) {
    this.#requireAlive();
    if(this.#loop) throw new Error("Application is already running");
    // Enforce the native operation guard before scheduling, including inside draw.
    // Check guards without delivering input until the run promise is active.
    void this.#native.hasOpenWindows;
    const loop = new ApplicationLoop(options, {
      pollEvents: () => this.pollEvents(),
      fixedUpdate: event => { this.#emit("fixedUpdate", event); },
      render: event => { this.#emit("render", event); }
    });
    this.#loop = loop;
    return loop.run().finally(() => {
      this.#loop = undefined;
    });
  }

  /** Stops pending work; await the run promise before starting another run. */
  stop() {
    this.#loop?.stop();
  }

  /** Pauses callbacks while continuing native event polling. */
  pause() {
    this.#requireLoop().pause();
  }

  /** Resumes with no catch-up for paused time; clears the interpolation remainder. */
  resume() {
    this.#requireLoop().resume();
  }

  /**
   * Disposes windows before GLFW. Idempotent; forbidden inside draw. Devices remain caller-owned.
   * A GPU cleanup timeout destroys the stalled device and throws after cleanup.
   */
  dispose() {
    try {
      this.#native.dispose();
    } finally {
      // A native cleanup timeout still disposes the session. A rejected reentrant
      // disposal leaves it alive and must not cancel an otherwise healthy run.
      if(this.#native.disposed) {
        this.stop();
        this.#window?.dispose();
        this.#window = undefined;
        this.#listeners.fixedUpdate.clear();
        this.#listeners.render.clear();
      }
    }
  }

  #requireAlive() {
    if(this.#native.disposed) throw new Error("Application is disposed");
  }

  #requireLoop() {
    this.#requireAlive();
    if(!this.#loop) throw new Error("Application is not running");
    return this.#loop;
  }

  #emit<Event extends keyof ApplicationEvents>(event: Event, value: ApplicationEvents[Event]) {
    const listeners = this.#listeners[event];
    // Snapshot additions; removals take effect before a listener's turn. Stop,
    // pause, close requests, and disposal prevent the remaining callbacks.
    const snapshot = Array.from(listeners);
    for(const listener of snapshot) {
      if(!this.#loop?.active) break;
      if(!this.#native.hasOpenWindows) {
        this.stop();
        break;
      }
      if(!listeners.has(listener)) continue;
      const result: unknown = listener.callback(value);
      if(result !== undefined) {
        // Reject async results without leaving a rejected returned promise orphaned.
        void Promise.resolve(result).catch(() => {});
        throw new TypeError(`${event} listeners must return undefined synchronously`);
      }
    }
  }
}
