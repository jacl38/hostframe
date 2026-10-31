# Native build

The initial setup supports **Linux x64 with GLFW/X11 and Vulkan**. Other platforms
fail explicitly before downloading an incompatible engine. This is a source
contributor workflow; distributing prebuilt addons to application developers is
still planned.

## Commands

```sh
bun install
bun run setup
bun run native:verify
# With an X11 display available:
bun run native:verify --presentation
```

- `setup`: check prerequisites, download and verify pinned inputs, generate
  bindings, configure CMake, and build the addon and native presentation check.
- `native:build`: rebuild prepared native sources without downloading or running
  generators. Rerun `setup` after changing the pinned inputs or generation script.
- `native:check-build`: inspect `compile_commands.json` and reject unexpected
  sources, including Dawn's engine, Tint, and upstream's proc-table module entry.
- `native:verify`: load the same addon in Node.js and Bun, dispatch a compute
  shader, and assert the mapped readback values. Each runtime has a 30-second
  timeout. The shared TypeScript fixture is in `packages/native/test/compute.ts`
  so both runtimes execute identical code directly; Node.js uses built-in type
  stripping, and `typecheck` checks it with the standard WebGPU definitions. It also
  exercises invalid GPU flags and ordinary device cleanup. Both runtimes also run
  application initialization failure checks with `DISPLAY` cleared, including safe
  retries and rejection of application construction from a worker thread.
- `native:verify --presentation`: additionally run a C++ executable that creates
  a GLFW window and acquires, clears, and presents 60 frames through Dawn. This
  checks native window/surface integration separately from the JavaScript binding.
  It then runs the JavaScript window fixture in Node.js and Bun: 60 rendered
  frames, forced GC, callback exceptions and recovery, asynchronous-result and
  reentrancy rejection, texture expiration, repeated disposal, recreation with
  the same device within one application, failed window initialization, and
  destroyed-device checks. It also checks recovery from GPU-global installation
  failure after GLFW initialization. It verifies that a replacement window retains
  the same X11 socket connection (the session survives window disposal),
  application disposal closes a live window, disposed operations fail, and
  buffer write/readback still works on the caller-owned device afterward. Separate processes also check
  ordinary shutdown with an application owning a live window and no explicit
  disposal, including GC with only the application retained. The scheduler fixture
  additionally checks synchronous fixed-update/render callbacks, host timer and GPU
  readback progress during rendering, callback failure recovery, rejected async
  results, pause/resume, cancellation, close requests, and disposal while running.
- `lint`, `typecheck`, `test`: check project code, setup regression tests, and
  deterministic clock/scheduler behavior at low and high render rates.

The addon is `build/native/cmake/ts_dawn.node`. Its `create`, `globals`, and native
`Application` exports are internal building blocks. Import the TypeScript
`Application` from the root `index.ts` entry point (implemented in
`packages/core/application.ts`).

## Application ownership and JavaScript presentation

Run `bun run example:solid-color` or `node examples/solid-color.ts` with an X11
display. The same example uses 120 Hz fixed updates and renders a blue 320×240
window for three seconds of simulated time. Native close requests stop it normally.
For a headless check, use `xvfb-run -a bun run native:verify --presentation`.
To exercise an OS close request manually, run
`node packages/native/test/loop.ts --external-close` (or use `bun`) on a desktop
and close the window through its window manager; the fixture must exit normally.

`packages/core/application.ts` exposes the minimal `Application` API. The internal
`packages/native/bridge.ts` handles addon loading, globals, and the process GPU root.
The former experimental free functions have been removed.

- `new Application()`: initializes and owns a GLFW session on the process main
  thread. Only one application may be live at a time. Initialization failures
  release partial state; retries are safe.
- `app.gpu`: exposes the single GPU owner rooted on `globalThis` until process
  exit, including runtime teardown. Dawn's WebGPU globals are installed during
  application construction. Use devices obtained through this GPU for windows.
- `app.createWindow(device)`: creates one fixed 320×240 window. Only one live window
  is supported. The application tracks and owns native window state even if the
  JavaScript window wrapper is collected. The window owns its surface and
  presentation resources and retains its JavaScript device until disposal;
  callers retain ownership of the device.
- `app.pollEvents()`: pumps GLFW events independently of drawing; returns true
  while a window remains open, false when none exists or all have close requests.
  Main-thread and reentrancy guards apply. `app.run()` pumps events automatically.
- `window.shouldClose` / `window.requestClose()`: query or set the native close
  flag. A request does not dispose the window. The scheduler stops normally when
  the last window has a close request. Both operations throw after disposal.
- `window.draw(callback)`: acquires a surface texture, calls
  the callback synchronously, then presents. Encode and submit all work before
  returning `undefined`; async callbacks are rejected. A callback failure abandons
  the frame, preserves the thrown value, and permits a later draw. Acquired
  textures and their views cannot be used for GPU work after the callback ends.
- `window.dispose()`: releases presentation resources and the native window,
  releases the retained device reference, and unregisters from the application.
  The GLFW session stays initialized so a replacement window can be created.
- `app.dispose()`: disposes its windows before releasing GLFW. Does not destroy
  caller-owned devices or release the process GPU root. Repeated window and
  application disposal is safe. Creation on a disposed application and drawing
  on a disposed window throw. Application creation/drawing/disposal during a draw
  is rejected by native guards. A close request makes subsequent drawing throw;
  no close-event listener is required for the scheduler. Dispose windows or the application
  before destroying the device; an already destroyed device is handled safely.

Native application state strongly owns window state; each window refers weakly
back to its application. A draw holds application state through the callback so
GC cannot tear down its session in the middle of a frame. Explicit application
cleanup and the environment cleanup hook close all windows before terminating
GLFW; surviving wrappers remain safely disposed. Keep the application reachable
while using it, and use explicit disposal for deterministic cleanup.

Disposal advances Dawn's native GPU progress until idle before GLFW releases the
X11 connection. In this pinned revision, a work-done future alone can leave
best-effort Vulkan swapchain deletion pending, which crashes if the display is
closed first. The implementation submits an empty command buffer and uses public
`dawn::native::DeviceTick` to drain these deletions. If polling exceeds five seconds,
it destroys the stalled device to release the display-dependent resources, and
explicit disposal throws. This fallback is not exercised by the normal tests.

`app.on("fixedUpdate", ...)`, `app.on("render", ...)`, and `app.run(options)` provide
an optional scheduler with bounded catch-up and pause/resume/stop controls. See
[the application loop contract](application-loop.md). The scheduler yields host
turns for GPU promises and I/O. FIFO presentation remains fixed; blocking surface
acquisition and OS/JavaScript scheduling affect callback execution times.

Broader window/context APIs, resize recovery, input events, multiple live windows,
selectable presentation modes, platform expansion, addon distribution, and complete
GC/shutdown validation are outside this increment. No additional upstream patches are used.

## Script organization

All package commands route through `scripts/native.ts`. Setup and build share one
lock and error handler. Command execution uses Bun Shell's `$`, with arguments
interpolated separately and working directories/environments scoped to each call.
Runtime checks use `Bun.spawn` for their timeouts and signal diagnostics.

```text
scripts/
  native.ts                  # CLI, locking, runtime verification
  native/
    dawn.lock.json           # Exact dependency data, including artifact layouts
    release.ts               # Load data, resolve paths, select the host artifact
    dependencies.ts          # Download, verify, extract, fetch pinned Git commits
    generate.ts              # Copy/patch bindings and run upstream generators
    build.ts                 # Prerequisites, CMake, compilation audit
    native.test.ts           # Regression tests
```

The compilation audit runs directly after CMake configuration and before building.
There is no additional Bun subprocess for the audit. Go and CMake enforce their
minimum versions from upstream `go.mod` and our `CMakeLists.txt`, respectively;
TypeScript does not keep a second copy of those version requirements.

## Prerequisites

Install these through your preferred system/toolchain manager before setup:

- Bun for repository scripts; Node.js with built-in TypeScript stripping for
  runtime verification.
- Git, curl, and tar for pinned dependency retrieval and extraction.
- CMake >= 3.22, Ninja, and a C++20 compiler with a compatible C++ standard library.
- Go >= 1.26, as required by this Dawn revision's `go.mod`.
- Python 3 for Dawn's generator. Jinja2 and MarkupSafe come from Dawn's pinned
  dependencies; no global pip installation is needed.
- Linux X11 development headers/libraries needed by GLFW, including Xrandr,
  Xinerama, Xcursor, Xi, and Xshape, plus `pkg-config`.
- A Vulkan loader and usable driver for runtime checks. Mesa software Vulkan can
  be useful on machines without a physical GPU, but driver capabilities vary.
- An X11 display for presentation. A headless machine can use an existing Xvfb
  installation, for example `xvfb-run -a bun run native:verify --presentation`.

Setup reports missing prerequisites and compiler/configuration failures; it never
installs system packages. CMake's GLFW configuration diagnoses missing X11 headers.
A successful build does not establish GPU driver compatibility.

CMake selects the host compiler. Set `CC` and `CXX` before the first setup to
select another compiler. When changing compilers, remove `build/native/cmake/`
first. The initial configuration builds Release native code with C++20.

`ccache` is optional and used automatically when present. Its cache, and Go's
module/build caches, live under `build/native/cache/`. Set `TS_DAWN_JOBS` to a
positive integer to change build parallelism (default: 2, to limit binding compile
memory use). Formatting and static analysis tooling for C++ are not configured yet.

## Pinned inputs and ownership

[`scripts/native/dawn.lock.json`](../scripts/native/dawn.lock.json) is the authoritative
lock manifest. It pins Dawn release `v20261026.205545`, revision
`5fbd545292cb7a4a9a275e322abec6007ffe2ae8`, and SHA-256 digests for the engine,
headers, source archive, and archive-based dependencies. Engine/header digests
come from the upstream release metadata. Source/dependency archive digests were
recorded from the specified immutable commit URLs. It also records extraction
layout, supported host artifacts, and archive/Git dependency revisions. These are
explicit pins, not automatic latest-version lookups. `release.ts` only adapts that
data to local paths and selects a supported host artifact.

The source archive is extracted to ignored `vendor/dawn/`. It is not a submodule
and must not be treated as ordinary project-owned source. Setup retrieves only
node-api-headers, node-addon-api, GPUWeb IDL, GLFW, Jinja2, and MarkupSafe from the
revisions listed in that Dawn revision's `DEPS`. It checks the manifest against
`DEPS` without executing the Python manifest or Dawn's full dependency fetcher.

Jinja2 and MarkupSafe use shallow Git checkouts verified against exact commit
object IDs: Gitiles archives contain variable metadata, making an archive checksum
unsuitable. Other downloaded archives are checksum-verified before extraction,
including cached downloads on subsequent setup runs. Extraction uses a temporary
directory; incomplete downloads/extractions do not become installed dependencies.
Existing unrecognized source directories are never overwritten.

Go and Python code remains upstream in `vendor/dawn/`. Our scripts are TypeScript.
Go resolves only the generator's needed modules using upstream `go.mod`/`go.sum`,
with readonly module metadata and automatic toolchain downloading disabled.

[`scripts/native/generate.ts`](../scripts/native/generate.ts) copies the binding
into `build/native/binding/`, adds the binding-only
`GPUDevice::GetNativeDevice()` accessor, and runs upstream generators for
`WebGPU.h/.cpp` and `ComboLimits.h/.cpp`. It does not modify the vendored binding.
Generated inputs are stamped so repeat setup runs can reuse them. These directories
are build-owned; edit the scripts or project-owned native sources instead.

The build script passes the locked library and include paths into CMake. The
current target imports **`engine/lib64/libwebgpu_dawn.a`**. The separate headers
archive happens to contain a library too, but we use only its headers. CMake never
adds Dawn's top-level project, builds Tint, or substitutes an engine source build
when an archive is unavailable.

On Linux, the addon hides symbols from linked static archives. This prevents ELF
symbol interposition from mixing Dawn's bundled Abseil with the version embedded
in Node.js. The addon entry point initializes upstream interop and calls the
monolithic engine's C entry points directly, without `dawnProcSetProcs`.

The current upstream binding's child objects do not keep their originating GPU
owner alive. The compute fixture and application bridge pin that owner globally
for the process lifetime, including queued callbacks and teardown. A module-local
variable alone proved insufficient under Bun's garbage collector. Introducing
`Application` establishes GLFW/window ownership only: it does not solve upstream
GPU-object lifetime management. Every application uses the same rooted GPU, and
application disposal deliberately leaves it alive along with caller-owned GPU
objects. Replacing this workaround requires separate upstream lifetime work.

## Recovery and updates

Downloads are cached in `build/native/downloads/`. A checksum mismatch fails
explicitly; remove the named archive before retrying. A mismatched or unrecognized
installed dependency also fails explicitly; move the reported directory aside
before rerunning setup. Source archives can change upstream despite an immutable
URL, so investigate checksum changes rather than accepting new digests blindly.

Setup/build share `build/native/.lock` to prevent concurrent mutations. A hard
interruption can leave this directory behind; remove it only after confirming no
setup/build is still running. Normal errors release the lock.

To update Dawn, select a release with a usable engine archive, record its exact
source revision and asset digests in `dawn.lock.json`, update selected dependencies to match `DEPS`,
and verify their archive digests or Git IDs. Recheck the accessor anchor and source
allowlist, regenerate from clean inputs, and rerun build, compute, and presentation
checks. Never combine a newer source checkout with an older engine.

## Verified locally

On Fedora 44 x64 with GCC 16.1.1, CMake 4.3.0, Ninja 1.13.2, Go 1.26.10,
Python 3.14.5, Node.js 26.7.0, and Bun 1.3.14:

- Fresh dependency retrieval, generation, and linking against the release archive.
- Repeat `setup` reused generated sources and Ninja reported no work.
- Build audit accepted 64 selected compilation units and rejected engine/Tint
  sources in regression tests.
- Compute/readback passed in both runtimes, including ordinary process exit.
- The native presentation executable rendered and presented 60 frames under
  Xvfb/X11 using Mesa lavapipe Vulkan. A captured window was inspected.
- The JavaScript window fixture passed in Node.js and Bun, including callback
  recovery, texture expiration, GC during rendering, window disposal/recreation
  within one application, application disposal with a live window, disposed
  operation rejection, constructor failure recovery (including GPU-global
  installation failure after GLFW initialization), and destroyed devices.
  X11 socket identities verified session retention across window disposal and
  release at application disposal. Buffer write/readback verified caller devices
  survive both disposal paths. Ordinary shutdown with an undisposed
  application/window passed separately. The solid-color example exited normally
  in both runtimes;
  captured 320×240 windows were inspected. Captures are generated under
  `build/native/screenshots/` and are not source inputs.
- Missing-display initialization failed cleanly. Corrupt downloads, reuse of
  installed dependencies, refusal to overwrite existing directories, rejected
  partial downloads, and unsupported hosts were covered by script tests.
- TypeScript lint and type checking passed. Deterministic timing tests cover
  120 Hz updates with 30/60/144/240/360/1000 FPS rendering, interpolation, catch-up
  limits, capped/uncapped scheduling, paused time, and cancellation.
- The scheduler fixture passed in Node.js and Bun with WebGPU rendering and
  readback, including callback-error recovery, subscriptions, pause/resume, close
  requests, window recreation, and application disposal while running. External
  X11 close requests and the scheduler-driven example were also exercised in both
  runtimes; captures are under `build/native/screenshots/scheduler/`.
- After consolidating the scripts, archive and Git retrieval were exercised with
  paths containing spaces; tests also covered dirty/stale Git checkouts, cleanup
  after a failed Git fetch, and invalid CLI commands/flags.

This machine has several Vulkan ICDs installed. Default driver enumeration logs
failures for unavailable hardware drivers while compute still succeeds. For the
headless presentation check we selected the installed lavapipe ICD with
`VK_DRIVER_FILES=/usr/share/vulkan/icd.d/lvp_icd.x86_64.json`; that path is
machine-specific and is not forced by the setup scripts.

### Intel hardware checks, 2026-10-31

Outside the filesystem/device sandbox, Vulkan enumerated the host's Intel
Alder Lake-N integrated graphics (`8086:46d1`) with Mesa 26.2.5. The sandbox does
not expose `/dev/dri`, so hardware checks require execution outside it.

With only the Intel ICD selected using
`VK_DRIVER_FILES=/usr/share/vulkan/icd.d/intel_icd.x86_64.json`:

- The existing compute shader/readback fixture passed in Node.js 26.7.0 and
  Bun 1.3.14.
- A temporary offscreen check created an `rgba8unorm` render attachment, cleared
  it blue in a render pass, copied it to a mapped buffer, and asserted all 16
  pixels. It passed in both runtimes, with the adapter reporting vendor `intel`.
  The check is generated at `build/native/hardware-render.ts`.
- The hardware presentation suite was attempted under Xvfb but could not run:
  Mesa reported `No DRI3 support detected - required for presentation` and the
  native presentation executable exited unsuccessfully. Software ICDs were
  excluded, so this did not silently fall back to lavapipe.

These establish hardware compute and offscreen render/readback behavior. Hardware
window presentation still needs an X11 display with DRI3; physical-monitor pacing,
VRR, latency, and performance remain unverified.

## Validation limits

The native presentation executable tests the engine/helper directly; the separate
JavaScript fixture exercises surface texture wrapping and synchronous presentation.
Neither establishes multi-window scheduling, thread handoff, complete GC/disposal
correctness, or broader window/context APIs.
macOS, Windows, Linux arm64, Wayland, distribution packaging, and performance
remain unverified. High-refresh behavior has deterministic timing coverage, but
real monitor pacing, frame-time percentiles, input latency, and VRR have not been
measured; Xvfb/lavapipe correctness checks are not performance benchmarks.
