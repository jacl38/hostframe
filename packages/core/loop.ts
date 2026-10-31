import { setImmediate, setTimeout } from "node:timers/promises";
import { FixedStepClock, type FixedUpdateEvent, type RenderEvent, type RunOptions } from "./timing.ts";

type LoopHooks = {
  pollEvents(): boolean,
  fixedUpdate(event: FixedUpdateEvent): void,
  render(event: RenderEvent): void
};

type LoopHost = {
  now(): number,
  wait(milliseconds: number, signal: AbortSignal): Promise<void>
};

async function wait(milliseconds: number, signal: AbortSignal) {
  if(milliseconds > 0) await setTimeout(Math.min(2_147_483_647, Math.ceil(milliseconds)), undefined, { signal });
  else await setImmediate(undefined, { signal });
}

const host: LoopHost = { now: () => performance.now(), wait };
const pausedPollInterval = 16;

/** Host scheduling is separate from fixed-step accounting and native event pumping. */
export class ApplicationLoop {
  #clock: FixedStepClock;
  #hooks: LoopHooks;
  #host: LoopHost;
  #abort = new AbortController();
  #waiting: AbortController | undefined;
  #paused = false;
  #resetTime = false;

  constructor(options: RunOptions, hooks: LoopHooks, scheduling: LoopHost = host) {
    this.#clock = new FixedStepClock(options);
    this.#hooks = hooks;
    this.#host = scheduling;
  }

  get active() {
    return !this.#abort.signal.aborted && !this.#paused;
  }

  stop() {
    this.#abort.abort();
    this.#waiting?.abort();
  }

  pause() {
    if(this.#paused) return;
    this.#paused = true;
    this.#resetTime = true;
    this.#clock.reset();
    this.#waiting?.abort();
  }

  resume() {
    if(!this.#paused) return;
    this.#paused = false;
    this.#resetTime = true;
    this.#waiting?.abort();
  }

  async run() {
    let previous = this.#host.now();
    let previousRender = previous;
    let deadline = previous;
    let droppedTime = 0;
    let tick = 0;
    let frame = 0;
    try {
      while(!this.#abort.signal.aborted) {
        // Always yield a host turn, even when uncapped. A resolved promise alone
        // would starve I/O and the binding's asynchronous GPU progress callbacks.
        const nextUpdate = previous + this.#clock.timeUntilUpdate * 1000;
        const nextWake = Math.min(deadline, nextUpdate);
        const delay = this.#paused ? pausedPollInterval : this.#resetTime ? 0 : Math.max(0, nextWake - this.#host.now());
        const waiting = new AbortController();
        this.#waiting = waiting;
        try {
          await this.#host.wait(delay, waiting.signal);
        } catch (error) {
          if(waiting.signal.aborted) continue;
          throw error;
        } finally {
          this.#waiting = undefined;
        }
        if(this.#abort.signal.aborted || !this.#hooks.pollEvents()) break;
        const now = this.#host.now();
        if(this.#paused) continue;
        const resumed = this.#resetTime;
        const elapsed = resumed ? 0 : Math.max(0, (now - previous) / 1000);
        this.#resetTime = false;
        if(resumed) {
          previousRender = now;
          droppedTime = 0;
        }
        previous = now;
        const timing = this.#clock.advance(elapsed);
        droppedTime += timing.droppedTime;
        for(let step = 0; step < timing.updates && this.active; step++) {
          this.#hooks.fixedUpdate({ dt: this.#clock.options.dt, tick: ++tick });
        }
        const renderTime = this.#host.now();
        if(this.active && (resumed || renderTime >= deadline)) {
          const frameTime = resumed ? 0 : Math.max(0, (renderTime - previousRender) / 1000);
          previousRender = renderTime;
          deadline = renderTime + this.#clock.options.frameInterval;
          this.#hooks.render({ alpha: timing.alpha, droppedTime, frameTime, frame: ++frame });
          droppedTime = 0;
        }
      }
    } finally {
      this.stop();
    }
  }
}
