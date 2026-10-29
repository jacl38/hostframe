**ts-dawn is a TypeScript library for building native desktop graphics applications without a browser or WebView.** It aims to provide the same API across Node.js, and Bun.

The implementation combines existing native components with a small integration layer. Native setup scripts are available under `scripts/`; see [the native build guide](docs/native-build.md). An experimental fixed-size window bridge now connects JavaScript rendering to native presentation. The higher-level application/window API below remains a proposal.

| Piece | Responsibility | Proposed location |
|---|---|---|
| **Dawn engine** | Implements WebGPU, shader compilation, GPU validation, and presentation surfaces | Pinned upstream binary archive with matching headers |
| **Dawn’s JavaScript binding** | Exposes GPU objects, descriptors, promises, and resource operations through Node-API | Matching source at `vendor/dawn/`, compiled separately |
| **GLFW** | Creates native windows and delivers input/window events | Selected dependency pinned by Dawn’s manifest |
| **Dawn–GLFW helper** | Creates a Dawn presentation surface from a GLFW window | Matching source at `vendor/dawn/`, compiled separately |
| **ts-dawn native integration** | Connects GPU objects to window surfaces; manages presentation, lifecycle, and event delivery | `packages/native/` |
| **ts-dawn TypeScript layer** | Provides the application/window API, typed events, and scheduling | `packages/core/` |

Dawn supplies GPU functionality. GLFW supplies interactive windows. `ts-dawn` coordinates their ownership and execution.

**Implemented experimental window bridge**

After `bun install` and `bun run setup`, run the [solid-color example](examples/solid-color.ts):

```sh
bun run example:solid-color
# The same TypeScript example runs directly in Node.js:
node examples/solid-color.ts
```

The internal [bridge](packages/native/bridge.ts) provides `createGPU()` and
`createWindow(device)`. One fixed 320×240 window supports synchronous
`draw(texture => { /* encode and submit here */ })` and idempotent `dispose()`.
The example renders a blue window for 180 frames and exits. It requires Linux
x64, X11, and a compatible Vulkan driver.

Native code acquires a surface texture, wraps it for ordinary JavaScript WebGPU
commands, and presents after the callback. The texture and its views expire when
the callback finishes. Failed callbacks abandon the frame and preserve the thrown
value. Reentrant operations, asynchronous callback results, disposed windows, and
lost devices are rejected.

Use a device from this bridge's `createGPU()`. Its single GPU owner is deliberately
rooted until process exit because upstream child objects do not retain it. Windows
retain their JavaScript device while alive; callers own the device and should
dispose the window before destroying it. This is an experimental bridge, without
resize handling, event subscriptions, multi-window scheduling, or packaged addons.

**Basic public API**

The application exposes GPU access, while each window exposes its own presentation context:

```ts
import { Application } from "ts-dawn";

const app = new Application();
const adapter = await app.gpu.requestAdapter();
if(!adapter) {
  app.dispose();
  throw new Error("No suitable adapter");
}

const window = app.createWindow({
  title: "Hello WebGPU",
  width: 800,
  height: 600
});

const context = window.getContext("webgpu");

const device = await adapter.requestDevice();
const format = app.gpu.getPreferredCanvasFormat();

context.configure({ device, format });

window.on("redraw", () => {
  const view = context.getCurrentTexture().createView();

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view,
      clearValue: { r: 0.05, g: 0.1, b: 0.2, a: 1 },
      loadOp: "clear",
      storeOp: "store"
    }]
  });

  pass.end();
  device.queue.submit([encoder.finish()]);
});

window.on("close", () => app.dispose());
```

This is an illustrative API contract. Applications use familiar WebGPU commands to draw into the window’s current texture. Dawn submits the GPU work and presents the result directly in the native window.

During a redraw, ts-dawn acquires a texture from the window’s Dawn surface, makes it available through the context, runs the synchronous TypeScript rendering callback, and presents afterward. Multiple windows may share a device.

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

Windowing and presentation implementation stays in ts-dawn’s own files. It must retain the originating GPU owner during asynchronous work and the JavaScript device while contexts depend on it, and coordinate GPU progress, device loss, and disposal.

**Dependency and build setup**

The repository uses this layout (the TypeScript core remains planned):

```
vendor/
  dawn/            # Pinned binding, helper, and generator source

packages/
  native/
    CMakeLists.txt
    src/
    test/          # Native presentation check
  core/
    src/

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

The TypeScript application/window layer is a subsequent implementation step; setup builds the experimental bridge, not that proposed API.

The developer entry point is `bun install` followed by `bun run setup`. Keep repository scripts in Bun/TypeScript and use CMake for platform-specific compilation/linking. Report missing system prerequisites without installing them through a distribution-specific package manager. Verify the resulting addon with compute/readback checks in Node.js and Bun, exercise native and JavaScript window presentation with `bun run native:verify --presentation`, and inspect the compilation graph to confirm that no engine or Tint sources are compiled.

The implementation is organized into:

- [Dependency lock manifest](scripts/native/dawn.lock.json) and [dependency retrieval](scripts/native/dependencies.ts): pinned engine artifacts, source revision, and SHA-256 checksums.
- [Command entry point](scripts/native.ts), [generators and accessor patch](scripts/native/generate.ts), and [build orchestration](scripts/native/build.ts): Bun/TypeScript scripts calling upstream tools and CMake.
- [Native CMake target](packages/native/CMakeLists.txt) and [module entry point](packages/native/src/module.cpp): selected sources linked against the downloaded engine, without its full source build.
- [Build audit](scripts/native/build.ts), [runtime verification](scripts/native.ts), and [native presentation check](packages/native/test/presentation.cpp): compilation boundary and runtime checks.
- [Build guide](docs/native-build.md): prerequisites, platform status, dependency updates, and verification commands. The pinned starting release is [v20261026.205545](https://github.com/google/dawn/releases/tag/v20261026.205545), revision `5fbd545292cb7a4a9a275e322abec6007ffe2ae8`.

Downloaded dependencies and generated artifacts are ignored and do not become ordinary tracked ts-dawn source files. Application developers would receive **prebuilt native addons**, rather than needing to build Dawn themselves.

This checkout passes JavaScript compute/readback and fixed-size window presentation checks in Node.js and Bun, plus a separate C++ GLFW/X11/Vulkan presentation check on Linux x64; see the build guide for exact versions and lifetime constraints. The solid-color example was captured and inspected in both runtimes. Other platforms, complete GC/shutdown correctness, and performance remain unverified. The proposed public API and addon distribution still require implementation; broader compatibility and lifecycle validation are required before making release guarantees.
