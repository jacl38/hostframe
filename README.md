**ts-dawn is a TypeScript library for building native desktop graphics applications without a browser or WebView.** It aims to provide the same API across Node.js, and Bun.

The implementation combines existing native components with a small integration layer. Native setup scripts are available under `scripts/`; see [the native build guide](docs/native-build.md). A minimal `Application` now owns native window lifetimes and connects JavaScript rendering to fixed-size native presentation. Events, resizing, scheduling, and multiple windows remain planned.

| Piece | Responsibility | Location |
|---|---|---|
| **Dawn engine** | Implements WebGPU, shader compilation, GPU validation, and presentation surfaces | Pinned upstream binary archive with matching headers |
| **Dawn’s JavaScript binding** | Exposes GPU objects, descriptors, promises, and resource operations through Node-API | Matching source at `vendor/dawn/`, compiled separately |
| **GLFW** | Creates native windows and delivers input/window events | Selected dependency pinned by Dawn’s manifest |
| **Dawn–GLFW helper** | Creates a Dawn presentation surface from a GLFW window | Matching source at `vendor/dawn/`, compiled separately |
| **ts-dawn native integration** | Owns GLFW sessions and window surfaces; manages presentation and lifecycle | `packages/native/` |
| **ts-dawn TypeScript layer** | Provides `Application`; typed events and scheduling remain planned | `packages/core/` |

Dawn supplies GPU functionality. GLFW supplies interactive windows. `ts-dawn` coordinates their ownership and execution.

**Minimal application API**

After `bun install` and `bun run setup`, run the [solid-color example](examples/solid-color.ts):

```sh
bun run example:solid-color
# The same TypeScript example runs directly in Node.js:
node examples/solid-color.ts
```

The [Application](packages/core/application.ts) owns one native GLFW session and
tracks its windows. One application and one live 320×240 window are supported at a
time, on the process main thread. The example renders a blue window for 180 frames
and exits. It requires Linux x64, X11, and a compatible Vulkan driver.

```ts
import { Application } from "./index.ts";

const app = new Application();
let device: GPUDevice | undefined;
try {
  const adapter = await app.gpu.requestAdapter();
  if(!adapter) throw new Error("No compatible adapter");
  device = await adapter.requestDevice();
  const renderingDevice = device;
  const window = app.createWindow(renderingDevice);

  window.draw(texture => {
    const encoder = renderingDevice.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: texture.createView(),
        clearValue: { r: 0.05, g: 0.1, b: 0.8, a: 1 },
        loadOp: "clear",
        storeOp: "store"
      }]
    });
    pass.end();
    renderingDevice.queue.submit([encoder.finish()]);
  });
} finally {
  try {
    app.dispose();
  } finally {
    device?.destroy();
  }
}
```

Each `draw` polls native events, acquires a surface texture, runs the synchronous
callback, and presents. Encode and submit commands before returning `undefined`.
Textures and their views expire when the callback finishes. Failed callbacks
abandon the frame, preserve the thrown value, and permit later draws. Reentrant
creation/drawing/disposal, asynchronous callback results, disposed objects, and
lost devices are rejected. Drawing is caller-driven; there is no scheduler.

Windows own their surfaces and presentation resources and retain their JavaScript
device while alive. Devices remain caller-owned: dispose the window or application
before destroying a device. `window.dispose()` unregisters the window and permits
`app.createWindow(device)` again without terminating GLFW. `app.dispose()` disposes
all its windows before releasing GLFW. Repeated disposal is safe; creating a window
on a disposed application or drawing on a disposed window throws. Application
construction failure releases partial initialization so it can be retried.

Use a device obtained through `app.gpu`. Its single GPU owner is deliberately rooted
on `globalThis` until process exit because upstream child objects do not retain it.
Application disposal does not release this root or destroy caller-owned devices.
**Application ownership does not solve upstream GPU-object lifetime management.**
Window/application cleanup still drains deferred swapchain deletion; a five-second
GPU cleanup timeout destroys the stalled device and explicit disposal throws (see
[the build guide](docs/native-build.md)).

Resize handling, event subscriptions, scheduling, multiple live windows, and
packaged addons are outside this increment. The former experimental free functions
have been replaced by `Application`.

**Native integration**

Connecting a GLFW window to a Dawn surface already uses public upstream functionality:

```cpp
wgpu::Surface surface = wgpu::glfw::CreateSurfaceForWindow(instance, window);
```

That connection does not require modifying either library.

> [!NOTE]
> Here, `wgpu::` is Dawn’s C++ WebGPU namespace; it does not refer to the separate Rust wgpu implementation.

The prototype established how to connect **Dawn’s JavaScript objects to native presentation resources**. One binding-only accessor, `GPUDevice::GetNativeDevice()`, exposes the native device. ts-dawn unwraps the JavaScript device, derives its adapter and instance through `device.GetAdapter().GetInstance()`, and uses the GLFW helper to create a surface. Acquired textures are wrapped using the existing `interop::GPUTexture::Create<binding::GPUTexture>` implementation.

Add this public accessor inside upstream `binding::GPUDevice`:

```cpp
wgpu::Device GetNativeDevice() const { return device_; }
```

The project-owned addon entry point initializes upstream interop with `interop::Initialize(env)` and creates GPU objects through upstream `binding::GPU`. WebGPU functions link directly to the monolithic engine’s C entry points; this build does not call `dawnProcSetProcs` or compile upstream’s proc-table-based module entry point.

Stock GPU, adapter, and device creation remains intact. Applications use normal JavaScript WebGPU commands with the acquired textures, followed by native presentation. No engine, texture, command-encoder, or GLFW patches are required. The accessor patch is compiled with the binding and does not require rebuilding the engine.

Windowing and presentation implementation stays in ts-dawn’s own files. The application owns the GLFW session and native window state; windows retain their JavaScript devices until disposal. The GPU owner remains rooted for the process lifetime. Native operation guards coordinate drawing, device loss, and disposal.

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
    application.ts # Minimal application API

scripts/
  native.ts       # setup, build, check-build, verify commands
  native/         # Lock manifest, dependencies, generation, build, tests

build/             # Ignored generated output
```

ts-dawn consumes externally prebuilt Dawn engine binaries and matching headers. Setup compiles Dawn’s Node-API binding, GLFW, the Dawn–GLFW surface helper, and ts-dawn integration separately, linking them against `libwebgpu_dawn`. It does not compile Dawn’s engine or Tint.

The source archive, headers, and engine binaries must match the same Dawn revision, and downloaded archives must have pinned checksums. `vendor/dawn` supplies source inputs for the binding, helpers, and generators; its presence does not imply an engine source build. Dawn’s dependency manifest supplies compatible revisions for the required dependencies, including GLFW. Upstream binary releases are best-effort, so artifact availability and compatibility must be checked for each target platform.

Bun manages the TypeScript workspace and runs the repository’s TypeScript setup/build scripts. The setup workflow is:

1. Download and checksum-verify the pinned engine archive and matching headers for the host OS/architecture. Fail explicitly if no compatible artifact is available.
2. Extract the matching Dawn source archive and fetch only the required binding, generator, and GLFW dependencies.
3. Generate `WebGPU.h/.cpp` using upstream’s Go IDL generator and matching IDL/templates, and `ComboLimits.h/.cpp` using upstream’s Python generator. Apply the accessor patch to a separate binding copy. Generated files and libraries must come from reproducible inputs, without depending on files from another checkout or scratch directory.
4. Use a project-owned CMake target to compile the binding implementations, interop `Core.cpp`, `ManualConstructors.cpp`, generated bridge sources, GLFW/helper, and ts-dawn integration. Import and link the downloaded `libwebgpu_dawn` archive. Do not add Dawn’s top-level CMake project with `add_subdirectory(vendor/dawn)` or invoke its full engine build/dependency fetcher.

Setup builds the native addon used by the TypeScript `Application`. Broader window/context APIs remain future work.

The developer entry point is `bun install` followed by `bun run setup`. Keep repository scripts in Bun/TypeScript and use CMake for platform-specific compilation/linking. Report missing system prerequisites without installing them through a distribution-specific package manager. Verify the resulting addon with compute/readback checks in Node.js and Bun, exercise native and JavaScript window presentation with `bun run native:verify --presentation`, and inspect the compilation graph to confirm that no engine or Tint sources are compiled.

The implementation is organized into:

- [Dependency lock manifest](scripts/native/dawn.lock.json) and [dependency retrieval](scripts/native/dependencies.ts): pinned engine artifacts, source revision, and SHA-256 checksums.
- [Command entry point](scripts/native.ts), [generators and accessor patch](scripts/native/generate.ts), and [build orchestration](scripts/native/build.ts): Bun/TypeScript scripts calling upstream tools and CMake.
- [Native CMake target](packages/native/CMakeLists.txt) and [module entry point](packages/native/src/module.cpp): selected sources linked against the downloaded engine, without its full source build.
- [Build audit](scripts/native/build.ts), [runtime verification](scripts/native.ts), and [native presentation check](packages/native/test/presentation.cpp): compilation boundary and runtime checks.
- [Build guide](docs/native-build.md): prerequisites, platform status, dependency updates, and verification commands. The pinned starting release is [v20261026.205545](https://github.com/google/dawn/releases/tag/v20261026.205545), revision `5fbd545292cb7a4a9a275e322abec6007ffe2ae8`.

Downloaded dependencies and generated artifacts are ignored and do not become ordinary tracked ts-dawn source files. Application developers would receive **prebuilt native addons**, rather than needing to build Dawn themselves.

This checkout passes JavaScript compute/readback and fixed-size window presentation checks in Node.js and Bun, plus a separate C++ GLFW/X11/Vulkan presentation check on Linux x64; see the build guide for exact versions and lifetime constraints. The solid-color example was captured and inspected in both runtimes. Other platforms, complete GC/shutdown correctness, and performance remain unverified. Broader window APIs and addon distribution still require implementation; broader compatibility and lifecycle validation are required before making release guarantees.
