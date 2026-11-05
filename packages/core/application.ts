import { getProcessGPU, NativeApplication } from "../native/bridge.ts";
import type { WindowOptions } from "../native/bridge.ts";
import { Window } from "./window.ts";
import { ApplicationLoop } from "./loop.ts";
import type { FixedUpdateEvent, RunOptions } from "./timing.ts";

/** Owns one GLFW session and its window. Construct on the process main thread. */
export class Application {
  /** Rooted until process exit: upstream child GPU objects do not retain their owner. */
  readonly gpu: GPU;
  #native: NativeApplication;
  #loop: ApplicationLoop | undefined;
  #window: Window | undefined;
  #listeners = new Set<{ callback: (event: FixedUpdateEvent) => undefined }>();

  constructor() {
    this.#native = new NativeApplication();
    try {
      this.gpu = getProcessGPU();
    } catch (error) {
      this.#native.dispose();
      throw error;
    }
  }

  createWindow(options: WindowOptions = {}) {
    this.#window = new Window(this.#native.createWindow(this.gpu, options));
    return this.#window;
  }

  /** Pumps native events without rendering. Returns whether any window is open. */
  pollEvents() {
    const open = this.#native.pollEvents();
    this.#window?.dispatchInput();
    return open;
  }

  /** Registers a synchronous listener and returns an idempotent unsubscribe function. */
  on(event: "fixedUpdate", listener: (event: FixedUpdateEvent) => undefined) {
    this.#requireAlive();
    if(event !== "fixedUpdate") throw new TypeError(`Unknown application event: ${String(event)}`);
    const listeners = this.#listeners;
    if(typeof listener !== "function") throw new TypeError("Expected an application listener");
    const entry = { callback: listener };
    listeners.add(entry);
    return () => { listeners.delete(entry); };
  }

  /** Runs until stopped, disposed, or no window remains open. Callback failures reject. */
  run(options: RunOptions = {}) {
    this.#requireAlive();
    if(this.#loop) throw new Error("Application is already running");
    // Enforce the native operation guard before scheduling, including inside rendering.
    // Check guards without delivering input until the run promise is active.
    void this.#native.hasOpenWindows;
    const loop = new ApplicationLoop(options, {
      pollEvents: () => this.pollEvents(),
      fixedUpdate: event => { this.#emitFixedUpdate(event); },
      render: event => {
        if(!loop.active) return;
        if(!this.#native.hasOpenWindows) {
          loop.stop();
          return;
        }
        this.#window?.dispatchRender(event, active);
      }
    });
    function active() { return loop.active; }
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
   * Disposes windows before GLFW. Idempotent; forbidden inside rendering. Devices remain caller-owned.
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
        this.#listeners.clear();
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

  #emitFixedUpdate(value: FixedUpdateEvent) {
    const listeners = this.#listeners;
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
        throw new TypeError("fixedUpdate listeners must return undefined synchronously");
      }
    }
  }
}
