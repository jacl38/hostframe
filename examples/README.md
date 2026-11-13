# Examples

Examples are grouped by their rendering source. `vanilla/` uses WebGPU directly
and imports no external libraries. Rapier is an optional simulation dependency,
demonstrated with Three.js; its simulation lives in `shared/physics.ts` and has
no renderer dependency.

## Run

From the repository root, after `bun install` and `bun run setup`:

```sh
bun run example --list
bun run example vanilla/cubes
bun run example three/shadows
bun run example babylon/cubes
bun run example vgpu/gradient

# The same entry points run directly in either runtime:
bun examples/typegpu/particles.ts
node examples/typegpu/particles.ts
```

Requires Linux x64, X11, and a compatible Vulkan driver, like the rest of the
project. Examples use a resizable 960×640 window, a 120 Hz fixed-update loop,
and a 60 FPS render cap by default. Q or Escape exits. The original solid-color
demo retains its 640×480 size, uncapped scheduler and three-second lifetime
(unless `--frames` is supplied). The input demo retains its 800×500 size and
uses Escape to release capture; Q exits. The three polished studies below use 1200×800 windows.

All entries accept:

```sh
bun run example vanilla/cubes --frames=120 --max-fps=30
node examples/three/materials.ts --no-vsync --max-fps=144
```

`--frames` counts submitted native frames, including the final composition pass
for Three.js. `--no-vsync` requests Immediate/Mailbox presentation and fails
explicitly if unsupported. The scheduler cap and presentation mode are separate.

## Gallery

| Source | Entry | Demonstrates |
| --- | --- | --- |
| Vanilla WebGPU | [solid-color](vanilla/solid-color.ts) | Surface acquisition, clear, submit, present, disposal |
| | [multiple-windows](vanilla/multiple-windows.ts) | Two sizes and contexts sharing one device; click dims only that window, Q/Escape closes it, final close exits |
| | [window-lifecycle](vanilla/window-lifecycle.ts) | Native unsaved-work close prompt; S saves, C cancels, R resizes, P moves, H hides briefly; Q/Escape force-close |
| | [input](vanilla/input.ts) | Held keys, Unicode text input, focus, scrolling and pointer capture; WASD/arrows move, click captures, Escape releases capture |
| | [triangle](vanilla/triangle.ts) | WGSL vertex/fragment stages and interpolated vertex colors |
| | [cubes](vanilla/cubes.ts) | Vertex buffers, uniforms, depth attachments, instanced drawing and animated transforms |
| | [particles](vanilla/particles.ts) | A compute shader updates 4096 particles; a render pass reads the storage buffer |
| webgpu-utils | [cubes](webgpu-utils/cubes.ts) | Generated cube geometry, buffer layouts, WGSL-derived uniform packing and 80 instances |
| | [textures](webgpu-utils/textures.ts) | Typed pixel upload, generated mipmaps, repeat addressing and trilinear filtering |
| TypeGPU | [triangle](typegpu/triangle.ts) | Typed shader interfaces and a render pipeline targeting a native texture view |
| | [particles](typegpu/particles.ts) | Typed buffers and bind groups shared between compute and rendering; 2048 particles |
| Three.js | [materials](three/materials.ts) | Standard materials with rows of increasing metalness and columns of increasing roughness |
| | [shadows](three/shadows.ts) | Directional shadow maps, a rotating torus knot and a receiving floor |
| | [instancing](three/instancing.ts) | 1600 meshes in an animated wave with per-instance transforms and colors |
| | [physics](three/physics.ts) | Rapier WASM rigid bodies, fixed simulation steps and position/quaternion interpolation; Space scatters boxes |
| | [cornell-box](three/cornell-box.ts) | Path-traced Cornell Box, colored bounce light, area-light shadows, glass transmission and offline OIDN denoising |
| | [kinetic](three/kinetic.ts) | 64 beveled copper leaves, three choreographies, environment reflections and real-time shadow maps |
| | [flow](three/flow.ts) | 65,536 GPU-computed streamline particles, smooth winding morphs, three palettes and HDR bloom |
| Babylon.js | [cubes](babylon/cubes.ts) | Instanced cubes, lit materials, shadows, native orbit/zoom and pause |
| vgpu | [gradient](vgpu/gradient.ts) | Prepared WGSL effect, uniform updates, explicit frames, resize and borrowed-device cleanup |

All Three.js scenes support left drag to orbit and the wheel to zoom, using
native hostframe input rather than browser controls. Examples generate their assets
locally; they do not fetch models, images or shaders from a network.

## Polished studies

```sh
bun run example three/cornell-box
bun run example three/kinetic
bun run example three/flow
```

All three have native orbit/zoom and vector on-screen labels. Cornell Box traces
six-bounce paths at 75% of the framebuffer dimensions, accumulates 24 samples per
pixel, then runs the locally bundled Open Image Denoise small HDR network on the
same GPU device. Moving the camera, changing a material or resizing restarts the
render. It is a progressive still-life renderer; convergence time depends on the
GPU. Its denoised image is an approximation, and raw mode continues accumulation.
The red/green walls, two blocks and glass sphere are illuminated by one ceiling
area light with no environment lighting. B compares one bounce with six to
expose the contribution of indirect illumination.

| Study | Controls beyond orbit/zoom and Q/Escape |
| --- | --- |
| Cornell Box | B compares one/six bounces; 1/2/3 selects matte/chrome/brass; P toggles raster preview; D toggles clean/raw; R resets accumulation |
| Copper in motion | Space holds/resumes; M cycles breathe, travelling wave and bloom |
| Slow current | Space holds/resumes flow; C changes palette; M morphs the winding |

Cornell Box uses pinned `three-gpu-pathtracer` 0.0.27 with its megakernel
backend, following Three's upstream WebGPU example. Its wavefront backend emits
invalid runtime-array WGSL with the current Three version. The backend selector
is checked at runtime because the package omits it from its TypeScript
declarations. OIDN 0.4.0's bundled ESM entry is loaded so Node can resolve it;
its unbundled entry contains extensionless imports. `shader-f16` is requested
when available, with OIDN's FP32 path used otherwise. Font/model provenance and
licenses are in [showcase/assets](three/showcase/assets/README.md).

Hardware capture uses an isolated KWin/Xwayland session and requires KWin,
Xwayland, D-Bus, xdotool, ImageMagick and FFmpeg with x11grab/libx264rgb. For each
study, run (substitute `flow` or `cornell-box`):

```sh
bun scripts/benchmarks/display.ts bun scripts/examples/capture.ts kinetic
# Allow time for both cornell-box convergence sequences on an integrated GPU:
HOSTFRAME_DISPLAY_TIMEOUT_MS=180000 bun scripts/benchmarks/display.ts bun scripts/examples/capture.ts cornell-box
# Exercise controls, resize and minimize/restore in either runtime:
bun scripts/benchmarks/display.ts bun scripts/examples/capture.ts kinetic node verify
```

The display launcher defaults to this host's Intel Vulkan ICD; override
`VK_DRIVER_FILES` and `HOSTFRAME_EXPECT_VENDOR` on other hardware. Captures reject
software fallback. If a Node version-manager shim tries to provision a different
release, put the installed Node binary's directory first on PATH.

Each recording directory contains a default screenshot, an after-interaction
screenshot, lossless 60 Hz footage, input/frame timing evidence and process logs.
The Cornell Box recording starts after denoising, demonstrates responsive raster
orbiting, then shows path tracing converge again. Encoded frame rate describes
the screen capture; it does not imply 60 path-traced samples per second.

Finish three recording directories (in cornell-box, kinetic, flow order) with
`bun scripts/examples/finish-captures.ts <cornell-box-directory> <kinetic-directory> <flow-directory>`.
This creates H.264 clips, a combined film, screenshots, a contact sheet and
encoding/timing validation under `build/examples/polished/final/`. Existing
videos are protected from overwrite.

## Babylon cubes

```sh
bun run example babylon/cubes
node examples/babylon/cubes.ts --frames=120 --max-fps=30
```

Eight animated cube instances and a lit sphere cast shadows onto a floor.
Left drag orbits, the wheel zooms, Space pauses animation, and Q/Escape exits.
The scene uses locally generated geometry and Babylon's built-in WGSL materials;
no assets or shader compilers are downloaded. Babylon is pinned to 9.36.0.
DOM controls, GUI, browser image/video loaders, audio, WebXR and automatic
device-loss recovery are outside this example.

## vgpu gradient

```sh
bun run example vgpu/gradient
node examples/vgpu/gradient.ts --frames=120 --max-fps=30
```

A small animated gradient uses a prepared WGSL effect and uniform updates.
Space pauses animation; Q/Escape exits. vgpu and `@vgpu/wgsl` are pinned to
0.6.0. Shader preparation runs directly in TypeScript, without a bundler loader.

## Integration boundaries

- `shared/options.ts` owns renderer-example command-line parsing.
  `shared/application.ts` owns native startup, error handling,
  frame limits and cleanup. Renderer setup and example scene logic remain separate.
  Deferred cleanups run in reverse order, then the application closes its surface,
  then the caller-owned device is destroyed. Initializing an adapter can be async;
  all native draw callbacks and GPU submissions remain synchronous.
- `shared/depth-texture.ts` owns depth attachments and recreates them when the
  acquired framebuffer dimensions change.
- `webgpu-utils/adapter.ts` derives uniform layouts from WGSL. Texture examples
  use typed pixels; the library's browser image-loading helpers are not adapted.
- `typegpu/adapter.ts` uses `tgpu.initFromDevice`. Shader bodies are WGSL strings
  with typed TypeGPU interfaces, so direct Node.js/Bun execution needs no shader
  transform or bundler. TypeGPU resources are explicitly destroyed before its root;
  the borrowed device remains owned by the native example.
- `three/adapter.ts` supplies a small canvas/context facade and an existing device
  to `WebGPURenderer`. Three.js renders linear color into an owned `rgba16float`
  texture, then a WebGPU pass composites it into the native surface, accounting
  for its sRGB format. Half floats preserve dark gradients before presentation.
  This extra pass avoids modifying Three.js or native surface
  configuration. The facade only exposes a texture while rendering; native frame
  textures and their views are never retained. Framebuffer dimensions drive the
  output texture, Three.js attachments and camera aspect ratio.
  Three's internal animation bookkeeping is driven by hostframe; a temporary `self`
  facade is restored immediately after initialization. Browser image loaders,
  DOM controls, WebXR and arbitrary Three.js plugins are outside these examples.
- `babylon/adapter.ts` owns Babylon's initialization and distinct device lifecycle.
  A temporary `navigator.gpu` facade routes adapter requests through the native
  window surface; Babylon creates and owns the device. The pinned Dawn binding
  omits `GPUSupportedFeatures.forEach()`, so initialization uses an adapter feature
  Set and temporarily shadows only the new device's feature getter with a Set.
  The original getter and navigator descriptor are restored in `finally`, including
  failed initialization. Native prototypes are never modified.
  Babylon's eager initialization clear uses an owned bootstrap texture. After
  initialization, texture access is restricted to synchronous native render events.
  Acquired framebuffer dimensions drive Babylon's attachments; rendering submits
  directly to the native frame without a composition pass. Scene/deferred resources
  are cleaned first, Hostframe releases its surfaces next, then Babylon disposes
  its device. Cleanup continues after a deferred cleanup throws and is idempotent.
- `vgpu/adapter.ts` borrows the Hostframe device with `initFromDevice()` and
  wraps the native context in a canvas-sized surface. Explicit `frame()` calls
  submit synchronously inside native render events; acquired framebuffer sizes
  drive the surface and shader uniforms. `run()` waits for vgpu's settled error
  delivery as well as native work completion. vgpu releases its wrapper/surface
  before Hostframe closes the application and destroys the caller-owned device.
  No DOM globals or feature shims are required for this adapter.

## Verification

```sh
bun run lint
bun run typecheck
bun test
# On an X11 display, render every entry and require normal completion in both runtimes:
bun run examples:verify
# A software Vulkan driver can also be used with an isolated X11 display:
VK_DRIVER_FILES=/usr/share/vulkan/icd.d/lvp_icd.x86_64.json bun scripts/validation/desktop.ts bun scripts/examples.ts --verify
```

The smoke runner requires 12 native frames per entry in both Bun and Node.js,
checks the process result and completion count, and gives each process a 60-second
timeout. It catches initialization, GPU validation, rendering and cleanup errors;
it does not establish visual correctness or performance. Inspect screenshots and
exercise native controls when changing an adapter or scene. The tested package
versions are recorded in the root `bun.lock`; these integrations do not imply
compatibility with every feature of each upstream library.

The original 13 entries were validated on Linux x64/X11 with Mesa lavapipe,
Node.js 26.7.0 and Bun 1.3.14,
using Three.js 0.187.0, webgpu-utils 2.1.1, TypeGPU 0.12.9 and Rapier 0.21.0.
Each original entry completed the bounded render check in both runtimes. Captured Bun
windows were inspected before and after resizing, with native input and pointer
capture exercised. Three.js resize, orbit/zoom and Rapier impulses were also
captured and inspected under Node.js. This is software rendering evidence,
not a hardware performance measurement. Generated evidence is ignored under
`build/examples/`: the render matrix is `verify-final.log`, Bun captures are in
`desktop4/` and `desktop5/`, and Node.js Three.js captures are in `three-node2/`.

The full 16-entry gallery subsequently passed the bounded render check in both
runtimes on Intel Alder Lake-N/Vulkan through an isolated KWin/Xwayland display.
The polished studies were captured at 1200×800 on that hardware. Sculpture and
flow controls, resize and minimize/restore were exercised in Bun and Node;
Cornell Box denoising and orbit/preview were exercised in Bun, with its material,
bounce, raw/clean, resize and minimize/restore controls also exercised in Node.
The custom composition callback rejected an async result and then rendered a
subsequent frame successfully. Lint, typecheck and all 36 existing tests passed.

The final screenshots, three H.264/60 FPS clips and 92-second combined film are
under `build/examples/polished/final/`. All clips and the combined film decoded
without errors; representative video frames and screenshots were inspected.
`validation.json` records encoding counts and observed native callback timing;
the capture rate is separate from application throughput and path-tracing
convergence. The pinned tracer prints upstream Source and iridescence property
deprecation warnings with Three r187; no warnings are suppressed. Other operating
systems and physical-monitor pacing were not verified.

The [hardware performance investigation](../docs/example-performance.md) additionally
measured the physics example on Intel in Bun and Node.js and traced recurring
presentation stalls to a KDE service cache shared by the private compositor and
desktop. Isolating the compositor's cache removed those recurring stalls. The
showcase clips under `build/examples/showcase/clips/` were subsequently re-recorded
on Intel at 60 FPS, with frame timing and encoded frame counts checked. Physical
monitor scanout pacing remains unmeasured.

TypeGPU 0.12.9 currently prints an `external-omitted` warning for `in.color` in
the WGSL fragment templates. The generated shaders still receive that varying;
their interpolated output was rendered and inspected. No warning is suppressed.

Use `bun run test:system` for Hostframe contracts and representative library integrations.
The legacy `--verify --representative` option runs only the adapter portion of that
suite and requires X11/xdotool, including for Three resize checks. Full-gallery
verification maintains examples; it is not WebGPU feature coverage. See
[continuous validation](../docs/continuous-validation.md).

The Babylon adapter has a focused system fixture in
`scripts/validation/babylon-output.ts`: initialization isolation (including
rejection after device creation), frame scope, red/green output after three
native sizes, normal/repeated disposal and cleanup failure handling. This checks
Hostframe integration, not Babylon shader correctness.

The simplified Babylon cubes scene passed bounded rendering, native pause/resume,
orbit/zoom, resizing and Q-to-close in Node 26.7.0 and Bun 1.3.14 on Linux
x64/X11/lavapipe. Captures were inspected; the adapter's output, initialization
isolation and cleanup-failure checks passed in both runtimes. Evidence is under
`build/validation/desktop-A1xNX2/` and `build/babylon-smoke/cubes-*`.
Hardware presentation and macOS remain unverified for this integration.

The vgpu gradient and `scripts/validation/vgpu-output.ts` passed in Node 26.7.0
and Bun 1.3.14 on Linux x64/X11/lavapipe. The fixture checks native frame scope,
output and uniform updates after resizing, and device survival after vgpu wrapper
disposal before final Hostframe cleanup. The gradient's pause/resume, resize and
Q exit were exercised, and captures were inspected. Hardware presentation and
macOS remain unverified. Local evidence is under `build/vgpu-smoke/gradient-*`
and `build/validation/desktop-6z4J9L/`.
