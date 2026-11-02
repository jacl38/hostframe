# Example performance investigation

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

This establishes a real frame-pacing problem alongside the slow software capture.
It does not yet establish whether the cause is ts-dawn's native checks/wrapping,
Dawn/Mesa surface acquisition or the virtual X11/compositor environment. No native
behavior or simulation policy was changed to conceal the pauses. Consistently
smooth hardware presentation is not established by the high average throughput.

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

## Evidence

Generated evidence is ignored under `build/examples/hardware-diagnosis/`:
`physics.ts` and `physics-stalls.ts` instrument the actual example; `session.ts`
launches sequential hardware/software cases; `*-physics-*.log`,
`{bun,node}-stalls.log`, and `intel-{clear,shader}.log` contain the measurements.
Stack sampling, when available, uses a separate run so its instrumentation does
not contaminate the timing results reported above.

The earlier CPU-only capture comparison remains under
`build/examples/performance-diagnosis/`. The
[previous presentation investigation](presentation-performance.md) independently
reported long synchronous draws before these examples were added.
