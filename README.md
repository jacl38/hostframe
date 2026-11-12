**hostframe is a TypeScript library for building native desktop graphics applications without a browser or WebView.** It aims to provide the same API across Node.js, and Bun.

Licensed under [Apache-2.0](LICENSE). Third-party components retain their own
licenses; the package includes their notices in `dist/THIRD_PARTY_NOTICES.txt`.

The implementation combines existing native components with a small integration layer. Native setup scripts are available under `scripts/`; see [the native build guide](docs/native-build.md). A minimal `Application` now owns native window lifetimes and connects JavaScript rendering to native presentation with optional resizing. The application scheduler drives fixed updates and window render events; explicit event polling is also available. Keyboard and pointer input include held-state snapshots and game-style pointer capture. One application can own multiple independently configured windows.

| Piece | Responsibility | Location |
|---|---|---|
| **Dawn engine** | Implements WebGPU, shader compilation, GPU validation, and presentation surfaces | Pinned upstream binary archive with matching headers |
| **Dawn’s JavaScript binding** | Exposes GPU objects, descriptors, promises, and resource operations through Node-API | Matching source at `vendor/dawn/`, compiled separately |
| **GLFW** | Creates native windows and delivers input/window events | Selected dependency pinned by Dawn’s manifest |
| **Dawn–GLFW helper** | Creates a Dawn presentation surface from a GLFW window | Matching source at `vendor/dawn/`, compiled separately |
| **hostframe native integration** | nobind17 registrations, generated declarations, GLFW sessions, window surfaces, presentation and lifecycle | `packages/native/` |
| **hostframe TypeScript layer** | Provides `Application`, fixed updates, render callbacks, and optional scheduling | `packages/core/` |

Dawn supplies GPU functionality. GLFW supplies interactive windows. `hostframe` coordinates their ownership and execution.

**Linux x64 package**

[GitHub Releases](docs/github-releases.md) is the initial distribution flow:
version tags build and verify the tarball, then create an unpublished draft.
The same build job runs locally with `gh act` or manually on GitHub.

The npm package build includes ESM JavaScript, TypeScript declarations, and a
prebuilt native addon. Consumers need no native build tools or install scripts:

```sh
npm install ./hostframe-0.1.0-alpha.0.tgz
# or: bun add ./hostframe-0.1.0-alpha.0.tgz
```

```ts
import { Application, Key, PointerButton } from "hostframe";
```

This first package targets the current Linux x64/glibc system with X11 and
Vulkan. The locally built addon requires glibc 2.43 and GLIBCXX 3.4.32;
compatibility with older distributions is unverified. macOS source builds
remain supported, but are not included in this package. See
[packaging](docs/packaging.md) for build, consumer verification, runtime
prerequisites, and release limitations.

**Examples**

The [example gallery](examples/README.md) contains 18 runnable demos grouped by
rendering source: vanilla WebGPU, webgpu-utils, TypeGPU, and Three.js, including
Rapier physics. Run `bun run example --list`, then for example
`bun run example three/shadows`. Every entry also runs directly in Node.js.

**Headless GPU access**

Import `gpu` to use Dawn without creating an `Application`, initializing GLFW,
or connecting to a display:

```ts
import { gpu, GPUTextureUsage, GPUBufferUsage, GPUMapMode } from "hostframe/globals";

const adapter = await gpu.requestAdapter();
if(!adapter) throw new Error("No compatible GPU adapter");
const device = await adapter.requestDevice();
try {
  // Use standard WebGPU rendering and compute commands here.
  // Render into a texture with RENDER_ATTACHMENT | COPY_SRC usage, then
  // copyTextureToBuffer() and mapAsync() to retrieve CPU image pixels.
} finally {
  device.destroy();
}
```

The [headless render/readback check](packages/native/test/headless.ts) draws a
triangle into an offscreen texture and checks its CPU pixels, including padded
copy rows. `bun run native:verify` runs it in Node.js and Bun with display
variables cleared.

`hostframe/globals` exports the WebGPU constants and constructors present in
both the pinned Dawn binding and `@webgpu/types`. These are explicit imports;
they do not modify `globalThis`. `gpu` is also available from `hostframe`.
For libraries that expect WebGPU globals, installation remains opt-in:

```ts
import { installWebGPUGlobals } from "hostframe";

installWebGPUGlobals();
```

`gpu` is the same process-wide Dawn object exposed by `Application.gpu`. Importing
the public entry point initializes that object, but does not initialize GLFW.
It remains rooted until process exit, independently of application disposal;
callers own and must destroy their devices and resources. Headless work does not
need `Application.run()` or event polling. Constructing an `Application` still
initializes GLFW and requires a desktop session on Linux/X11.

Headless access uses the same native addon and GPU drivers as windowed access.
The Linux addon still requires its linked X11 runtime libraries even when no
display connection is opened. This does not supply DOM image/video APIs or an
image encoder; readback produces raw pixels.

**Minimal application API**

After `bun install` and `bun run setup`, run the [solid-color example](examples/vanilla/solid-color.ts):

```sh
bun run example:solid-color
# The same TypeScript example runs directly in Node.js:
node examples/vanilla/solid-color.ts
```

The [Application](packages/core/application.ts) owns one native GLFW session and
tracks its windows. One application with multiple live windows is supported on
the process main thread. The example renders a resizable blue 640×480 window for three
seconds of simulated time and exits, or stops normally when the window is closed.
It supports Linux x64 with X11 and Vulkan, and macOS arm64 with Cocoa and Metal.

Create the window before choosing its GPU device. Its WebGPU context owns the
presentation surface and can select an adapter compatible with that surface:

```ts
import { Application, installWebGPUGlobals } from "hostframe";

installWebGPUGlobals();

const app = new Application();
let device: GPUDevice | undefined;
try {
  const window = app.createWindow({
    title: "My application",
    width: 1280,
    height: 720,
    resizable: true
  });
  const context = window.getContext("webgpu");
  const adapter = await context.requestAdapter();
  if(!adapter) throw new Error("No compatible GPU adapter");
  device = await adapter.requestDevice();
  const renderingDevice = device;
  context.configure({
    device: renderingDevice,
    format: app.gpu.getPreferredCanvasFormat()
  });

  window.on("render", () => {
    const encoder = renderingDevice.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.05, g: 0.1, b: 0.8, a: 1 },
        loadOp: "clear",
        storeOp: "store"
      }]
    });
    pass.end();
    renderingDevice.queue.submit([encoder.finish()]);
  });

  await app.run();
} finally {
  try {
    app.dispose();
  } finally {
    device?.destroy();
  }
}
```

`context.requestAdapter(options?)` is a Hostframe extension accepting standard
`GPURequestAdapterOptions`. The context supplies the native surface constraint;
`app.gpu` remains the standard WebGPU interface. Alternatively, select an adapter
with `app.gpu.requestAdapter()` and let `context.configure()` check compatibility.
Devices from either path remain ordinary Dawn WebGPU devices.

Hostframe acquires a surface texture before dispatching the window's synchronous
render listeners, presents once after successful dispatch, and expires the texture
and its views afterward. `getCurrentTexture()` returns the same object throughout
that dispatch and throws outside it. A failed listener abandons the frame and
rejects `app.run()` with the original error. Async listeners are rejected.
For a caller-owned loop, call `context.draw(callback)` after `app.pollEvents()`;
it provides the same synchronous frame scope and returns whether a drawable frame
was acquired. It cannot be used while `app.run()` is active. See the
[custom-loop example](docs/application-loop.md#caller-owned-loops).
Configuration, disposal, event polling, and other reentrant native mutations are
forbidden during rendering; `app.stop()` and `app.pause()` remain safe.

An unconfigured context emits no window render events. Minimized/zero-size windows
and temporarily unavailable frames also skip window render events; event polling
and fixed updates continue. Outdated/lost surface acquisition gets one recovery
attempt; suboptimal acquisition renders and requests reconfiguration next frame.
Device loss and invalid lifecycle operations still fail the run.

Window defaults remain title `"hostframe solid color"`, 320×240 client size,
non-resizable, and vsync enabled. Dimensions are positive signed 32-bit integers
in GLFW screen coordinates. Framebuffer pixels can differ on high-DPI displays;
size depth/MSAA attachments, viewports, and projections from the current texture's
`width` and `height`. Framebuffer changes are applied automatically after polling.
`window.metrics` exposes an immutable snapshot of logical client size, framebuffer
pixels, platform content scale, and drawability before rendering. Subscribe to
`"metrics"` for coalesced changes before input; `window.toFramebuffer(x, y)` maps
pointer screen units using measured sizes. See [units and ordering](docs/window-input.md#window-metrics-and-pixel-conversion).

`context.configure()` accepts `GPUCanvasConfiguration`; the format, usage, alpha
mode, and view formats are validated. Currently only `"srgb"` color space and
`"standard"` tone mapping are supported. `getConfiguration()` returns a copy;
`unconfigure()` releases presentation resources and permits later reconfiguration.
See [the window context contract](docs/window-context.md) for lifecycle details.

Presentation and the scheduler cap remain separate. Set `vsync: false` at window
creation to prefer Immediate, then Mailbox. The default `true` selects FIFO.
Configuration throws if the surface cannot support the requested policy; it never
silently falls back to FIFO for `false`. Read `window.presentMode` after configuring.
`app.run({ maxFPS: 144 })` independently spaces scheduler render dispatches before texture acquisition;
omission means no scheduler cap. Variable acquisition waits can compress window
listener arrival intervals. Neither setting guarantees an achieved or displayed
frame rate. See [the timing contract](docs/application-loop.md#timing-contract).

```sh
bun examples/vanilla/solid-color.ts                              # FIFO, uncapped scheduler
bun examples/vanilla/solid-color.ts --max-fps=30                 # FIFO, capped
bun examples/vanilla/solid-color.ts --no-vsync                   # Immediate/Mailbox, uncapped
bun examples/vanilla/solid-color.ts --no-vsync --max-fps=144      # Immediate/Mailbox, capped
```

Windows own their surfaces and retain their configured JavaScript device. Devices
remain caller-owned: dispose/unconfigure the window before destroying its device.
`window.dispose()` unregisters only that window; `app.createWindow()` can also add
windows while others remain live, without terminating GLFW. `app.dispose()` disposes windows before releasing GLFW. Repeated
disposal is safe, including a window that was never configured. Closing the last
window ends `run()` normally but does not dispose resources; use `finally`.

Every application uses one process-rooted GPU owner because upstream child GPU
objects do not retain it. Application disposal does not release that root or
destroy caller-owned devices. **Application ownership does not solve upstream
GPU-object lifetime management.** Native cleanup drains deferred swapchain deletion;
a five-second timeout destroys the stalled device and throws after cleanup.
This also invalidates every other context sharing that device: their next render
fails with device loss. Dispose or unconfigure those contexts before replacing
the device. Ordinary window cleanup never destroys a shared device.

See the [two-window example](examples/vanilla/multiple-windows.ts): each window
has its own context, size, input, and close state, while both use one device.
`configure()` checks that device's adapter against each surface independently;
selection through one context does not guarantee support for another surface.
If a shared device is incompatible, choose a device through the other context
and keep its GPU resources separate. All devices must come from `app.gpu`.

Input and rendering visit snapshots of live windows in creation order. Each
window's input batch completes (including its deferred commands) before the next;
a failure aborts that poll, drops the failing batch's commands, and leaves later
windows' queued input for the next poll. Fixed updates may create/dispose windows;
the next render snapshot reflects those changes. Closed windows skip rendering,
but retain resources until disposal. Only closing/disposing the final open window
ends `run()`. Paused runs still poll input for every window.

Frames acquire, render, and present sequentially. A FIFO acquisition/presentation
wait for one window delays later windows and fixed updates on the same main
thread. Per-window vsync and a scheduler cap do not provide independent pacing.

**Window lifecycle and runtime controls**

Native user-close requests emit a synchronous `closeRequest` event. Call
`event.preventDefault()` to keep the window usable while prompting about unsaved
work; after saving, `window.requestClose()` force-closes without another prompt.
Uncanceled requests close after successful event dispatch, before the scheduler
checks for the final open window. Failed listeners leave the window open.
`minimize`/`restore` report native transitions; `metrics` remains the resize event.
`setTitle`, `setSize`, `setPosition`, and `setVisible` are guarded runtime controls;
`window.status` exposes polled position/visibility/minimization. Fullscreen is
deferred. See [the contract and follow-ups](docs/window-lifecycle.md), or run
`bun run example vanilla/window-lifecycle` for the unsaved-work example.

**Keyboard and pointer input**

Use `window.on("key" | "text" | "pointerMove" | "pointerButton" | "scroll" | "focus" |
"pointerCapture", listener)` for events and `window.input`, `isKeyDown(Key.W)`,
`isScancodeDown(scancode)`, and `isButtonDown(PointerButton.LEFT)` for held state.
Events are delivered by `app.pollEvents()` and `app.run()`, including while paused.
Focus loss clears held controls and releases capture. `setPointerCapture(true)`
hides and locks the cursor for unlimited game-control motion; the optional second
argument enables raw motion explicitly. Input listeners can call `requestClose()`
and `setPointerCapture()` directly: these commands execute after the successful
input batch, including while paused. Other native mutations retain their guards.

Run `bun run example:input` or `node examples/vanilla/input.ts` for an interactive square:
WASD/arrows move, click toggles capture, Escape releases it, the wheel changes
size, and Q quits; other entered text is logged from Unicode `text` events. See
[window input](docs/window-input.md) for event types, composition limitations,
coordinate units, repeat behavior, listener failure semantics, and lifecycle rules.

**Optional fixed-update loop**

Register synchronous callbacks, then explicitly start the loop:

```ts
const unsubscribe = app.on("fixedUpdate", ({ dt, tick }) => {
  // Advance simulation by dt seconds. At updateHz: 120, dt is always 1 / 120.
});
window.on("render", ({ alpha, frameTime, droppedTime }) => {
  // Interpolate simulation states and render into context.getCurrentTexture().
});
await app.run({ updateHz: 120 });
unsubscribe();
```

`run()` polls events, advances fixed simulation steps, dispatches render callbacks,
and yields to Node.js/Bun between iterations. Rendering has no scheduler-imposed
rate limit unless `maxFPS` is specified. A render cap does not throttle update
wakeups. Fixed-update accounting is independent of the presentation policy and
render cap. Surface acquisition/presentation can still block the main thread;
this API does not guarantee independent physics execution deadlines.

`app.stop()` ends a run; `app.pause()` pauses callbacks while continuing event
polling; `app.resume()` discards paused elapsed time and resets interpolation.
Closing or disposing the last window ends the run normally. Callbacks must return
`undefined` synchronously; a thrown value rejects the run promise unchanged.
Stopping does not dispose resources. Use `finally` to dispose the application and
then caller-owned devices. See [the loop contract](docs/application-loop.md) for
catch-up limits, interpolation, listener semantics, and custom loops.

The former experimental free functions have been replaced by `Application`.

**Native integration**

Connecting a GLFW window to a Dawn surface already uses public upstream functionality:

```cpp
wgpu::Surface surface = wgpu::glfw::CreateSurfaceForWindow(instance, window);
```

That connection does not require modifying either library.

> [!NOTE]
> Here, `wgpu::` is Dawn’s C++ WebGPU namespace; it does not refer to the separate Rust wgpu implementation.

The binding-only patches in `scripts/native/generate.ts` expose the native GPU
instance and device, and add an internal surface-aware adapter-selection entry
point. The latter shares upstream's backend/flag/feature selection and filters
adapters with `surface.GetCapabilities()`: Dawn's `EnumerateAdapters()` ignores
`compatibleSurface`. Standard JavaScript `GPU.requestAdapter()` retains its
existing parameters and behavior. Acquired textures use the existing
`interop::GPUTexture::Create<binding::GPUTexture>` wrapper.

The project-owned addon entry point initializes upstream interop with `interop::Initialize(env)` and creates GPU objects through upstream `binding::GPU`. WebGPU functions link directly to the monolithic engine’s C entry points; this build does not call `dawnProcSetProcs` or compile upstream’s proc-table-based module entry point.

Standard GPU, adapter, and device creation remains available. Applications use normal JavaScript WebGPU commands with the acquired textures, followed by native presentation. No engine, texture, command-encoder, or GLFW patches are required. These localized patches are compiled with the binding and do not require rebuilding the engine.

Project-owned `Application`, `Window`, options, and input bindings use nobind17 typed
registrations to generate `build/native/generated/native.d.ts` on both setup and
native builds. The TypeScript bridge imports those declarations. Dawn's existing
bindings and `@webgpu/types` still own WebGPU objects and types; narrow boundary
mappings preserve Dawn device/texture wrappers. See [native bindings](docs/native-bindings.md)
for generation, ownership, and the synchronous Bun compatibility adaptation.

Windowing and presentation implementation stays in hostframe’s own files. The application owns the GLFW session and native window state; windows retain their JavaScript devices until disposal. The GPU owner remains rooted for the process lifetime. Native operation guards coordinate drawing, device loss, and disposal.

**Dependency and build setup**

The repository uses this layout:

```
vendor/
  dawn/            # Pinned binding, helper, and generator source

packages/
  native/
    CMakeLists.txt
    src/
    bridge.ts      # Internal addon transport and process GPU owner
    test/          # Native and JavaScript runtime checks
  core/
    application.ts # Application and shared scheduler ownership
    window.ts      # Window input and render listeners
    context.ts     # WebGPU context and frame texture lifetime
    loop.ts        # Optional host scheduling
    timing.ts      # Fixed-step accounting and event types
    test/          # Deterministic timing and scheduler checks

scripts/
  native.ts       # setup, build, check-build, verify commands
  native/         # Lock manifest, dependencies, generation, build, tests

build/             # Ignored generated output
```

hostframe consumes externally prebuilt Dawn engine binaries and matching headers. Setup compiles Dawn’s Node-API binding, GLFW, the Dawn–GLFW surface helper, and hostframe integration separately, linking them against `libwebgpu_dawn`. It does not compile Dawn’s engine or Tint.

The source archive, headers, and engine binaries must match the same Dawn revision, and downloaded archives must have pinned checksums. `vendor/dawn` supplies source inputs for the binding, helpers, and generators; its presence does not imply an engine source build. Dawn’s dependency manifest supplies compatible revisions for the required dependencies, including GLFW. Upstream binary releases are best-effort, so artifact availability and compatibility must be checked for each target platform.

Bun manages the TypeScript workspace and runs the repository’s TypeScript setup/build scripts. The setup workflow is:

1. Download and checksum-verify the pinned engine archive and matching headers for the host OS/architecture. Fail explicitly if no compatible artifact is available.
2. Extract the matching Dawn source archive and fetch only the required binding, generator, and GLFW dependencies.
3. Generate `WebGPU.h/.cpp` using upstream’s Go IDL generator and matching IDL/templates, and `ComboLimits.h/.cpp` using upstream’s Python generator. Apply the accessor patch to a separate binding copy. Generated files and libraries must come from reproducible inputs, without depending on files from another checkout or scratch directory.
4. Prepare the build-owned nobind17 integration headers, resolve GLFW input constants with the C++ compiler, and use a project-owned CMake target to compile the binding implementations, interop `Core.cpp`, `ManualConstructors.cpp`, generated bridge sources, GLFW/helper, and hostframe integration. Import and link the downloaded `libwebgpu_dawn` archive. Do not add Dawn’s top-level CMake project with `add_subdirectory(vendor/dawn)` or invoke its full engine build/dependency fetcher.

5. Extract project-owned TypeScript declarations from the freshly linked addon in a separate Node process.

Setup builds the native addon used by the TypeScript `Application`. Broader window/context APIs remain future work.

The developer entry point is `bun install` followed by `bun run setup`. Keep repository scripts in Bun/TypeScript and use CMake for platform-specific compilation/linking. Report missing system prerequisites without installing them through a distribution-specific package manager. Verify the resulting addon with compute/readback checks in Node.js and Bun, exercise native and JavaScript window presentation with `bun run native:verify --presentation`, and inspect the compilation graph to confirm that no engine or Tint sources are compiled.

The implementation is organized into:

- [Dependency lock manifest](scripts/native/dawn.lock.json) and [dependency retrieval](scripts/native/dependencies.ts): pinned engine artifacts, source revision, and SHA-256 checksums.
- [Command entry point](scripts/native.ts), [generators and accessor patch](scripts/native/generate.ts), and [build orchestration](scripts/native/build.ts): Bun/TypeScript scripts calling upstream tools and CMake.
- [Native CMake target](packages/native/CMakeLists.txt) and [module entry point](packages/native/src/module.cpp): selected sources linked against the downloaded engine, without its full source build.
- [Build audit](scripts/native/build.ts), [runtime verification](scripts/native.ts), and [native presentation check](packages/native/test/presentation.cpp): compilation boundary and runtime checks.
- [Build guide](docs/native-build.md): prerequisites, platform status, dependency updates, and verification commands. The pinned starting release is [v20261026.205545](https://github.com/google/dawn/releases/tag/v20261026.205545), revision `5fbd545292cb7a4a9a275e322abec6007ffe2ae8`.

Downloaded dependencies and generated artifacts are ignored and do not become ordinary tracked hostframe source files. The initial Linux x64 package includes a **prebuilt native addon**; see [packaging](docs/packaging.md).

On macOS arm64 (Apple M4), Metal compute/readback and the full presentation suite pass in Node.js 25.5.0 and Bun 1.4.2, including Retina framebuffers, lifecycle, scheduler, and shutdown checks. Automated macOS input and resize/minimize interactions remain unverified.

This checkout passes JavaScript compute/readback and configurable/resizable window presentation checks in Node.js and Bun, plus a separate C++ GLFW/X11/Vulkan presentation check on Linux x64; see the build guide for exact versions and lifetime constraints. Intel integrated-GPU presentation passed through DRI3/Xwayland on a virtual KWin output, with software fallback excluded; see the [hardware validation report](docs/intel-presentation.md). The resizable solid-color example was captured and inspected in both runtimes. Resize/minimize/restore and disposal interactions passed under Xvfb/KWin with lavapipe in Node.js and Bun; see the build guide for reproduction and limits. Physical-monitor pacing, platforms beyond Linux x64 and macOS arm64, complete GC/shutdown correctness, and performance remain unverified. Broader window APIs still require implementation; broader package compatibility and lifecycle validation are required before making release guarantees.

Continuous PR, desktop interaction, renderer and packed-consumer gates are documented in [Continuous validation](docs/continuous-validation.md).

WebGPU globals are opt-in: importing hostframe and constructing `Application` do
not install constructors or constants. Call `installWebGPUGlobals()` before code
that uses global WebGPU names (including renderer integrations). It installs
missing names, accepts existing identical addon values even when read-only, and
rejects conflicting values or accessors, including inherited properties. All
checks precede installation, so a conflict or nonextensible global leaves the
globals unchanged. Foreign implementations are never overwritten. Repeated
installation preserves constructor identity. GPU ownership remains rooted until
process exit independently of installation and application disposal.
