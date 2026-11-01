# Application loops

The optional scheduler supports fixed simulation steps and separate rendering on
the process main thread. It is built on the same event polling and drawing API
available to caller-owned loops. One application and one live window are supported
at a time. Windows default to fixed 320×240; creation options can customize the
title, initial screen-coordinate dimensions, and resizability (see the
[window contract](../README.md)).

```ts
const app = new Application();
// Request an adapter/device through app.gpu, then create a window as usual.
const window = app.createWindow(device);
let previous = 0;
let position = 0;

const unsubscribe = app.on("fixedUpdate", ({ dt }) => {
  previous = position;
  position += dt * 2;
});
app.on("render", ({ alpha }) => {
  const interpolated = previous + (position - previous) * alpha;
  window.draw(texture => {
    // Encode and submit synchronously using texture and interpolated.
  });
});

try {
  await app.run({ updateHz: 120 });
} finally {
  unsubscribe();
  try {
    app.dispose();
  } finally {
    device.destroy();
  }
}
```

## Timing contract

`app.run(options)` starts one run and returns a promise. Registration alone does
not start scheduling. Starting a concurrent run throws. Each run starts its tick
and render frame counters at 1 and clears elapsed backlog. Validation errors throw
synchronously; callback failures reject the run promise with the original thrown
value. A failed run can be restarted after removing or fixing its failing listener.

| Option | Default | Meaning |
|---|---|---|
| `updateHz` | `60` | Simulation steps per second; each update receives `dt = 1 / updateHz`, in seconds |
| `maxCatchUpUpdates` | `8` | Maximum catch-up updates in one loop iteration |
| `maxFrameTime` | `0.25` | Maximum elapsed seconds admitted in one iteration |
| `maxFPS` | omitted | Optional render-rate limit; omitting it imposes no scheduler cap |

Rates and elapsed limits must be finite and positive. The catch-up update limit
must be a positive safe integer. Numerically unrepresentable configurations are
rejected. The render cap is an upper scheduling target; it does not guarantee an
exact achieved FPS or change vsync.

## Presentation settings

`app.createWindow(device, options?: WindowOptions)` accepts `vsync?: boolean`
alongside `title`, `width`, `height`, and `resizable`.
The default is `true`. Dawn surface capabilities are queried for the device's
adapter before selecting the mode; `window.presentMode` exposes that selection as
`"fifo"`, `"immediate"`, or `"mailbox"` (the exported `PresentMode` type). It throws
after window disposal, like `window.shouldClose`. Settings are fixed for the
window's lifetime; dispose and recreate the window to change vsync.

| Window option | `run()` option | Behavior |
|---|---|---|
| omitted or `vsync: true` | omit `maxFPS` | FIFO presentation; no scheduler render cap |
| omitted or `vsync: true` | `maxFPS: N` | FIFO presentation plus a scheduler render cap of N FPS |
| `vsync: false` | omit `maxFPS` | Immediate preferred, then Mailbox; no scheduler render cap |
| `vsync: false` | `maxFPS: N` | Immediate preferred, then Mailbox, plus a scheduler render cap of N FPS |

FIFO queues frames for display refresh and can throttle acquisition. Immediate
allows tearing. Mailbox replaces pending frames with newer ones while displaying
at refresh; this fallback permits rendering without FIFO queue pacing but does
not disable synchronization of displayed frames. Only advertised modes are used;
FIFO-relaxed is not used for either policy. `vsync: false` throws during creation
if neither Immediate nor Mailbox is available. A surface without FIFO also rejects
`vsync: true`. These failures release the partially created window, so the caller
can explicitly retry with another setting. Invalid option objects or non-boolean
`vsync` values throw `TypeError`; no truthiness coercion is performed.

`maxFPS` applies only to `app.run()` render events; it does not throttle manual
`window.draw()` calls or set the surface mode. Omission means uncapped; `0`,
negative values, `NaN`, and infinities are rejected. A cap above the display's
refresh rate does not force FIFO to render that fast. Uncapped rendering still
yields to the host between iterations and remains limited by GPU and display work.

Window resizing and high-DPI framebuffer changes are applied before the next
surface acquisition, after native events are polled. Size rendering resources from
`texture.width`/`texture.height` inside `window.draw`. While minimized or at zero
framebuffer size, `draw` skips its callback; update/render listeners and native
event polling continue. A render event therefore does not guarantee a presented
frame. Restoration resumes drawing automatically. Outdated/lost acquisitions are
retried once, and temporary unavailability skips that draw without stopping the
loop. Native lifecycle and device-loss errors still reject the run. Presentation
mode and render-cap settings survive reconfiguration.

## Fixed-update accounting

The scheduler uses a monotonic clock and an accumulator. It dispatches whole fixed
simulation steps and retains the fractional remainder. The render event contains:

- `alpha`: the remaining fraction of the next simulation step, in `[0, 1)`, for
  interpolation between previous and current simulation states.
- `frameTime`: measured seconds since the preceding render event, including work
  and presentation waits. It is zero on the first render after resume.
- `droppedTime`: elapsed seconds discarded by catch-up limits since the preceding
  render event. Excess whole updates are discarded; fractional time is retained.
- `frame`: the render event number within this run.

Fixed updates receive `dt` and `tick`, the number of the simulation step being
dispatched. Render callbacks can run without an update; several updates can be due
before a render. A low render cap still permits update wakeups at `updateHz` and
does not itself create a simulation backlog. A stall may require catch-up, and
discarded time intentionally makes simulation advance less than elapsed wall time.

The scheduler yields a host event-loop turn between iterations for I/O, timers,
and asynchronous GPU progress. It does not use a fixed `setInterval` or wait for
the GPU queue to become idle each frame. Work already spent in a frame counts
toward its render-rate limit.

## Stop, pause, close, and disposal

- `app.stop()` cancels pending scheduling. It is idempotent and safe without a run
  or after disposal. Await the run promise before starting a new run.
- `app.pause()` stops update/render callbacks while polling native events about
  every 16 ms. `app.resume()` clears paused elapsed time and fractional backlog;
  it does not catch up paused time. Both require an active application and a run.
  Tick/frame counters continue within that run. Pending waits are interrupted by
  these controls, including waits imposed by a render cap.
- No open windows, disposal of the last window, or a native/programmatic close
  request ends the run normally. `window.requestClose()` sets the GLFW close flag;
  `window.shouldClose` reads it. A close request does not dispose native resources.
- Stop and normal run completion leave the application, windows, and device alive.
  Use explicit disposal, usually in `finally`. `app.dispose()` also stops its run
  and removes listeners, releasing windows before GLFW. Devices remain caller-owned.

Stop, pause, window closure/disposal, and application disposal prevent remaining
listeners from running. Disposal and event polling inside `window.draw()` remain
forbidden by native reentrancy guards. A rejected disposal inside a draw callback
does not cancel a healthy run. Draw callbacks still expire their texture/views,
recover from callback failures, and reject asynchronous results.

## Listener semantics

`app.on("fixedUpdate", callback)` and `app.on("render", callback)` return idempotent
unsubscribe functions. Each registration is independent, including repeated
registration of the same callback. Listeners run in registration order. A listener
added during dispatch begins with the next event; removing a listener before its
turn skips it immediately. Unsubscription remains safe after disposal.

Callbacks must return `undefined` synchronously. A returned promise or other value
rejects the run with a `TypeError`. Returned promise rejections are consumed so
they do not become orphaned unhandled rejections. No update or render callback is
awaited. A listener failure stops scheduling and rejects the run; resources remain
available for explicit cleanup or recovery. Registering or starting a run after
application disposal throws.

## Caller-owned loops and limits

`app.pollEvents()` processes pending native events and returns whether any window
remains open. When a drawable framebuffer is available, `window.draw()` acquires,
invokes the synchronous callback, and presents; it does not poll events implicitly. A custom loop must pump events
regularly and yield to the host runtime:

```ts
import { setImmediate } from "node:timers/promises";

while(app.pollEvents()) {
  // Advance caller-owned simulation and render with window.draw(...).
  await setImmediate();
}
```

The default native presentation policy is FIFO/vsync. Omitting `maxFPS` does not
disable vsync. All presentation modes can block the main thread and
delay simulation callbacks. Fixed timesteps specify simulation integration, not
hard execution deadlines; independently scheduled physics would need a separate
execution context. Real high-refresh pacing, VRR, latency, and performance remain
unmeasured. See [native validation](native-build.md) for exercised runtimes.

The process-lifetime GPU-owner root is unchanged. This scheduler does not solve
upstream GPU-object lifetime management or alter caller ownership of devices.
