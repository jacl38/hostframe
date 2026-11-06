# Application loops

The optional scheduler supports fixed simulation steps and separate rendering on
the process main thread. The application owns scheduling and native polling; windows own rendering. One application and one live window are supported
at a time. Windows default to fixed 320×240; creation options can customize the
title, initial screen-coordinate dimensions, and resizability (see the
[window contract](../README.md)).

```ts
import { Application, installWebGPUGlobals } from "hostframe";

installWebGPUGlobals();
const app = new Application();
let device: GPUDevice | undefined;
try {
  const window = app.createWindow();
  const context = window.getContext("webgpu");
  const adapter = await context.requestAdapter();
  if(!adapter) throw new Error("No compatible adapter");
  device = await adapter.requestDevice();
  context.configure({ device, format: app.gpu.getPreferredCanvasFormat() });
  let previous = 0;
  let position = 0;

  app.on("fixedUpdate", ({ dt }) => {
    previous = position;
    position += dt * 2;
  });
  window.on("render", ({ alpha }) => {
    const interpolated = previous + (position - previous) * alpha;
    const texture = context.getCurrentTexture();
    // Encode and submit synchronously using texture and interpolated.
  });

  await app.run({ updateHz: 120 });
} finally {
  try {
    app.dispose();
  } finally {
    device?.destroy();
  }
}
```

Call `installWebGPUGlobals()` when rendering code uses global WebGPU constructors
or constants. Application construction does not install them; see the
[global installation policy](../README.md).

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
rejected. The render cap spaces scheduler render dispatch starts by at least `1000 / maxFPS`
milliseconds, measured with the monotonic scheduler clock before native texture
acquisition. Each deadline starts from the actual dispatch time; late frames do
not trigger catch-up render bursts. Work in acquisition, listeners, and presentation
counts toward that interval. Pause/resume resets the deadline and permits an
immediate first dispatch. The cap does not guarantee an achieved FPS or change vsync.

Window listeners enter only after successful acquisition. Variable acquisition
waits can therefore make consecutive listener arrivals closer than the cap's
interval, even when dispatches obey it. The cap does not bound listener-arrival,
GPU-completion, presentation-return, or displayed-frame intervals. Skipped
acquisitions still consume a scheduler render dispatch.

## Presentation settings

`app.createWindow(options?: WindowOptions)` accepts `vsync?: boolean`
alongside `title`, `width`, `height`, and `resizable`.
The default is `true`. At context configuration, Dawn surface capabilities are
queried for the device's adapter before selecting the mode; `window.presentMode` exposes that selection as
`"fifo"`, `"immediate"`, or `"mailbox"` (the exported `PresentMode` type). It throws
after window disposal, like `window.shouldClose`. Read it only after context configuration. Settings are fixed for the
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
FIFO-relaxed is not used for either policy. `vsync: false` throws during context configuration
if neither Immediate nor Mailbox is available. A surface without FIFO also rejects
`vsync: true`. Failed configuration leaves the window available for disposal or retry. Invalid option objects or non-boolean
`vsync` values throw `TypeError`; no truthiness coercion is performed.

`maxFPS` limits render scheduling in `app.run()`; it does not set the surface mode. Omission means uncapped; `0`,
negative values, `NaN`, and infinities are rejected. A cap above the display's
refresh rate does not force FIFO to render that fast. Uncapped rendering still
yields to the host between iterations and remains limited by GPU and display work.

Window resizing and high-DPI framebuffer changes are applied before the next
surface acquisition, after native events are polled. Size rendering resources from
`texture.width`/`texture.height` during window render dispatch. While minimized or at zero
framebuffer size, window render events are skipped; fixed updates and native polling continue. Window render events
require a configured context and a successfully acquired texture. Restoration resumes drawing automatically. Outdated/lost acquisitions are
retried once, and temporary unavailability skips window render dispatch without stopping the
loop. Native lifecycle and device-loss errors still reject the run. Presentation
mode and render-cap settings survive reconfiguration.

## Fixed-update accounting

The scheduler uses a monotonic clock and an accumulator. It dispatches whole fixed
simulation steps and retains the fractional remainder. The render event contains:

- `alpha`: the remaining fraction of the next simulation step, in `[0, 1)`, for
  interpolation between previous and current simulation states.
- `frameTime`: measured seconds between scheduler render dispatch starts, before
  acquisition, including intervening work and presentation waits. It is not the
  interval between listener arrivals. Skipped acquisitions still advance this
  accounting. It is zero on the first render after resume.
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
listeners from running. Configuration, disposal, and event polling inside window render listeners remain
forbidden by native reentrancy guards. A rejected disposal inside a render listener
does not cancel a healthy run. Frame textures/views expire after dispatch, including on failure. Failed listeners
abandon the frame and reject the run; a later run can recover after removing the
failing listener.

## Listener semantics

`app.on("fixedUpdate", callback)` and `window.on("render", callback)` return idempotent
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

Fixed updates, window rendering, and input listeners share internal subscription
mechanics through composition. Their owners still control lifecycle checks,
pause/stop handling, and event/frame/batch boundaries. A Node `EventEmitter` is
not a replacement for this contract: its `on()` returns the emitter, removal
during emission does not skip a listener already scheduled for that emission,
and listener results are ignored. Hostframe returns independent unsubscribe
functions, applies removals immediately, and enforces synchronous results.
Input additionally snapshots additions across the entire native input batch.

## Event polling and execution limits

`app.pollEvents()` processes native window/input events without rendering and
returns whether any window remains open. `app.run()` defines render event scopes:
Hostframe acquires the frame, dispatches window listeners, then presents once.
See [window contexts](window-context.md).

The default native presentation policy is FIFO/vsync. Omitting `maxFPS` does not
disable vsync. All presentation modes can block the main thread and
delay simulation callbacks. Fixed timesteps specify simulation integration, not
hard execution deadlines; independently scheduled physics would need a separate
execution context. Real high-refresh pacing, VRR, latency, and performance remain
unmeasured. See [native validation](native-build.md) for exercised runtimes.

The process-lifetime GPU-owner root is unchanged. This scheduler does not solve
upstream GPU-object lifetime management or alter caller ownership of devices.

Input events are dispatched during polling before fixed updates and rendering,
including while paused. Read held controls in fixed updates. Close and pointer
capture requested from input listeners execute after the successful batch; other
native mutations inside input listeners remain guarded. See [window input](window-input.md).
