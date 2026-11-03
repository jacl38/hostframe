# Example performance investigation

**Resolved on 2026-11-02:** the recurring hardware hiccups came from the private
KDE test environment sharing its service cache with the desktop while using a
different configuration directory. Isolating `XDG_CACHE_HOME` removes the
repeated compositor stalls with the original hostframe native code. See the
[causal investigation below](#resolved-cause-shared-kde-service-cache). The slow
software-rendered recording was a separate problem.

On 2026-11-02, the choppy example showcase was investigated using the current
uncommitted example integration. The recording forced Mesa lavapipe software
Vulkan and ran two H.264 encoders simultaneously. Its MP4 was encoded at 30 FPS
and its GIF preview at 10 FPS; neither rate measured application throughput.

## Hardware comparison

The Three.js/Rapier physics example was timed at 960×640 with 36 boxes and 120 Hz
fixed updates. An automatic impulse at three seconds made the bodies move. The
comparison below uses seconds 3–9, excluding initial setup and shader compilation.
No recording, builds or tests ran alongside these measurements.

A private KWin virtual output (1280×960) and Xwayland supplied the same X11 display
for Intel and lavapipe. Intel runs forced the Intel Vulkan ICD and asserted the
adapter's `intel` vendor and non-fallback status. The software case changed only
the application's ICD. Runtimes were Bun 1.3.14 and Node.js 26.7.0; the hardware
was Intel Alder Lake-N integrated graphics. Immediate mode with a 10,000 FPS
scheduler cap approximated uncapped rendering for the physics cases.

| Application / driver | Rendering throughput after impulse | Mean physics step | Mean render callback |
| --- | --- | --- | --- |
| Bun / Intel, first run | 433 FPS | 0.37 ms | 1.99 ms |
| Bun / Intel, second run | 196 FPS | 0.67 ms | 4.23 ms |
| Node.js / Intel | 252 FPS | 0.41 ms | 3.50 ms |
| Bun / lavapipe | 17.7 FPS | 0.58 ms | 50.16 ms |

These are short diagnostic samples, not a controlled repeated benchmark. The
large variation between Intel runs remains material. FPS counts completed native
draw callbacks, not displayed frames or physical scanout. The default FIFO,
60-FPS-capped Bun case delivered approximately 53 FPS on the virtual output.

Direct WebGPU controls using the existing presentation benchmark delivered about
1,547 FPS for clear-only rendering and 427 FPS for its synthetic fragment shader,
with Immediate and no cap. Those controls use 960×540, so they establish that the
shared presentation path can be fast; their FPS values are not direct comparisons
to the larger, more complex physics scene.

## Intermittent stalls

A second set of Intel runs measured time around native window drawing. The
pre-callback interval includes native lifecycle checks, surface acquisition and
JavaScript texture wrapping. The callback interval includes Three.js encoding,
submission and adapter composition. The post-callback interval includes
presentation, Dawn event processing and frame cleanup. These are CPU wall times,
not GPU timestamp measurements.

Most frame intervals were short:

| Runtime | Median interval | p95 interval | p99 interval |
| --- | --- | --- | --- |
| Bun | 1.89 ms | 3.88 ms | 7.59 ms |
| Node.js | 2.52 ms | 4.60 ms | 8.79 ms |

Both runs nevertheless recorded 17 long intervals over approximately nine measured
seconds. The longest Bun frame took 110 ms, including 95 ms before callback entry.
The longest Node.js frame took 141 ms, including 139 ms before callback entry.
Other repeated stalls showed approximately 75–90 ms (Bun) or 120–134 ms (Node.js)
in that same pre-callback interval. Scene encoding generally remained around
1–3 ms and post-callback presentation around 0.05–0.1 ms during those stalls.

The clear-only and synthetic shader controls also recorded individual native
draws of 119 ms and 114 ms respectively. Consequently, neither Rapier nor the
Three.js scene alone explains the long pauses. Long synchronous draws can also
exceed the scheduler's eight-step catch-up budget and cause simulation time to
be discarded, despite each physics callback receiving a fixed timestep.

This established a real frame-pacing problem alongside the slow software capture.
At this stage it did not distinguish hostframe's native checks/wrapping, Dawn/Mesa
surface acquisition and the virtual X11/compositor environment. High average
throughput alone did not establish smooth hardware presentation.

## Native stack samples

A separate Bun run sampled the main thread with `eu-stack`. The samples include:

- `Presentation::Prepare` → GLFW's `_glfwGetWindowSizeX11` →
  `XGetWindowAttributes` → `xcb_wait_for_reply64` → `poll` (`stack-3.txt`).
- Dawn Vulkan `SwapChain::GetCurrentTextureInternal` → Mesa
  `anv_AcquireNextImage2KHR` → DRM synchronization calls (`stack-6.txt`).
- The same swapchain acquisition path waiting in
  `wsi_drm_wait_for_explicit_sync_release` → `drmSyncobjTimelineWait` → `ioctl`
  (`stack-12.txt`).

The current native `Prepare` queries framebuffer dimensions every draw. GLFW's
X11 implementation obtains them using `XGetWindowAttributes`, introducing a
synchronous server round trip. That is a concrete source of blocking to examine;
it is not established as the sole cause of the periodic stalls. Other samples
showed Vulkan image-release synchronization in the driver. Stack sampling stops
the target briefly and can affect scheduling, so these samples locate waits but
are excluded from the throughput and frame-time measurements above.

## Resolved cause: shared KDE service cache

The private KWin session set `XDG_CONFIG_HOME` and `XDG_RUNTIME_DIR` but inherited
the desktop's cache directory. Both sessions therefore used the same
`ksycoca6_en-POSIX_…` database while having different MIME association inputs.

The mechanism is visible in the matching KDE Frameworks 6.27.0 source:

- [`KSycoca::absoluteFilePath`](https://github.com/KDE/kservice/blob/v6.27.0/src/sycoca/ksycoca.cpp)
  names the cache using the locale and a hash of the generic **data** locations;
  configuration locations are not part of that filename.
- In the same file, `KSycocaPrivate::needsRebuild` compares the database's extra
  files with the current process's list.
  [`KBuildSycoca::factoryExtraFiles`](https://github.com/KDE/kservice/blob/v6.27.0/src/sycoca/kbuildsycoca.cpp)
  obtains that list from `KMimeAssociations::mimeAppsFiles`. The desktop has a
  user `mimeapps.list` that the private configuration does not contain.
- [`GlobalShortcutsRegistry`](https://github.com/KDE/kglobalacceld/blob/v6.6.5/src/globalshortcutsregistry.cpp)
  responds to service-cache changes by scheduling `refreshServices`, which looks
  up services and can rebuild the database synchronously. Passing KWin
  `--no-global-shortcuts` did not prevent this path in the observed session.

A sampled private-compositor main-thread stack caught:

```text
fdatasync
QFSFileEnginePrivate::nativeSyncToDisk
QSaveFile::commit
KBuildSycoca::recreate
KSycocaPrivate::buildSycoca
KSycoca::ensureCacheValid
KService::serviceByStorageId
GlobalShortcutsRegistry::refreshServices
QTimer::timeout
```

The cache changed 16 times during a separate 6.5-second observation, alternating
between 572,602 and 589,963 bytes. The serialized desktop `mimeapps.list` path
alternated between absent and present. This directly confirmed competing cache
contents, rather than merely finding an unrelated disk wait.

While KWin rebuilds and syncs that file, it cannot service presentation normally.
The client eventually runs out of reusable swapchain images. Mesa then waits for
image release inside Dawn's synchronous `GetCurrentTexture`, blocking the same
JavaScript thread that advances the physics. Eight catch-up steps at 120 Hz cover
only 66.7 ms; longer pauses discard simulation time. This explains both the
visible pauses and slow simulation progress without expensive physics steps.

### Isolation experiments

Temporary native timing separated device-loss checks, framebuffer-size query,
iconification query, surface configuration, acquisition, texture wrapping,
callback, presentation and event processing. In the first uncapped Bun physics
reproduction, recurring draws spent 60–114 ms in acquisition while their scene
callbacks took about 1–3 ms. The same failure occurred in clear-only rendering
and in FIFO at the example's normal 60 FPS cap.

Controls narrowed the cause:

- Skipping per-frame framebuffer/iconification queries improved clear-only
  throughput but retained acquisition stalls up to 162 ms. Their synchronous
  X11 round trips are overhead, not the cause of this recurring pause.
- A process-local diagnostic shim disabled the optional DRI3 explicit-sync
  capability. Stalls remained through the implicit-sync path, up to 273 ms.
- Rendering the clear workload into an ordinary offscreen texture avoided
  presentation entirely. The maximum measured uncapped draw was 6.14 ms, with
  no dropped simulation time over nine seconds. This control does not measure
  displayed frames or substitute for validating presentation.
- Giving the compositor its own `XDG_CACHE_HOME` eliminated the recurring waits.
  Restoring shared-cache operation brought them back: the actual physics example
  recorded repeated 90–178 ms pauses after the initial four seconds.

All temporary native changes and the diagnostic shim were removed before the
final scene profiles. The application, renderer, physics, scheduler, Dawn engine,
driver and present-mode policy were unchanged. The fix is in the display setup.

The final profiles used the real example, an X11 Space press at two seconds,
three seconds of warmup, and approximately 12 seconds of measured motion:

| Runtime / presentation | Median interval | p99 interval | Maximum interval | Dropped simulation time |
| --- | --- | --- | --- | --- |
| Bun / Immediate, 10,000 FPS cap | 1.96 ms | 6.62 ms | 22.02 ms | 0 |
| Bun / FIFO, 60 FPS cap | 17.64 ms | 24.66 ms | 32.22 ms | 0 |
| Node.js / Immediate, 10,000 FPS cap | 1.46 ms | 3.23 ms | 8.67 ms | 0 |
| Node.js / FIFO, 60 FPS cap | 17.63 ms | 22.69 ms | 27.77 ms | 0 |

The Bun FIFO run had two intervals over the profiler's 30 ms threshold; its
longest native draw was 12.79 ms. Neither runtime exhibited the recurring
90–178 ms acquisition pauses. Fixed updates averaged approximately 120 Hz in
all four cases, with no simulation time discarded. Uncapped scene throughput
was approximately 437 FPS in Bun and 638 FPS in Node; these short, sequential
shared-host samples are not a controlled runtime comparison.

The corrected clear-only controls also discarded no simulation time: the
uncapped run's maximum native draw was 10.84 ms, and FIFO at a 60 FPS cap had
a 19.52 ms p99 completion interval. No recording, builds, tests or stack sampling
ran alongside the final timing measurements.

### Reproduce

The [private hardware display launcher](../scripts/benchmarks/display.ts) isolates
runtime, configuration **and cache** directories and stops its KWin session when
the command finishes, with a 120-second session timeout. It requires installed
KWin/Xwayland and D-Bus, plus access
to the Intel render node; its default ICD path is specific to this Linux host.
Override `VK_DRIVER_FILES` and `HOSTFRAME_EXPECT_VENDOR` for another supported driver.

```sh
bun scripts/benchmarks/display.ts bun scripts/benchmarks/physics.ts
bun scripts/benchmarks/display.ts bun scripts/benchmarks/physics.ts --no-vsync --max-fps=10000
bun scripts/benchmarks/display.ts node scripts/benchmarks/physics.ts
bun scripts/benchmarks/display.ts bun scripts/benchmarks/presentation.ts clear off uncapped 9000
```

The [physics profiler](../scripts/benchmarks/physics.ts) imports the actual example
without duplicating its scene. It sends Space through X11 at two seconds, asserts
that the example receives the press, excludes the first three seconds, and runs
for 15 seconds by default (`HOSTFRAME_PROFILE_MS` overrides the duration). It reports
completion intervals, CPU draw stages, dropped time, and every interval over
30 ms. It requires `xdotool`; its hooks run only in the diagnostic process.
Use an installed Node binary directly if a version-manager shim changes versions
or tries to provision an unavailable release.

These checks establish removal of the recurring environment-induced stalls on
Intel/Xwayland. They do not establish physical-monitor scanout pacing, and the
existing scheduler's 60 FPS cap still normally produces approximately 17–18 ms
intervals due to host timer rounding and relative render deadlines.

After restoring the original native implementation, `bun run native:build`
passed with 68 audited compilation units. The corrected Intel display passed
`bun run native:verify --window-interactions`, including compute/readback,
presentation modes, lifecycle, resize/minimize/restore, and input in Node.js
26.7.0 and Bun 1.3.14. Lint, typecheck and all 36 deterministic/build-script
tests passed. Native implementation files have no remaining changes.

### 60 FPS showcase recapture

The four showcase clips were subsequently re-recorded on Intel with isolated
KWin runtime/config/cache directories, warmed input, FIFO presentation, and a
10,000 FPS scheduler cap so the display sets the rendering cadence. Each actual
example asserted a non-fallback Intel adapter and averaged approximately 60
native render callbacks per second during capture, without discarding simulation
time. One FFmpeg process captured lossless RGB at 60 FPS; delivery encoding and
title composition ran afterward. There was no second full-desktop recorder.

| Clip | Seconds | Source / encoded frames | Maximum source capture gap | Repeated source samples during motion |
| --- | --- | --- | --- | --- |
| Three.js instancing | 8 | 480 / 480 | 26.34 ms | 12 |
| Three.js shadows | 8 | 480 / 480 | 20.10 ms | 10 |
| Vanilla particles | 8 | 480 / 480 | 20.68 ms | 3 |
| Three.js + Rapier | 10 | 600 / 600 | 18.65 ms | 1 |

Each repetition was an isolated single sample, with no consecutive repeated
samples during the measured moving portions. These are independent screen
samples, not a promise of a unique displayed image at every encoded timestamp.
The recurring long freezes from the earlier recordings were absent.

Every delivery clip is H.264/yuv420p at exactly `60/1` FPS and 960×704, including
the title footer. The combined video has 2,040 frames over exactly 34 seconds.
All clips and the combined video decoded completely without errors, and scene
images were inspected. The GIF preview is separately labeled 20 FPS.

Current footage, per-clip source hashes/timestamps, timing reports and encoding
validation are under `build/examples/showcase/`; originals are preserved in
`build/examples/showcase-before-60fps/`. Capture and finishing scripts remain
with the generated evidence. Pilot captures were excluded from the delivery.

## Evidence

Generated evidence is ignored under `build/examples/hardware-diagnosis/`:
`physics.ts` and `physics-stalls.ts` instrument the actual example; `session.ts`
launches sequential hardware/software cases; `*-physics-*.log`,
`{bun,node}-stalls.log`, and `intel-{clear,shader}.log` contain the measurements.
Stack sampling, when available, uses a separate run so its instrumentation does
not contaminate the timing results reported above.

The causal follow-up is under `build/examples/pacing-diagnosis/`: baseline and
isolation-control logs, `cache-changes.json`, native instrumentation backups,
and `sample-19-2449554.txt` containing the compositor rebuild stack. The
`final-*.log` files contain the preserved actual-example profiler results.
Corrected launcher sessions save their display environment, command and
compositor logs under `build/benchmarks/display-*/`. Generated evidence remains
ignored; both reusable benchmark scripts are kept as project source.

The earlier CPU-only capture comparison remains under
`build/examples/performance-diagnosis/`. The
[previous presentation investigation](presentation-performance.md) independently
reported long synchronous draws before these examples were added.
