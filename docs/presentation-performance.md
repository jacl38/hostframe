# Hardware presentation follow-up and benchmark

The current implementation at `7eb24b7` was checked on 2026-11-01 using Intel
Alder Lake-N UHD graphics (`8086:46d1`), Mesa ANV 26.2.5, Node.js 26.7.0, and
Bun 1.3.14. A private KWin 6.6.5 virtual compositor used Intel OpenGL/EGL and
Xwayland with DRI3 and Present. Its output was 1280×960, scale 1, nominal 59.94 Hz.
The existing desktop and physical outputs were left unchanged.

## Correctness

`bun run native:build` passed with 68 audited compilation sources and no Dawn
engine/Tint compilation. Lint, typecheck, and all 36 deterministic/build-script
tests passed. The complete `native:verify --window-interactions` suite passed on
Intel in both runtimes, covering:

- Native capability selection, acquisition recovery, compute/readback and rendering.
- Generated binding contracts, callback errors, reentrancy and expired frame resources.
- Window/application disposal, recreation, worker rejection, GC and ordinary shutdown.
- FIFO and Immediate with capped/uncapped rendering and fixed updates.
- Real X11 resizing, minimize/restore, keyboard repeat/modifiers, pointer motion/buttons,
  scrolling, capture/raw motion, focus-loss reset, listener recovery and disposal.

Additional Immediate resize fixtures passed in both runtimes. All four solid-color
presentation settings were captured in each runtime and exited normally. Native
window-manager close stopped the loop normally in each runtime. The interactive
input example was driven through movement, scrolling, capture/release and keyboard
close in both runtimes; before/after images were inspected. Resized/restored frame
captures were also inspected.

Intel checks forced `VK_DRIVER_FILES=/usr/share/vulkan/icd.d/intel_icd.x86_64.json`,
`DAWNNODE_BACKEND=vulkan`, and `TS_DAWN_EXPECT_VENDOR=intel`. GLX and KWin reported
Intel acceleration; Vulkan enumerated the integrated Intel device. Example and
benchmark process mappings confirmed `libvulkan_intel.so` without
`libvulkan_lvp.so`. Negative controls forced lavapipe and confirmed the hardware
assertion rejects it in Node.js, Bun and the native C++ fixture.

## Measurement method

[The benchmark](../scripts/benchmarks/presentation.ts) uses the actual public
Application/window/scheduler API at 960×540, with 120 Hz fixed updates. Two
workloads are measured: an ordinary render-pass clear, and a fullscreen triangle
with 32 dependent sine/cosine iterations per fragment. The second is synthetic
shader load, not a representative game scene.

Both application drivers use the **same Intel-backed KWin/Xwayland session**.
Only the application's Vulkan ICD changes between Intel and lavapipe. This avoids
comparing hardware on Xwayland against software on Xvfb. Each workload/runtime
combination covers FIFO and Immediate, both uncapped and capped at 60 FPS. Each
case warms up for one second and measures three seconds, repeated three times.
Hardware/software pairs alternate order across repetitions. Measurements run
sequentially, without project builds, tests, captures or other validation work
running alongside them. An earlier partial batch that overlapped verification
was discarded.

FPS counts successful draw callbacks through synchronous acquire/render/present;
it measures application frame throughput, not displayed frames or scanout.
Frame interval percentiles use successive draw-return times. Draw durations are
CPU wall time including acquire/present blocking, not GPU timestamp measurements.
`process.cpuUsage()` supplies application-process CPU use: 100% represents one CPU
core, and multithreaded software rendering can exceed it. These values exclude
the separate compositor/X server and do not measure total system power.
Submitted GPU work is drained after each sample and the drain time is recorded.
Reported summaries use the median of the three per-run values, with FPS ranges.

Example single-case reproduction, inside the prepared hardware display:

```sh
VK_DRIVER_FILES=/usr/share/vulkan/icd.d/intel_icd.x86_64.json \
DAWNNODE_BACKEND=vulkan TS_DAWN_EXPECT_VENDOR=intel \
node scripts/benchmarks/presentation.ts shader off uncapped 3000
```

Use `bun` for the other runtime, `clear` for the simpler workload, `on` for FIFO,
and `60` instead of `uncapped` for a cap. To compare lavapipe in the same display,
select `lvp_icd.x86_64.json` and unset `TS_DAWN_EXPECT_VENDOR`. Driver paths are
host-specific. The [Intel environment guide](intel-presentation.md#reproduce-the-hardware-environment)
describes starting a private compositor; use the environment it records.

## Results

There were 96 completed samples: 32 cases with three repetitions each. With
Immediate and no scheduler cap, the median results were:

| Workload | Runtime | Software FPS | Intel FPS | Throughput ratio | Software / Intel application CPU |
| --- | --- | --- | --- | --- | --- |
| Clear | Node.js | 651 | 1,813 | 2.8× | 87% / 72% |
| Clear | Bun | 656 | 2,083 | 3.2× | 94% / 78% |
| Shader | Node.js | 8.8 | 394 | 44.8× | 299% / 36% |
| Shader | Bun | 9.0 | 389 | 43.2× | 300% / 36% |

For the uncapped shader, the median per-run p95 frame interval fell from about
141–146 ms in software to 2.8–3.1 ms on Intel. With FIFO or a 60 FPS cap, Intel
usually delivered about 50–55 FPS through this virtual display. Software also
reached similar rates for clear-only work, but only about 7–10 FPS for the shader.
Capped Intel shader rendering typically used about 11–13% of one CPU core. These
results support using hardware for meaningful GPU work; clear-only throughput
mostly exercises presentation and binding overhead. They do not imply a 44×
speedup for a real game.

Pacing is not yet established as suitable for consistently smooth high-refresh
rendering. The full matrix showed substantial variation in clear throughput and
occasional long pauses. Follow-up samples timed individual draw calls and found
repeated long intervals inside the synchronous draw path: one Node.js uncapped
shader call took 366 ms, and the longest corresponding Bun call took 145 ms.
Other recorded calls in 144-capped runs took about 77–110 ms. This locates an
observed delay inside the draw boundary, which includes acquisition, JavaScript
encoding, presentation and GPU event processing; it does not identify its cause.
The process and parent cgroups had unlimited CPU quotas and zero recorded CPU
throttling. Ordinary shared-host contention and compositor/driver behavior remain
possible contributors. No runtime change was made to hide or work around the
stalls.

The two three-second 144-cap follow-ups per runtime delivered about 109–112 FPS
for clear/shader work with Immediate. A cap is an upper bound, but these results
do not demonstrate sustained 144 FPS even on this virtual output. They are single
follow-up samples, not repeated matrix medians.

Every simulation callback still received exactly `dt = 1 / 120`. Actual fixed
update throughput was lower when stalls exceeded the catch-up budget: matrix
uncapped Intel shader medians were about 107–111 updates/sec, versus about 70–72
in software. With a 60 FPS cap, Intel shader medians were about 119 updates/sec.
This is the existing bounded catch-up behavior, not independently scheduled
physics. Profiling the long synchronous draws and testing pacing on a physical
monitor are the next performance investigations.

## Complete matrix

Each numeric column is the median of the three per-run values; FPS also shows
the minimum and maximum. `updates/s` counts actual callbacks per wall-clock
measurement interval and can vary slightly around 120 at interval boundaries.
The final GPU drain was typically short; the largest drain in these 96 samples
was 10.45 ms. It is excluded from FPS and CPU measurement windows.

| Runtime | Workload | Mode | Cap | Driver | FPS median (range) | CPU % | p95 frame ms | updates/s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Node 26.7.0 | clear | fifo | uncapped | intel | 49.7 (48.0–54.6) | 7.6 | 19.42 | 104.3 |
| Node 26.7.0 | clear | fifo | uncapped | software | 51.2 (50.6–54.4) | 11.4 | 23.41 | 113.2 |
| Node 26.7.0 | clear | fifo | 60 | intel | 54.7 (51.7–55.7) | 12.5 | 19.53 | 119.7 |
| Node 26.7.0 | clear | fifo | 60 | software | 52.0 (51.2–54.7) | 16.0 | 24.68 | 119.6 |
| Node 26.7.0 | clear | immediate | uncapped | intel | 1813.0 (1430.6–2596.5) | 72.3 | 0.76 | 112.7 |
| Node 26.7.0 | clear | immediate | uncapped | software | 650.7 (544.5–889.5) | 87.4 | 2.42 | 120.0 |
| Node 26.7.0 | clear | immediate | 60 | intel | 54.2 (53.5–54.4) | 10.9 | 19.43 | 119.9 |
| Node 26.7.0 | clear | immediate | 60 | software | 56.7 (56.3–56.7) | 18.1 | 20.30 | 120.0 |
| Bun 1.3.14 | clear | fifo | uncapped | intel | 54.6 (54.6–54.9) | 11.4 | 19.13 | 115.3 |
| Bun 1.3.14 | clear | fifo | uncapped | software | 56.5 (56.3–56.6) | 17.3 | 20.20 | 117.1 |
| Bun 1.3.14 | clear | fifo | 60 | intel | 54.6 (54.5–54.8) | 14.4 | 20.43 | 119.8 |
| Bun 1.3.14 | clear | fifo | 60 | software | 55.8 (51.7–55.8) | 16.0 | 21.44 | 120.0 |
| Bun 1.3.14 | clear | immediate | uncapped | intel | 2083.3 (2015.2–2401.6) | 77.7 | 0.76 | 116.0 |
| Bun 1.3.14 | clear | immediate | uncapped | software | 655.8 (406.5–864.6) | 93.9 | 2.46 | 118.6 |
| Bun 1.3.14 | clear | immediate | 60 | intel | 53.3 (52.9–53.8) | 11.8 | 21.19 | 120.0 |
| Bun 1.3.14 | clear | immediate | 60 | software | 55.2 (55.1–57.0) | 18.6 | 21.33 | 119.7 |
| Node 26.7.0 | shader | fifo | uncapped | intel | 51.3 (51.3–51.8) | 7.6 | 22.32 | 111.9 |
| Node 26.7.0 | shader | fifo | uncapped | software | 9.6 (6.9–10.9) | 308.0 | 132.58 | 76.9 |
| Node 26.7.0 | shader | fifo | 60 | intel | 50.9 (50.7–51.4) | 11.2 | 22.23 | 117.5 |
| Node 26.7.0 | shader | fifo | 60 | software | 7.5 (6.3–9.2) | 244.4 | 203.96 | 59.7 |
| Node 26.7.0 | shader | immediate | uncapped | intel | 394.0 (377.6–396.5) | 36.4 | 2.82 | 107.3 |
| Node 26.7.0 | shader | immediate | uncapped | software | 8.8 (7.6–10.4) | 298.7 | 141.42 | 70.3 |
| Node 26.7.0 | shader | immediate | 60 | intel | 53.2 (52.8–53.6) | 12.2 | 19.18 | 119.1 |
| Node 26.7.0 | shader | immediate | 60 | software | 10.3 (9.3–10.6) | 323.2 | 133.62 | 82.3 |
| Bun 1.3.14 | shader | fifo | uncapped | intel | 51.5 (50.5–53.7) | 10.8 | 23.07 | 111.1 |
| Bun 1.3.14 | shader | fifo | uncapped | software | 9.8 (8.0–10.2) | 311.1 | 130.46 | 78.3 |
| Bun 1.3.14 | shader | fifo | 60 | intel | 51.6 (51.2–52.8) | 12.7 | 22.37 | 119.5 |
| Bun 1.3.14 | shader | fifo | 60 | software | 9.3 (8.4–9.6) | 290.7 | 160.42 | 73.9 |
| Bun 1.3.14 | shader | immediate | uncapped | intel | 388.8 (358.9–393.4) | 36.4 | 3.13 | 110.5 |
| Bun 1.3.14 | shader | immediate | uncapped | software | 9.0 (6.8–9.9) | 299.7 | 145.75 | 72.4 |
| Bun 1.3.14 | shader | immediate | 60 | intel | 52.7 (40.6–53.1) | 12.9 | 20.60 | 119.3 |
| Bun 1.3.14 | shader | immediate | 60 | software | 9.5 (3.4–10.1) | 307.5 | 138.85 | 76.2 |

## Limits

This is a short, shared-host microbenchmark with default driver settings and
uncontrolled thermal/power state. It establishes hardware/software differences
for these workloads, not an engine performance guarantee or a before/after
comparison of implementation commits. The compositor output is virtual; physical
scanout, high-refresh monitors, VRR, tearing and input-to-display latency remain
unmeasured. Physical high-DPI transitions and physical input devices were not
exercised. Fixed updates still share the main thread with blocking presentation;
severe stalls can exhaust bounded catch-up and discard simulation time.

Raw verification logs, compositor/driver diagnostics, captures, pilot/discarded
samples, the matrix runner, per-run measurements and summaries are generated under
`build/native/hardware-current/` and ignored by Git. The process-lifetime GPU-owner
workaround and bounded deferred swapchain cleanup remain in place.
