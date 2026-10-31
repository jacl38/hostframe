import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "bun:test";
import { ApplicationLoop } from "../loop.ts";
import type { FixedUpdateEvent, RenderEvent } from "../timing.ts";

test("render caps account for work already spent in the frame", async () => {
  let now = 0;
  const waits: number[] = [];
  const frames: RenderEvent[] = [];
  const updates: FixedUpdateEvent[] = [];
  const loop = new ApplicationLoop({ updateHz: 120, maxFPS: 10, maxCatchUpUpdates: 20 }, {
    pollEvents: () => true,
    fixedUpdate: event => { updates.push(event); },
    render: event => {
      frames.push(event);
      now += 20;
      if(frames.length === 3) loop.stop();
    }
  }, {
    now: () => now,
    wait: async delay => {
      if(waits.length > 1000) throw new Error(`Stuck at ${now} with delay ${delay}`);
      waits.push(delay);
      now += delay;
    }
  });
  await loop.run();
  expect(waits.every(wait => wait <= 1000 / 120 + 1e-9)).toBe(true);
  expect(frames.map(frame => frame.frameTime)).toEqual([0, 0.1, 0.1]);
  expect(updates.length).toBe(24);
  expect(updates.every((event, index) => event.dt === 1 / 120 && event.tick === index + 1)).toBe(true);
});

test("a low render cap does not throttle fixed updates or create an artificial catch-up backlog", async () => {
  let now = 0;
  let frames = 0;
  let ticks = 0;
  const loop = new ApplicationLoop({ updateHz: 120, maxFPS: 5, maxCatchUpUpdates: 2 }, {
    pollEvents: () => true,
    fixedUpdate: () => { ticks++; },
    render: event => {
      assert.equal(event.droppedTime, 0);
      if(++frames === 6) loop.stop();
    }
  }, { now: () => now, wait: async milliseconds => { now += milliseconds; } });
  await loop.run();
  expect(ticks).toBe(120);
});

test("render deadlines and frameTime include work spent in fixed updates", async () => {
  let now = 0;
  const starts: number[] = [];
  const frameTimes: number[] = [];
  const loop = new ApplicationLoop({ updateHz: 10, maxFPS: 10 }, {
    pollEvents: () => true,
    fixedUpdate: event => { if(event.tick === 1) now += 60; },
    render: event => {
      starts.push(now);
      frameTimes.push(event.frameTime);
      if(starts.length === 3) loop.stop();
    }
  }, { now: () => now, wait: async milliseconds => { now += milliseconds; } });
  await loop.run();
  expect(starts).toEqual([0, 160, 260]);
  expect(frameTimes).toEqual([0, 0.16, 0.1]);
});

test("uncapped rendering yields each iteration without imposing a timer interval", async () => {
  let now = 0;
  const delays: number[] = [];
  let frames = 0;
  const loop = new ApplicationLoop({}, {
    pollEvents: () => true,
    fixedUpdate: () => {},
    render: () => {
      now += 0.1;
      if(++frames === 10) loop.stop();
    }
  }, {
    now: () => now,
    wait: async delay => { delays.push(delay); }
  });
  await loop.run();
  expect(delays).toEqual(Array.from({ length: 10 }, () => 0));
});

test("early timer wakeups poll events without exceeding the configured frame rate", async () => {
  let now = 0;
  let waits = 0;
  const starts: number[] = [];
  const loop = new ApplicationLoop({ maxFPS: 100 }, {
    pollEvents: () => true,
    fixedUpdate: () => {},
    render: () => {
      starts.push(now);
      if(starts.length === 2) loop.stop();
    }
  }, {
    now: () => now,
    wait: async delay => { now += ++waits === 2 ? 5 : delay; }
  });
  await loop.run();
  expect(starts).toEqual([0, 10]);
  expect(waits).toBe(3);
});

test("pause keeps pumping events and resume discards paused time and interpolation remainder", async () => {
  let now = 0;
  let waits = 0;
  let polls = 0;
  const frames: RenderEvent[] = [];
  const updates: FixedUpdateEvent[] = [];
  const loop = new ApplicationLoop({ updateHz: 120 }, {
    pollEvents: () => { polls++; return true; },
    fixedUpdate: event => { updates.push(event); },
    render: event => {
      frames.push(event);
      if(frames.length === 1) loop.pause();
      else loop.stop();
    }
  }, {
    now: () => now,
    wait: async () => {
      waits++;
      now += waits === 1 ? 10 : 5000;
      if(waits === 3) loop.resume();
    }
  });
  await loop.run();
  expect(polls).toBe(3);
  expect(updates).toEqual([{ dt: 1 / 120, tick: 1 }]);
  expect(frames[1]).toEqual({ alpha: 0, droppedTime: 0, frameTime: 0, frame: 2 });
});

test("stop during catch-up prevents remaining updates and rendering", async () => {
  let now = 0;
  let updates = 0;
  let renders = 0;
  const loop = new ApplicationLoop({}, {
    pollEvents: () => true,
    fixedUpdate: () => { updates++; loop.stop(); },
    render: () => { renders++; }
  }, { now: () => now, wait: async () => { now = 100; } });
  await loop.run();
  expect(updates).toBe(1);
  expect(renders).toBe(0);
});

test("closed windows stop before callbacks, and callback failures preserve arbitrary thrown values", async () => {
  const sentinel = Symbol("callback failure");
  let open = false;
  const loop = new ApplicationLoop({}, {
    pollEvents: () => open,
    fixedUpdate: () => {},
    render: () => { throw sentinel; }
  });
  await loop.run();
  open = true;
  const failing = new ApplicationLoop({}, {
    pollEvents: () => open,
    fixedUpdate: () => {},
    render: () => { throw sentinel; }
  });
  await assert.rejects(failing.run(), error => error === sentinel);
  expect(failing.active).toBe(false);
});

test("stop cancels both immediate and long timer waits without callbacks", async () => {
  let polls = 0;
  const loop = new ApplicationLoop({}, {
    pollEvents: () => { polls++; return true; },
    fixedUpdate: () => {},
    render: () => {}
  });
  const pending = loop.run();
  loop.stop();
  loop.stop();
  await pending;
  expect(polls).toBe(0);

  let rendered = false;
  const capped = new ApplicationLoop({ updateHz: 0.001, maxFPS: 0.001 }, {
    pollEvents: () => true,
    fixedUpdate: () => {},
    render: () => {
      rendered = true;
      setTimeout(() => { capped.stop(); }, 5);
    }
  });
  await capped.run();
  expect(rendered).toBe(true);
});

test("pause and resume interrupt a pending render-cap timer", async () => {
  const rendered = Promise.withResolvers<void>();
  const frames: RenderEvent[] = [];
  const loop = new ApplicationLoop({ updateHz: 0.001, maxFPS: 0.001 }, {
    pollEvents: () => true,
    fixedUpdate: () => {},
    render: event => {
      frames.push(event);
      if(frames.length === 1) rendered.resolve();
      else loop.stop();
    }
  });
  const running = loop.run();
  await rendered.promise;
  loop.pause();
  await delay(5);
  expect(frames.length).toBe(1);
  loop.resume();
  await running;
  expect(frames.length).toBe(2);
  expect(frames[1]?.frameTime).toBe(0);
  expect(frames[1]?.alpha).toBe(0);
});
