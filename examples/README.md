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

# The same entry points run directly in either runtime:
bun examples/typegpu/particles.ts
node examples/typegpu/particles.ts
```

Requires Linux x64, X11, and a compatible Vulkan driver, like the rest of the
project. New examples use a resizable 960×640 window, a 120 Hz fixed-update loop,
and a 60 FPS render cap by default. Q or Escape exits. The original solid-color
demo retains its 640×480 size, uncapped scheduler and three-second lifetime
(unless `--frames` is supplied). The input demo retains its 800×500 size and
uses Escape to release capture; Q exits.

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
| | [input](vanilla/input.ts) | Held keys, focus, scrolling and pointer capture; WASD/arrows move, click captures, Escape releases capture |
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

All Three.js scenes support left drag to orbit and the wheel to zoom, using
native ts-dawn input rather than browser controls. Examples generate their assets
locally; they do not fetch models, images or shaders from a network.

## Integration boundaries

- `shared/application.ts` owns native startup, the common options, error handling,
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
  to `WebGPURenderer`. Three.js renders linear color into an owned `bgra8unorm`
  texture, then a WebGPU pass composites it into the native surface, accounting
  for its sRGB format. This extra pass avoids modifying Three.js or native surface
  configuration. The facade only exposes a texture while rendering; native frame
  textures and their views are never retained. Framebuffer dimensions drive the
  output texture, Three.js attachments and camera aspect ratio.
  Three's internal animation bookkeeping is driven by ts-dawn; a temporary `self`
  facade is restored immediately after initialization. Browser image loaders,
  DOM controls, WebXR and arbitrary Three.js plugins are outside these examples.

## Verification

```sh
bun run lint
bun run typecheck
bun test
# On an X11 display, render every entry and require normal completion in both runtimes:
bun run examples:verify
# A software Vulkan driver can also be used with an isolated X11 display:
VK_DRIVER_FILES=/usr/share/vulkan/icd.d/lvp_icd.x86_64.json xvfb-run -d bun run examples:verify
```

The smoke runner requires 12 native frames per entry in both Bun and Node.js,
checks the process result and completion count, and gives each process a 60-second
timeout. It catches initialization, GPU validation, rendering and cleanup errors;
it does not establish visual correctness or performance. Inspect screenshots and
exercise native controls when changing an adapter or scene. The tested package
versions are recorded in the root `bun.lock`; these integrations do not imply
compatibility with every feature of each upstream library.

Validated on Linux x64/X11 with Mesa lavapipe, Node.js 26.7.0 and Bun 1.3.14,
using Three.js 0.187.0, webgpu-utils 2.1.1, TypeGPU 0.12.9 and Rapier 0.21.0.
Every entry completed the bounded render check in both runtimes. Captured Bun
windows were inspected before and after resizing, with native input and pointer
capture exercised. Three.js resize, orbit/zoom and Rapier impulses were also
captured and inspected under Node.js. This is software rendering evidence,
not a hardware performance measurement. Generated evidence is ignored under
`build/examples/`: the render matrix is `verify-final.log`, Bun captures are in
`desktop4/` and `desktop5/`, and Node.js Three.js captures are in `three-node2/`.

The [hardware performance investigation](../docs/example-performance.md) additionally
measured the physics example on Intel in Bun and Node.js. It found much higher
throughput than the software showcase, along with intermittent long waits before
draw callback entry. Consistently smooth hardware presentation remains unverified.

TypeGPU 0.12.9 currently prints an `external-omitted` warning for `in.color` in
the WGSL fragment templates. The generated shaders still receive that varying;
their interpolated output was rendered and inspected. No warning is suppressed.
