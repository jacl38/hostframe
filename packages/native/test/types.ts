import type * as Native from "../../../build/native/generated/native";
import type { Application, WindowOptions, WindowGPUContext, WindowEvents } from "../../../index.ts";
import { Key, Modifier, PointerButton } from "../../../index.ts";

function inputConstantContracts() {
  const zero: 48 = Key.ZERO;
  const shift: 340 = Key.LEFT_SHIFT;
  const keypadZero: 320 = Key.KP_0;
  const left: 0 = PointerButton.LEFT;
  const first: typeof left = PointerButton.ONE;
  const modifier: 1 = Modifier.SHIFT;
  void [zero, shift, keypadZero, first, modifier];
  // @ts-expect-error GLFW suffixes retain their original spelling.
  void Key.LeftShift;
  // @ts-expect-error Standalone digits use word names.
  void Key.Digit0;
  // @ts-expect-error LAST is a sentinel, not another key.
  void Key.LAST;
}
void inputConstantContracts;

// Compiled by the required typecheck; these contracts must be generated without
// widening WebGPU objects, synchronous returns, discriminants or readonly fields.
function nativeContracts(app: Native.Application, gpu: GPU, device: GPUDevice) {
  const options: WindowOptions = { width: 640, resizable: true, vsync: false };
  const window = app.createWindow(gpu, options);
  app.createWindow(gpu);
  app.createWindow(gpu, undefined);
  window.configure({ device, format: gpu.getPreferredCanvasFormat() });
  window.renderFrame(texture => {
    const gpuTexture: GPUTexture = texture;
    gpuTexture.createView();
  });
  // @ts-expect-error The transport requires a GPU owner, not a device.
  app.createWindow(device);
  // @ts-expect-error Internal frame callbacks must return undefined synchronously.
  window.renderFrame(async () => {});
  // @ts-expect-error Arbitrary callback results are forbidden.
  window.renderFrame(() => 1);
  // @ts-expect-error Native state properties remain read-only.
  window.disposed = false;
  window.dispatchInput((state, events) => {
    // @ts-expect-error Snapshot arrays remain read-only.
    state.keys.push(1);
    // @ts-expect-error Input callbacks must see immutable state.
    state.focused = true;
    for(const event of events) {
      const nativeEvent: Native.InputEvent = event;
      if(nativeEvent.type === "key") {
        const key: number = nativeEvent.key;
        void key;
        // @ts-expect-error Discriminated input events must not widen to arbitrary objects.
        void nativeEvent.deltaX;
      }
    }
  });
  // @ts-expect-error Input callbacks must be synchronous too.
  window.dispatchInput(async () => {});
}
void nativeContracts;

function contextContracts(app: Application, device: GPUDevice) {
  const window = app.createWindow({ title: "Context types", resizable: true });
  const context: WindowGPUContext = window.getContext("webgpu");
  const adapter: Promise<GPUAdapter | null> = context.requestAdapter({ powerPreference: "low-power" });
  context.configure({ device, format: app.gpu.getPreferredCanvasFormat() });
  const configuration: GPUCanvasConfiguration | null = context.getConfiguration();
  window.on("render", event => {
    const render: WindowEvents["render"] = event;
    const texture: GPUTexture = context.getCurrentTexture();
    void [render, texture];
  });
  window.on("key", event => {
    const key: WindowEvents["key"] = event;
    if(key.action === "press") window.setPointerCapture(true, false);
    if(key.key === Key.Q) window.requestClose();
    // @ts-expect-error Event maps keep each callback's specific event shape.
    void event.deltaX;
  });
  window.on("text", event => {
    const codepoint: number = event.codepoint;
    const text: string = String.fromCodePoint(codepoint);
    void text;
    // @ts-expect-error Text events do not expose physical key tokens.
    void event.key;
  });
  // @ts-expect-error Shared subscription mechanics do not expose public emission.
  window.emit("key", {});
  // @ts-expect-error Applications do not expose public emission either.
  app.emit("fixedUpdate", {});
  // @ts-expect-error Input action arguments remain booleans.
  window.setPointerCapture("capture");
  // @ts-expect-error Window creation accepts options, not a device.
  app.createWindow(device);
  // @ts-expect-error Device-first construction has no overload.
  app.createWindow(device, {});
  // @ts-expect-error Rendering belongs to windows.
  app.on("render", () => {});
  // @ts-expect-error The callback drawing API is not public.
  window.draw(() => {});
  // @ts-expect-error Only WebGPU contexts are supported.
  window.getContext("2d");
  // @ts-expect-error Render callbacks cannot be asynchronous.
  window.on("render", async () => {});
  // @ts-expect-error Render callbacks cannot return arbitrary values.
  window.on("render", () => 1);
  // @ts-expect-error Native selection must not modify the standard GPU interface.
  app.gpu.requestAdapter({ compatibleSurface: context });
  // @ts-expect-error The surface is supplied by the receiver, not an option.
  context.requestAdapter({ compatibleSurface: context });
  // @ts-expect-error Configurations require a device and format.
  context.configure({ device });
  void [adapter, configuration];
}
void contextContracts;

function metricsContract(window: import("../../../index.ts").Window) {
  const metrics: import("../../../index.ts").WindowMetrics = window.metrics;
  window.on("metrics", event => { void event.metrics.framebufferWidth; });
  const pixel: { x: number, y: number } | undefined = window.toFramebuffer(1, 2);
  // @ts-expect-error Snapshots are immutable.
  metrics.width = 10;
  // @ts-expect-error Metrics listeners must remain synchronous.
  window.on("metrics", async () => {});
  void pixel;
}
void metricsContract;

function lifecycleContract(window: import("../../../index.ts").Window) {
  const status: import("../../../index.ts").WindowStatus = window.status;
  window.setTitle("Editor");
  window.setSize(800, 600);
  window.setPosition(-100, 200);
  window.setVisible(false);
  window.on("closeRequest", event => {
    const request: import("../../../index.ts").CloseRequestEvent = event;
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
