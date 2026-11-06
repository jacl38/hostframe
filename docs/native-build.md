# Native build

Setup supports **Linux x64 with GLFW/X11 and Vulkan** and **macOS arm64
with GLFW/Cocoa and Metal**. Other platforms
fail explicitly before downloading an incompatible engine. This is a source
contributor workflow; see [Linux x64 packaging](packaging.md) for the initial
prebuilt addon package.

Project-owned bindings use nobind17 typed registrations; both build commands
produce `build/native/generated/native.d.ts`. Dawn bindings and `@webgpu/types`
remain in place. See [native binding generation and runtime integration](native-bindings.md).

## Commands

```sh
bun install
bun run setup
bun run native:verify
# With an X11 display available:
bun run native:verify --presentation
# With an X11 window manager, xdotool, and xprop available:
bun run native:verify --window-interactions
```

- `setup`: check prerequisites, download and verify pinned inputs, generate
  bindings, configure CMake, and build the addon and native presentation check.
- `native:build`: prepare build-owned nobind17 headers, compiler-resolve TypeScript
  input constants from the pinned GLFW header, rebuild prepared native sources,
  and extract typed declarations from the freshly linked addon without downloading
  or regenerating Dawn bindings. Rerun `setup` after changing the pinned inputs or Dawn binding
  generation script.
- `native:check-build`: inspect `compile_commands.json` and reject unexpected
  sources, including Dawn's engine, Tint, and upstream's proc-table module entry.
- `native:verify`: load the same addon in Node.js and Bun, dispatch a compute
  shader, and assert the mapped readback values. Each runtime has a 30-second
  timeout. The shared TypeScript fixture is in `packages/native/test/compute.ts`
  so both runtimes execute identical code directly; Node.js uses built-in type
  stripping, and `typecheck` checks it with the standard WebGPU definitions. It also
  exercises invalid GPU flags and ordinary device cleanup. Both runtimes reject
  application construction from a worker thread. On Linux, they also check
  initialization failure with `DISPLAY` cleared, including safe retries. macOS
  has no equivalent DISPLAY switch; partial-initialization recovery after GLFW
  succeeds is covered by the presentation suite.
  It also runs deterministic native present-mode selection checks without a
  display: FIFO default, Immediate preference, Mailbox fallback, and explicit
  rejection of unsupported policies (including empty capability lists). Deterministic
  acquisition checks cover optimal/suboptimal frames, bounded outdated/lost retries,
  timeouts, fatal errors, missing textures, non-drawable suspension, and
  release of unusable textures before reconfiguration.
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
  A separate presentation-settings fixture exercises vsync on/off with capped
  and uncapped rendering in both runtimes, checks fixed `dt`, option validation,
  selected modes, and recovery from abandoned frames. Unsupported vsync-off
  requests must fail explicitly and permit a FIFO retry.
- `native:verify --window-interactions` (Linux only): includes `--presentation` and additionally
  runs `packages/native/test/resize.ts` in Node.js and Bun. Requires an EWMH X11
  window manager (such as KWin), `xdotool`, and `xprop`. It checks default and
  custom titles/sizes/resizability, repeated large/small framebuffer transitions,
  minimizing/restoring without callbacks while minimized, abandoned-frame recovery,
  retained texture/view expiration, native reentrancy guards, minimized window and
  application disposal, caller device survival through write/readback, and destroyed
  device rejection while minimized. Set `HOSTFRAME_CAPTURE_DIRECTORY` to an output
  directory to capture initial/resized/restored windows; this also requires
  ImageMagick's `import`. These interaction checks require a window manager;
  plain `xvfb-run` alone cannot provide minimize/restore semantics.
- `lint`, `typecheck`, `test`: check project code, setup regression tests, and
  deterministic clock/scheduler behavior at low and high render rates.

The addon is `build/native/cmake/hostframe.node`. Its `create`, `globals`, and native
`Application` exports are internal building blocks. Import the TypeScript
`Application` from the root `index.ts` entry point (implemented in
`packages/core/application.ts`).

## Generated input constants

Every `setup` and `native:build` generates `build/native/generated/glfw-input.ts`
from `vendor/dawn/third_party/glfw3/src/include/GLFW/glfw3.h`, the same pinned header
used to compile GLFW and hostframe. `packages/core/keys.ts` re-exports its `Key`,
`PointerButton`, and `Modifier` objects with literal TypeScript types. No numeric
input constants are maintained in project source.

`scripts/native/input-constants.ts` discovers names in the compiler's active macro
list and compiles a temporary C++ program to resolve their values. Names keep their
GLFW suffixes (`Key.LEFT_SHIFT`, `Key.KP_ENTER`, `PointerButton.LEFT`,
`Modifier.SHIFT`); a single generator table renames standalone digits to `ZERO`
through `NINE` for all groups. `LAST` sentinels are excluded, and other aliases
remain available (`PointerButton.ONE` equals `PointerButton.LEFT`). Invalid or
unresolved expressions, unsafe integers, and public-name collisions fail the build.

The output is ignored by Git and records the header's SHA-256. Builds compare the
expected output with the file, recreating missing/stale output and avoiding writes
when unchanged. Run `bun run setup` on a fresh checkout, or `bun run native:build`
with already prepared dependencies, before typechecking or using these exports.

## Application ownership and JavaScript presentation

Run `bun run example:solid-color` or `node examples/vanilla/solid-color.ts` from a
macOS desktop session or with an X11 display on Linux. The same example uses 120 Hz fixed updates and renders a resizable blue 640×480
window for three seconds of simulated time. Native close requests stop it normally.
For an isolated headless check, use `bun scripts/validation/desktop.ts bun scripts/native.ts verify --window-interactions`. See [continuous validation](continuous-validation.md) for prerequisites and the command matrix.
Xvfb is suitable for software presentation checks; Intel Vulkan presentation
requires DRI3. See [the Intel validation report](intel-presentation.md) for an
isolated hardware-accelerated Xwayland environment and reproduction commands.
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
  exit, including runtime teardown. WebGPU globals require explicit
  `installWebGPUGlobals()`. Use devices obtained through this GPU for windows.
- `app.createWindow(options?: WindowOptions)`: creates one window. Options
  `title`, `width`, `height`, `resizable`, and `vsync` default to
  `"hostframe solid color"`, `320`, `240`, `false`, and `true`. Dimensions must be
  positive signed 32-bit integers in GLFW screen coordinates; title must be a string
  without embedded null characters, and flags must be booleans. Omitted/undefined
  fields use defaults. Multiple live windows are supported. The application tracks
  and owns native window state even if the
  JavaScript window wrapper is collected. The window owns its surface and
  presentation resources and retains its JavaScript device until disposal;
  callers retain ownership of the device.
- `window.presentMode`: the selected `"fifo"`, `"immediate"`, or `"mailbox"` mode.
  Vsync defaults to `true` (FIFO); `false` prefers advertised Immediate, then
  Mailbox, and throws if neither is supported. FIFO requests also require
  advertised support. Mode selection uses Dawn's surface capabilities, and the
  C++ capabilities object releases its returned arrays through RAII. Mode choice
  survives resizing, restoration, surface recovery, and abandoned-frame reconfiguration
  and is fixed until window disposal.
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
  Before acquiring, drawing queries framebuffer pixels (independent of initial
  screen-coordinate dimensions), and reconfigures only between frames. Use
  `texture.width`/`texture.height` inside the callback to update size-dependent
  attachments and rendering. Iconified or zero-size windows skip the callback and
  return `undefined`; event polling and fixed updates continue. Restoration lazily
  reconfigures at the new framebuffer size. A framebuffer exceeding the device's
  `maxTextureDimension2D` throws before configuring and can recover after shrinking.
  Outdated surfaces reconfigure and retry once; lost surfaces recreate their Dawn
  surface for the same GLFW window before that retry. Repeated unavailability or
  acquisition timeout skips the draw. Suboptimal textures render normally and
  schedule reconfiguration for the next draw, after frame expiration. Device loss
  and native lifecycle guards are checked even while minimized.
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
explicit unconfigure, replacement configuration, or disposal throws
`GPU cleanup timed out; device was destroyed` **after** releasing the affected
configuration/window/session ownership. Replacement configuration is not installed
when old-device cleanup times out. TypeScript clears its cached configuration or
listeners after native teardown even when the operation throws. Repeated cleanup
is safe. The device is normally caller-owned; this bounded timeout fallback is
an intentional ownership exception, including when other caller resources share
that device. Timeout destruction uses the retained Dawn JavaScript binding's
native destruction entry point so its finalizer state agrees with the native
device; `WindowState` keeps that binding alive until draining finishes. Failed
replacement cleanup also releases its old persistent device reference before
rethrowing the original cleanup error.

`HOSTFRAME_TEST_CLEANUP_TIMEOUT=1 bun run native:build` enables a compile-time-only
fault seam in private cleanup observations. In that build, the verifier's
`HOSTFRAME_TEST_CLEANUP_TIMEOUT=1 bun run native:verify --presentation` launches
fresh Node.js/Bun processes for unconfigure, replacement configuration, window
disposal, and application disposal. Each process forces one busy/expired drain
after real submission; it neither hangs a GPU nor replaces application behavior.
The fixture checks device loss, cached state, weak-reference collection while
wrappers remain reachable, error propagation, repeated cleanup, X11 session
release, and subsequent rendering. Existing real success-path checks still run.
CI runs this variant and then rebuilds the default addon before packaging.
Run `bun run native:build` without the build flag to remove the seam. Default
builds do not read the fault environment variable, expose no fault method or
public TypeScript API, and retain the same binding ABI. The forced observation
does not reproduce a driver hang or establish that every driver releases stalled
resources correctly.

Presentation keeps two distinct forms of state. An optional `ContextConfiguration`
owns the native device retain, validated descriptor, view-format storage, limits,
and timeout destruction callback. Its descriptor is the sole explicit native device
retain in presentation; `WindowState` separately retains the JavaScript binding
through cleanup. `SurfaceConfigurationState` tracks only whether Dawn's drawable
surface is unconfigured, current, or awaiting refresh after a suboptimal frame.
A current surface still requires a live device and drawable framebuffer before
acquisition. There is no per-state class hierarchy.

| Operation | Context configuration | Drawable surface |
| --- | --- | --- |
| Configure / valid replacement | Install after old cleanup succeeds | Unconfigured until acquisition |
| Invalid replacement | Preserve previous configuration | Preserve previous state |
| Acquire / restore | Retain; update framebuffer dimensions | Configure lazily, then acquire → render → present |
| Minimize / non-drawable / oversized framebuffer | Retain | Unconfigure; skip or reject the frame |
| Suboptimal frame | Retain | Present, then refresh on next acquisition |
| Outdated / lost surface | Retain | Unconfigure; recreate if lost; retry at most once |
| Acquisition timeout / callback failure | Retain | Unconfigure; a later frame can retry |
| Lost device | Retain until explicit cleanup; reject rendering | No further acquisition; deactivate if loss is observed during acquisition |
| Unconfigure / replacement cleanup timeout | Clear, then throw if timed out | Unconfigure and drain |
| Window / application disposal | Clear after bounded drain | Release surface before native window, then GLFW session |

On Linux, each new GLFW session also negotiates XFixes before Vulkan surface use. Mesa
26.2.5 cached WSI extension information by connection address across application
disposal while the process GPU remained alive. Reusing that address skipped
negotiation and caused fatal XFixes `CreateRegion` errors on Intel. Per-session
negotiation fixes the observed failure without changing Dawn, GLFW, or Mesa;
the lifecycle fixture repeatedly disposes and recreates applications to cover it.

`app.on("fixedUpdate", ...)`, `app.on("render", ...)`, and `app.run(options)` provide
an optional scheduler with bounded catch-up and pause/resume/stop controls. See
[the application loop contract](application-loop.md). The scheduler yields host
turns for GPU promises and I/O. The render cap is independent of vsync; blocking surface
acquisition and OS/JavaScript scheduling affect callback execution times.

Broader window/context APIs,
further platform expansion, and complete
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
- On macOS arm64: Xcode Command Line Tools with the macOS SDK (Cocoa, Metal,
  QuartzCore, IOSurface, and IOKit). No X11 or Vulkan packages are needed.
- On Linux: X11 development headers/libraries needed by GLFW, including Xrandr,
  Xinerama, Xcursor, Xi, and Xshape, plus `pkg-config`. hostframe also links Xfixes
  for per-session extension negotiation.
- On Linux: a Vulkan loader and usable driver for runtime checks. Mesa software Vulkan can
  be useful on machines without a physical GPU, but driver capabilities vary.
- An X11 display for presentation. A headless machine can use an existing Xvfb
  installation for software-driver checks, for example
  `xvfb-run -a bun run native:verify --presentation`. Hardware presentation needs
  a suitable display with DRI3; Xvfb does not provide it.

Setup reports missing prerequisites and compiler/configuration failures; it never
installs system packages. CMake's GLFW configuration diagnoses missing X11 headers.
A successful build does not establish GPU driver compatibility.

CMake selects the host compiler. Set `CC` and `CXX` before the first setup to
select another compiler. When changing compilers, remove `build/native/cmake/`
first. The initial configuration builds Release native code with C++20.

`ccache` is optional and used automatically when present. Its cache, and Go's
module/build caches, live under `build/native/cache/`. Set `HOSTFRAME_JOBS` to a
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
into `build/native/binding/`, adds binding-only GPU-instance/device accessors and an internal surface-aware
adapter selection method, and runs upstream generators for
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

On macOS 27.0.1 arm64 (Apple M4), Node.js 25.5.0, and Bun 1.4.2:

- `setup` and `native:build` built the addon against the pinned macOS engine;
  the compilation audit passed without building Dawn or Tint.
- `native:verify --presentation` passed Metal compute/readback, the C++ 60-frame
  presentation check, and both runtimes' binding, window lifecycle, worker-thread,
  scheduler, presentation-setting, and shutdown checks. FIFO and Immediate modes
  both passed with capped and uncapped rendering.
- Retina textures used twice the window's screen-coordinate dimensions. Shared
  fixture assertions cover that scale while retaining Linux's pixel-size checks.
- Linux's DISPLAY failure and X11 socket checks do not run on macOS. Recovery
  after GPU-global installation fails still runs in both runtimes.
- Automated resize/minimize/restore and keyboard/mouse interaction checks remain
  Linux-only. macOS input behavior, monitor pacing, and Intel Macs are unverified.

The desktop/GPU checks required access outside the execution sandbox; sandboxed
processes could not find a Metal adapter or connect to macOS desktop services.


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
- Configurable presentation passed the full native suite on Xvfb/lavapipe in
  Node.js and Bun. Both runtimes rendered with FIFO and Immediate, each capped
  and uncapped, while fixed updates retained `dt = 1 / 120`. Deterministic native
  tests cover Mailbox fallback and unsupported requests; those cases were not
  exercised against a physical surface restricted to those capabilities.
  The solid-color example also exited normally for all four settings in both
  runtimes; captured windows were inspected under
  `build/native/screenshots/presentation-settings/`.

### Cleanup and state validation, 2026-11-06

On Fedora 44 x64, GCC 16.1.1, Node.js 26.7.0, Bun 1.3.14,
Xvfb/KWin, and Mesa 26.2.5 lavapipe:

- Reused copies of pinned source/dependencies and checksum-verified archives;
  regenerated bindings and built in a private worktree CMake directory with
  private mutable caches. Downloaded the pinned Go generator module.
- The new reconfiguration regression first failed device collection while its
  application/window/context wrappers remained reachable. Resetting the old
  `WindowState` binding reference when native configuration is gone fixed it.
- Direct native timeout destruction also exposed intermittent lavapipe device
  destruction heap aborts during later cleanup/collection. Ordinary cleanup
  comparison runs passed. Routing forced destruction through the retained
  binding aligned its finalizer state; 20 repeated forced cases then passed.
  A separate sanitizer addon reported no error in one pre-fix window case;
  that observation alone did not identify the source of the corruption.
- The fault-enabled full presentation/interaction suite passed in both
  runtimes: eight timeout scenarios, real lifecycle success paths, compute,
  configuration/frame lifetime, deterministic acquisition recovery, resize,
  minimize/restore, keyboard/pointer input, and disposal/recreation.
- Inspected initial/resized/restored captures under
  `build/validation/desktop-nuK09F/captures/`. Context assertions verified retained
  configuration during suspension/restoration and device loss, then explicit
  cleanup after loss.
- Rebuilt the default addon with the seam disabled. Its binary contains no
  fault-control environment name, and its generated API declarations match the
  test addon (apart from the binary hash). Lint, typecheck, and all 55 script/core
  tests passed. The default addon also passed the full presentation suite.

These checks simulate cleanup progress/deadline failure on a functioning GPU;
real hung-driver destruction, macOS behavior, and hardware presentation were
not exercised in this change.

### Resize interaction checks, 2026-10-31

On the same Linux x64 / Node.js 26.7.0 / Bun 1.3.14 environment, Xvfb with KWin
and Mesa lavapipe passed the full presentation suite and the actual X11 resize
fixture in both runtimes, with both FIFO and Immediate presentation. The fixture resized 480×300 → 800×450 → 360×520,
minimized/restored, then cycled through 640×360, 240×180, 900×600, and 480×300.
Callbacks stopped while iconified and resumed with matching framebuffer texture
sizes. Captures at initial, resized, and restored sizes were inspected under
`build/native/resize-validation/screenshots/`. The resizable example also ran and
was captured at 640×480 and resized to 760×420 in both runtimes.

Run `bun run native:verify --window-interactions` within an existing X11 desktop,
or start an isolated Xvfb session and a window manager before running it. For example,
with the prerequisite tools installed:

```sh
xvfb-run -d -s '-screen 0 1280x960x24' dbus-run-session -- sh -eu -c '
  export QT_QPA_PLATFORM=xcb
  validation_dir=$(mktemp -d)
  export XDG_CONFIG_HOME="$validation_dir/config"
  export XDG_RUNTIME_DIR="$validation_dir/runtime"
  mkdir -p "$XDG_CONFIG_HOME" "$XDG_RUNTIME_DIR"
  chmod 700 "$XDG_RUNTIME_DIR"
  kwin_x11 --replace > /tmp/hostframe-kwin.log 2>&1 &
  manager_pid=$!
  trap "kill $manager_pid 2>/dev/null || true" EXIT
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    xprop -root _NET_SUPPORTING_WM_CHECK | grep -q "window id # 0x[1-9a-f]" && break
    sleep 0.2
  done
  bun run native:verify --window-interactions
'
```

The Fedora `xvfb-run -d` option asks Xvfb to allocate a free display with
`-displayfd`; it avoids stale lock-file collisions from `-a`. Confirm the
new display has the requested geometry before injecting input.

Select a suitable Vulkan ICD for that environment; the local software run used
`VK_DRIVER_FILES=/usr/share/vulkan/icd.d/lvp_icd.x86_64.json`. X11 requires local
sockets, which may need execution outside a restrictive sandbox. Use isolated
KWin configuration/runtime directories when another desktop is active.

Outdated/lost/timeout recovery has deterministic native coverage; real compositor
interactions do not force each driver status. This run verifies the X11 pixel-size
path at scale 1. These software checks do not exercise displays with differing
logical/framebuffer dimensions, physical DPI transitions or zero-size framebuffer
events. Non-drawable acquisition suspension and recovery sequencing are
covered deterministically. The original Intel report predates resize support;
the [2026-11-01 hardware follow-up](presentation-performance.md) additionally
passed resize/minimize/restore and input checks on Intel through Xwayland.

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

Hardware window presentation subsequently passed on an isolated KWin virtual
output with Xwayland 24.1.12 and DRI3. The full native and JavaScript presentation
suite passed with the Intel-only ICD and explicit Intel/non-fallback assertions
in Node.js 26.7.0 and Bun 1.3.14. All four example settings were captured and
inspected in each runtime, and external close requests exited normally.
Application recreation uncovered and fixed the XFixes negotiation issue described
above. The Xvfb/lavapipe suite also passed after the fix. See the
[environment, evidence, and reproduction commands](intel-presentation.md).

## Validation limits

The native presentation executable tests the engine/helper directly; the separate
JavaScript fixture exercises surface texture wrapping and synchronous presentation.
Neither establishes multi-window scheduling, thread handoff, complete GC/disposal
correctness, or broader window/context APIs.
Intel macOS, Windows, Linux arm64, native Wayland windows, broader distribution compatibility, and performance
remain unverified. High-refresh behavior has deterministic timing coverage, but
real monitor pacing, frame-time percentiles, input latency, and VRR have not been
measured; neither Xvfb/lavapipe nor the virtual KWin/Intel checks are performance
benchmarks. Xwayland verifies the X11 client path through a Wayland compositor,
not a native Wayland GLFW backend or physical-monitor scanout.

The `--window-interactions` suite also exercises real keyboard and pointer input
through xdotool in Node.js and Bun, including focus loss with held controls, OS
key repeat, scrolling, and game-style pointer capture. It needs repeat enabled
and an EWMH X11 desktop. See [window input](window-input.md).

### Session06 input contracts and key labels (2026-11-06)

The isolated worktree reused Session05's pinned vendor checkout and cached
archives. `bun install --frozen-lockfile` passed. Setup verified archive SHA-256
values and dependency Git revisions/DEPS alignment, regenerated the native
bindings, and compiled this worktree's hostframe/GLFW sources with a private
CMake/cache/output directory against the pinned prebuilt Dawn engine. The Dawn
engine itself was not compiled from source. Network access was needed for the
pinned Go generator dependencies.

`bun run native:build`, `bun run lint`, `bun run typecheck`, and the unit suite
passed. The private desktop command was:

```sh
VK_DRIVER_FILES=/usr/share/vulkan/icd.d/lvp_icd.x86_64.json \
  bun scripts/validation/desktop.ts bun scripts/native.ts verify --window-interactions
```

This includes the base compute/thread checks, presentation suite and real X11
interactions on Node and Bun. Native callbacks also have a standalone regression
executable covering same-batch transitions, independent unknown scancodes,
focus-loss reconciliation and failure recovery. Its only substitutes are the
terminal callback observer and Node exception-pending query; held state, event
queueing and reconciliation use production `input.cpp` and its registered GLFW
callbacks. No injection controls or test mode were added to the addon.

US and German printable labels passed in separately initialized GLFW sessions,
including unknown-token scancode lookup and non-printable symbolic fallback.
Replacing the entire server keymap during one session retained stale Xlib key
names in the pinned upstream implementation; this is documented in the input
API guide. The first default-ICD run passed compute and label checks but failed
presentation through Xvfb on Intel (no DRI3); the complete software-ICD run passed.
These checks establish Linux x64/X11 behavior, not macOS behavior. The pre-existing
exploratory Dawn throwing-format-getter crash remains outside this change.

### Multiple-window validation (2026-11-06)

On Linux x64, the presentation and `--window-interactions` suites passed with
Node.js 26.13.0, Bun 1.3.14, Mesa 26.2.5 lavapipe, and a private Xvfb/KWin X11
session. The same full suite passed with cleanup fault injection enabled,
including all eight unconfigure/reconfigure/window/application timeout cases
with a sibling surface sharing the stalled device. The default addon was then
rebuilt and checked for absence of the fault-control string.

The new two-window regressions exercise independent contexts and presentation
policies, creation-order dispatch, cross-window native operation guards, failed
creation/configuration/render/input, fixed-update create/remove/replacement,
first/final closure, focus and held-state routing, capture release, resize,
minimize/restore, paused commands, shared-device readback after normal cleanup,
and device-loss propagation on cleanup timeout. The two-window consumer example
was run, captured, and inspected in Node and Bun: both colors rendered, clicking
blue dimmed only blue, closing blue left orange running, and final closure exited.
The representative gallery also passed in both runtimes. The actual npm tarball
was installed by npm and Bun; consumer typechecking and two-window compute,
presentation, close/disposal, and no-display failure checks passed under Node.js
26.7.0 and Bun 1.3.14. Lint, typecheck, and all 57 unit tests passed.

These checks establish Linux X11/software-Vulkan behavior, not macOS multiwindow
behavior, multi-monitor or hardware-adapter compatibility across surfaces,
physical input, independent presentation pacing, or complete GC/shutdown safety.
The known upstream crash from a throwing canvas-format getter is outside this
change; the regression uses a throwing device getter to check exception identity.
