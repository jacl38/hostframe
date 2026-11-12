import { gpu as headlessGPU, Application, Key, Modifier, PointerButton } from "hostframe";
import type { InputEvent, InputState, PresentMode, Window, WindowOptions, WindowGPUContext, WindowEvents } from "hostframe";

// Compiled in a clean consumer without Bun or Node ambient types.
// @webgpu/types uses DOM base types even when the runtime is native.
export function usePublicAPI(app: Application, device: GPUDevice) {
  const sharedGPU: GPU = headlessGPU;
  void sharedGPU;
  const options = { width: 320, height: 240, vsync: true } satisfies WindowOptions;
  const window: Window = app.createWindow(options);
  const state: InputState = window.input;
  const gpu: GPU = app.gpu;
  window.on("key", event => {
    const input: InputEvent = event;
    const key: number = input.key;
    void key;
  });
  const context: WindowGPUContext = window.getContext("webgpu");
  const adapter: Promise<GPUAdapter | null> = context.requestAdapter({ powerPreference: "high-performance" });
  context.configure({ device, format: gpu.getPreferredCanvasFormat() });
  const drew: boolean = context.draw(() => {
    const texture: GPUTexture = context.getCurrentTexture();
    void texture;
    return undefined;
  });
  const mode: PresentMode = window.presentMode;
  window.on("render", event => {
    const renderEvent: WindowEvents["render"] = event;
    const gpuTexture: GPUTexture = context.getCurrentTexture();
    void [gpuTexture, renderEvent];
  });
  void adapter;
  app.on("fixedUpdate", event => { void event.dt; });
  // @ts-expect-error Device-first construction is not part of the API.
  app.createWindow(device, options);
  // @ts-expect-error Window rendering has no callback drawing entry point.
  window.draw(() => {});
  // @ts-expect-error Rendering belongs to the window.
  app.on("render", () => {});
  // @ts-expect-error Unknown event names must remain rejected after declaration bundling.
  window.on("invalid", () => {});
  // @ts-expect-error Options must retain their native field types.
  app.createWindow({ width: "320" });
  // @ts-expect-error Window render listeners must remain synchronous.
  window.on("render", async () => {});
  // @ts-expect-error Native surface selection must not extend the standard GPU options.
  gpu.requestAdapter({ compatibleSurface: context });
  // @ts-expect-error The context accepts only standard adapter options.
  context.requestAdapter({ compatibleSurface: context });
  // @ts-expect-error Configuration requires a standard GPUDevice.
  context.configure({ device: {}, format: "bgra8unorm" });
  // @ts-expect-error Application-owned input dispatch is not part of the public API.
  window.dispatchInput();
  // @ts-expect-error Application-owned render dispatch is not part of the public API.
  window.dispatchRender({ alpha: 0, droppedTime: 0, frameTime: 0, frame: 1 }, () => true);
  // @ts-expect-error draw is the supported frame API; the internal renderer is hidden.
  context.render(() => undefined);
  // @ts-expect-error Context cache cleanup is owned by Window disposal.
  context.release();
  // @ts-expect-error Manual draw callbacks must remain synchronous.
  context.draw(async () => {});
  return { drew, mode, state, gpu, key: Key.W, button: PointerButton.LEFT, modifier: Modifier.SHIFT };
}

function metricsContract(window: import("hostframe").Window) {
  const metrics: import("hostframe").WindowMetrics = window.metrics;
  window.on("metrics", event => { void event.metrics.framebufferWidth; });
  const pixel: { x: number, y: number } | undefined = window.toFramebuffer(1, 2);
  // @ts-expect-error Snapshots are immutable.
  metrics.width = 10;
  // @ts-expect-error Metrics listeners must remain synchronous.
  window.on("metrics", async () => {});
  void pixel;
}
void metricsContract;

function lifecycleContract(window: import("hostframe").Window) {
  const status: import("hostframe").WindowStatus = window.status;
  window.setTitle("Editor");
  window.setSize(800, 600);
  window.setPosition(-100, 200);
  window.setVisible(false);
  window.on("closeRequest", event => {
    const request: import("hostframe").CloseRequestEvent = event;
    request.preventDefault();
    const canceled: boolean = request.defaultPrevented;
    void canceled;
    // @ts-expect-error Cancellation is controlled by preventDefault.
    request.defaultPrevented = false;
  });
  window.on("minimize", event => { const type: "minimize" = event.type; void type; });
  window.on("restore", event => { const type: "restore" = event.type; void type; });
  // @ts-expect-error Status snapshots are immutable.
  status.visible = true;
  // @ts-expect-error Lifecycle listeners must remain synchronous.
  window.on("closeRequest", async () => {});
  // @ts-expect-error Visibility accepts only booleans.
  window.setVisible("yes");
  // @ts-expect-error Fullscreen remains deferred.
  window.setFullscreen(true);
}
void lifecycleContract;
