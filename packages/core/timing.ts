export type RunOptions = {
  /** Simulation steps per second. Default: 60. */
  updateHz?: number,
  /** Maximum catch-up steps per loop iteration. Default: 8. */
  maxCatchUpUpdates?: number,
  /** Maximum admitted elapsed time per iteration, in seconds. Default: 0.25. */
  maxFrameTime?: number,
  /** Optional render-rate limit. Omit for no scheduler-imposed limit. */
  maxFPS?: number
};

export type FixedUpdateEvent = Readonly<{
  /** Constant simulation timestep in seconds. */
  dt: number,
  /** Simulation step number, starting at 1 for each run. */
  tick: number
}>;

export type RenderEvent = Readonly<{
  /** Fraction of the next simulation step, in [0, 1). */
  alpha: number,
  /** Measured elapsed time since the preceding iteration, in seconds. */
  frameTime: number,
  /** Elapsed time discarded by catch-up limits since the preceding render event. */
  droppedTime: number,
  /** Render iteration number, starting at 1 for each run. */
  frame: number
}>;

function positive(value: number, name: string) {
  if(!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be finite and positive`);
  return value;
}

export function loopOptions(options: RunOptions) {
  const updateHz = positive(options.updateHz ?? 60, "updateHz");
  const maxCatchUpUpdates = options.maxCatchUpUpdates ?? 8;
  const maxFrameTime = positive(options.maxFrameTime ?? 0.25, "maxFrameTime");
  if(!Number.isSafeInteger(maxCatchUpUpdates) || maxCatchUpUpdates < 1) {
    throw new RangeError("maxCatchUpUpdates must be a positive safe integer");
  }
  const dt = 1 / updateHz;
  if(!Number.isFinite(dt) || !Number.isSafeInteger(Math.ceil(maxFrameTime * updateHz))) {
    throw new RangeError("updateHz and maxFrameTime exceed the supported timing range");
  }
  const frameInterval = options.maxFPS === undefined ? 0 : 1000 / positive(options.maxFPS, "maxFPS");
  if(!Number.isFinite(frameInterval)) throw new RangeError("maxFPS is too small");
  return { updateHz, dt, maxCatchUpUpdates, maxFrameTime, frameInterval };
}

/** Accumulates fractional ticks, independent of rendering and the host event loop. */
export class FixedStepClock {
  readonly options: ReturnType<typeof loopOptions>;
  #remainder = 0;

  constructor(options: RunOptions = {}) {
    this.options = loopOptions(options);
  }

  reset() {
    this.#remainder = 0;
  }

  get timeUntilUpdate() {
    return (1 - this.#remainder) * this.options.dt;
  }

  advance(elapsed: number) {
    if(!Number.isFinite(elapsed) || elapsed < 0) throw new RangeError("Elapsed time must be finite and nonnegative");
    const { updateHz, dt, maxCatchUpUpdates, maxFrameTime } = this.options;
    const admitted = Math.min(elapsed, maxFrameTime);
    const accumulated = this.#remainder + admitted * updateHz;
    // Absorb roundoff at whole-tick boundaries, without carrying a near-one
    // remainder into the next frame after an exact fixed-step interval.
    const ticks = Math.floor(accumulated + 1e-9);
    this.#remainder = Math.max(0, accumulated - ticks);
    const updates = Math.min(ticks, maxCatchUpUpdates);
    return {
      updates,
      alpha: this.#remainder,
      droppedTime: elapsed - admitted + (ticks - updates) * dt
    };
  }
}
