import { expect, test } from "bun:test";
import { FixedStepClock } from "../timing.ts";

test("120 Hz simulation advances equally across low, high, and fractional render rates", () => {
  for(const renderHz of [30, 60, 144, 240, 360, 1000]) {
    const clock = new FixedStepClock({ updateHz: 120 });
    let steps = 0;
    for(let frame = 0; frame < renderHz * 2; frame++) {
      const timing = clock.advance(1 / renderHz);
      steps += timing.updates;
      expect(timing.alpha).toBeGreaterThanOrEqual(0);
      expect(timing.alpha).toBeLessThan(1);
      expect(timing.droppedTime).toBe(0);
    }
    expect(steps).toBe(240);
  }
});

test("fractional simulation time is retained for interpolation and cleared by reset", () => {
  const clock = new FixedStepClock({ updateHz: 120 });
  expect(clock.advance(1 / 240)).toEqual({ updates: 0, alpha: 0.5, droppedTime: 0 });
  expect(clock.advance(1 / 240)).toEqual({ updates: 1, alpha: 0, droppedTime: 0 });
  clock.advance(1 / 240);
  clock.reset();
  expect(clock.advance(0)).toEqual({ updates: 0, alpha: 0, droppedTime: 0 });
});

test("stalls bound catch-up, report discarded time, and preserve only fractional backlog", () => {
  const clock = new FixedStepClock({ updateHz: 120, maxCatchUpUpdates: 3, maxFrameTime: 0.25 });
  const timing = clock.advance(1);
  expect(timing.updates).toBe(3);
  expect(timing.alpha).toBe(0);
  expect(timing.droppedTime).toBeCloseTo(0.975, 12);
  expect(clock.advance(1 / 240)).toEqual({ updates: 0, alpha: 0.5, droppedTime: 0 });
});

test("timing configuration and elapsed values reject invalid numbers", () => {
  for(const value of [0, -1, NaN, Infinity]) {
    expect(() => new FixedStepClock({ updateHz: value })).toThrow();
    expect(() => new FixedStepClock({ maxFrameTime: value })).toThrow();
    expect(() => new FixedStepClock({ maxCatchUpUpdates: value })).toThrow();
    expect(() => new FixedStepClock({ maxFPS: value })).toThrow();
  }
  expect(() => new FixedStepClock({ maxCatchUpUpdates: 1.5 })).toThrow();
  expect(() => new FixedStepClock({ maxCatchUpUpdates: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
  expect(() => new FixedStepClock({ updateHz: Number.MIN_VALUE })).toThrow();
  expect(() => new FixedStepClock({ updateHz: Number.MAX_VALUE })).toThrow();
  expect(() => new FixedStepClock({ maxFPS: Number.MIN_VALUE })).toThrow();
  for(const elapsed of [-1, NaN, Infinity]) expect(() => new FixedStepClock().advance(elapsed)).toThrow();
});
