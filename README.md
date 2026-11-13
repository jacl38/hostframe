# hostframe

Build native desktop graphics applications in TypeScript with WebGPU, without a
browser or WebView. Hostframe combines Dawn and GLFW to provide windows, input,
and GPU rendering for Node.js and Bun.

The current package is an alpha for Linux x64 with glibc, X11, and Vulkan. Its
native addon requires system graphics libraries and a compatible Vulkan driver;
the current build also requires glibc 2.43 and GLIBCXX 3.4.32. See
[package requirements](docs/packaging.md#consumer-requirements) for details.

## Installation

Hostframe is not yet published on npm. Install a tarball from
[GitHub Releases](docs/github-releases.md#install-a-published-release), or build
one using the [packaging guide](docs/packaging.md#build-and-pack).

## Render a window

Create a window, choose an adapter compatible with its surface, and render using
standard WebGPU commands. The loop ends when the last open window closes.

```ts
import { Application, installWebGPUGlobals } from "hostframe";

// Make WebGPU constructors and constants available globally when needed.
installWebGPUGlobals();

// The application owns the native windows and their presentation surfaces.
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

  // Hostframe selects an adapter compatible with this window's surface.
  const adapter = await context.requestAdapter();
  if(!adapter) throw new Error("No compatible GPU adapter");

  device = await adapter.requestDevice();
  const renderingDevice = device;

  context.configure({
    device: renderingDevice,
    format: app.gpu.getPreferredCanvasFormat()
  });

  // Hostframe acquires a frame before this callback and presents it afterward.
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

  // Poll events and render until the last window closes.
  await app.run();
} finally {
  try {
    // Release the windows and surfaces before destroying the device.
    app.dispose();
  } finally {
    device?.destroy();
  }
}
```

The application owns the window and its presentation surface; the caller owns
the GPU device. Dispose the application before destroying the device. See the
[window context](docs/window-context.md) and [application loop](docs/application-loop.md)
guides for frame lifetime, scheduling, and custom loops.

## Headless WebGPU

Use Dawn without creating a window or connecting to a display:

```ts
import { gpu } from "hostframe";

// Hostframe exposes Dawn's WebGPU entry point without creating a window.
const adapter = await gpu.requestAdapter();
if(!adapter) throw new Error("No compatible GPU adapter");

const device = await adapter.requestDevice();

try {
  // Encode and submit WebGPU commands with the device.
} finally {
  device.destroy();
}
```

Headless access still requires the addon's system libraries and a compatible GPU
backend. WebGPU globals are opt-in; see the [headless and globals guide](docs/guide.md#headless-gpu-access).

## Documentation

- [Window input](docs/window-input.md) — keyboard, pointer, text, and window metrics.
- [Window lifecycle](docs/window-lifecycle.md) — closing, visibility, and resizing.
- [Application loops](docs/application-loop.md) — fixed updates and rendering.
- [Examples](https://github.com/jacl38/ts-dawn/tree/main/examples) — runnable WebGPU and renderer demos.
- [Packaging](docs/packaging.md) and [native builds](docs/native-build.md) — requirements, setup, and verification.
- [Full guide](docs/guide.md) — API overview, implementation, and development.

## License

[Apache-2.0](LICENSE). Third-party notices are included in the package.
