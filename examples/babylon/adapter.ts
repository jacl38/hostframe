import { WebGPUEngine } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import { Application, installWebGPUGlobals, Key } from "../../index.ts";
import { readExampleOptions } from "../shared/options.ts";
import { withBabylonGPU } from "./initialization.ts";

/** Babylon owns the device; Hostframe owns its surfaces and synchronous frame scope. */
export async function createBabylonExample(title: string, options: { width?: number, height?: number, maxFPS?: number } = {}) {
  const { frameLimit, maxFPS, vsync } = readExampleOptions(options.maxFPS);
  installWebGPUGlobals();
  const app = new Application();
  let engine: WebGPUEngine | undefined;
  let bootstrap: GPUTexture | undefined;
  let currentTexture: GPUTexture | undefined;
  let initializing = true;
  let disposed = false;
  let failure: Error | undefined;
  const cleanup: Array<() => void | Promise<void>> = [];
  try {
    const window = app.createWindow({
      title: `hostframe babylon / ${title}`,
      width: options.width ?? 960,
      height: options.height ?? 640,
      resizable: true,
      vsync
    });
    const context = window.getContext("webgpu");
    const format = app.gpu.getPreferredCanvasFormat();
    const canvasContext = {
      configure(configuration: GPUCanvasConfiguration) {
        if(!initializing) throw new Error("Babylon context configuration is restricted to initialization");
        context.configure(configuration);
        bootstrap?.destroy();
        bootstrap = configuration.device.createTexture({
          size: [canvas.width, canvas.height],
          format: configuration.format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
        });
      },
      getCurrentTexture() {
        if(currentTexture) return currentTexture;
        // Babylon submits an initial clear during async initialization. Use an
        // owned texture for that work, never a native frame acquired out of scope.
        if(initializing && bootstrap) return bootstrap;
        throw new Error("Babylon requested a texture outside a Hostframe render event");
      }
    };
    // Browser controls/loaders are deliberately absent. Native input is wired by
    // the example; these hooks only satisfy Babylon's canvas setup and teardown.
    const canvas = {
      width: options.width ?? 960,
      height: options.height ?? 640,
      style: {},
      addEventListener() {},
      removeEventListener() {},
      getContext(kind: string) {
        if(kind !== "webgpu") throw new Error(`Unsupported Babylon context: ${kind}`);
        return canvasContext;
      },
      getBoundingClientRect() {
        return { x: 0, y: 0, left: 0, top: 0, right: this.width, bottom: this.height, width: this.width, height: this.height };
      }
    };
    await withBabylonGPU(context, format, async () => {
      engine = new WebGPUEngine(canvas as unknown as ConstructorParameters<typeof WebGPUEngine>[0], {
        antialias: false,
        stencil: false,
        premultipliedAlpha: false,
        doNotHandleContextLost: true,
        doNotHandleTouchAction: true,
        swapChainFormat: format
      });
      await engine.initAsync();
    });
    initializing = false;
    const renderer = engine!;
    const device = renderer._device;
    device.addEventListener("uncapturederror", event => {
      failure ??= new Error(event.error.message);
      app.stop();
    });
    window.on("key", event => {
      if(event.action === "press" && (event.key === Key.Q || event.key === Key.ESCAPE)) window.requestClose();
    });
    console.log(`babylon / ${title}: Q/Escape quits; resize the window.`);
    return {
      app, window, context, device, engine: renderer,
      defer(callback: () => void | Promise<void>) { cleanup.push(callback); },
      render(scene: Scene) {
        if(disposed) throw new Error("Babylon example is disposed");
        if(scene.getEngine() !== renderer) throw new Error("Scene belongs to another Babylon engine");
        currentTexture = context.getCurrentTexture();
        try {
          renderer.setSize(currentTexture.width, currentTexture.height);
          renderer.beginFrame();
          scene.render();
          renderer.endFrame();
        } finally { currentTexture = undefined; }
      },
      async run() {
        let frames = 0;
        const offCount = window.on("render", () => {
          if(++frames >= (frameLimit ?? Infinity)) app.stop();
        });
        try { await app.run({ updateHz: 120, maxFPS }); } finally { offCount(); }
        await device.queue.onSubmittedWorkDone();
        if(failure) throw failure;
        if(frameLimit !== undefined && frames < frameLimit) throw new Error(`Stopped after ${frames}/${frameLimit} frames`);
        console.log(`Rendered ${frames} frames`);
      },
      dispose
    };
  } catch (error) {
    try { await dispose(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Babylon initialization and cleanup failed");
    }
    throw error;
  }
  async function dispose() {
    if(disposed) return;
    disposed = true;
    const errors: unknown[] = [];
    for(const callback of cleanup.reverse()) {
      try { await callback(); } catch (error) { errors.push(error); }
    }
    // Babylon destroys its device in dispose(). Release native surfaces first,
    // including on failed initialization; run all cleanup even if a step throws.
    try { app.dispose(); } catch (error) { errors.push(error); }
    try { bootstrap?.destroy(); } catch (error) { errors.push(error); }
    try { engine?.dispose(); } catch (error) { errors.push(error); }
    if(errors.length) throw new AggregateError(errors, "Babylon example cleanup failed");
  }
}
