import { Key, getKeyName } from "./keys.ts";
import { getProcessGPU, NativeApplication } from "../native/bridge.ts";
import type { WindowOptions } from "../native/bridge.ts";
import { Window } from "./window.ts";
import { ApplicationLoop } from "./loop.ts";
import { Subscriptions } from "./subscriptions.ts";
import type { FixedUpdateEvent, RunOptions } from "./timing.ts";

/** Owns one GLFW session and its windows. Construct on the process main thread. */
export class Application {
  /** Rooted until process exit: upstream child GPU objects do not retain their owner. */
  readonly gpu: GPU;
  #native: NativeApplication;
  #loop: ApplicationLoop | undefined;
  #windows = new Set<Window>();
  #listeners = new Subscriptions<FixedUpdateEvent>("fixedUpdate", "an application");

  constructor() {
    this.#native = new NativeApplication();
    try {
      this.gpu = getProcessGPU();
    } catch (error) {
      this.#native.dispose();
      throw error;
    }
  }

  /** Active-layout printable name, falling back to the canonical symbol or UNKNOWN. */
  getKeyLabel(key: number, scancode = -1) {
    this.#requireAlive();
    requireKeyInteger(key);
    requireKeyInteger(scancode);
    // Enforce native thread/session/operation guards even for fallback values.
    void this.#native.hasOpenWindows;
    const name = getKeyName(key);
    if(!name || (key === Key.UNKNOWN && scancode < 0)) return name ?? "UNKNOWN";
    return this.#native.getKeyLabel(key, scancode) || name;
  }

  /** Platform scancode for a known token, or undefined when unavailable. */
  getKeyScancode(key: number) {
    this.#requireAlive();
    requireKeyInteger(key);
    void this.#native.hasOpenWindows;
    if(key === Key.UNKNOWN || !getKeyName(key)) return undefined;
    const scancode = this.#native.getKeyScancode(key);
    return scancode < 0 ? undefined : scancode;
  }

  createWindow(options: WindowOptions = {}) {
    const native = this.#native.createWindow(this.gpu, options);
    try {
      const window = new Window(native, disposed => { this.#windows.delete(disposed); });
      this.#windows.add(window);
      return window;
    } catch (error) {
      native.dispose();
      throw error;
    }
  }

  /** Pumps native events without rendering. Returns whether any window is open. */
  pollEvents() {
    this.#native.pollEvents();
    for(const window of Array.from(this.#windows)) window.dispatchInput();
    // Input commands may have closed windows after native polling returned.
    return this.#native.hasOpenWindows;
  }

  /** Registers a synchronous listener and returns an idempotent unsubscribe function. */
  on(event: "fixedUpdate", listener: (event: FixedUpdateEvent) => undefined) {
    this.#requireAlive();
    if(event !== "fixedUpdate") throw new TypeError(`Unknown application event: ${String(event)}`);
    return this.#listeners.add(listener);
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
        // Snapshot creation order. Each dispatch rechecks native lifecycle;
        // fixed-update mutations have already committed before this snapshot.
        for(const window of Array.from(this.#windows)) {
          if(!loop.active) break;
          window.dispatchRender(event, active);
        }
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
        for(const window of Array.from(this.#windows)) window.dispose();
        this.#windows.clear();
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
    // The application owns stop/pause/close policy, independently of listener mechanics.
    this.#listeners.snapshot()(value, () => {
      if(!this.#loop?.active) return false;
      if(!this.#native.hasOpenWindows) {
        this.stop();
        return false;
      }
      return true;
    });
  }
}

function requireKeyInteger(value: number) {
  if(!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
    throw new RangeError("Key tokens and scancodes must be signed 32-bit integers");
  }
}
