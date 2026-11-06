import { Application, Key } from "../../index.ts";

/** Shared native lifetime only; renderer integration belongs to each source's adapter. */
export async function createExample(title: string, options: {
  width?: number,
  height?: number,
  maxFPS?: number,
  escapeQuits?: boolean,
  optionalFeatures?: GPUFeatureName[]
} = {}) {
  const defaults = { width: 960, height: 640, maxFPS: 60, escapeQuits: true, ...options };
  const args = process.argv.slice(2);
  if(args.some(arg => arg !== "--no-vsync" && !/^--(frames|max-fps)=/.test(arg))) {
    throw new Error("Options: [--frames=<positive integer>] [--max-fps=<positive number>] [--no-vsync]");
  }
  function option(name: string) {
    const argument = args.find(arg => arg.startsWith(`--${name}=`));
    if(argument === undefined) return undefined;
    const value = Number(argument.slice(name.length + 3));
    if(!Number.isFinite(value) || value <= 0 || (name === "frames" && !Number.isSafeInteger(value))) {
      throw new Error(`--${name} must be a positive ${name === "frames" ? "integer" : "number"}`);
    }
    return value;
  }
  const frameLimit = option("frames");
  const maxFPS = option("max-fps") ?? defaults.maxFPS;
  const app = new Application();
  let device: GPUDevice | undefined;
  const cleanup: Array<() => void | Promise<void>> = [];
  let disposed = false;
  let failure: unknown;
  let frames = 0;
  try {
    const window = app.createWindow({
      title: `hostframe ${title}`,
      width: defaults.width,
      height: defaults.height,
      resizable: true,
      vsync: !args.includes("--no-vsync")
    });
    const context = window.getContext("webgpu");
    const adapter = await context.requestAdapter();
    if(!adapter) throw new Error("No compatible GPU adapter");
    const requiredFeatures = defaults.optionalFeatures?.filter(feature => adapter.features.has(feature));
    device = await adapter.requestDevice({ requiredFeatures });
    const renderingDevice = device;
    device.onuncapturederror = event => {
      failure ??= new Error(event.error.message);
      app.stop();
    };
    context.configure({ device, format: app.gpu.getPreferredCanvasFormat() });
    window.on("key", event => {
      if(event.action === "press" && ((defaults.escapeQuits && event.key === Key.ESCAPE) || event.key === Key.Q)) window.requestClose();
    });
    console.log(`${title}: Q${defaults.escapeQuits ? "/Escape" : ""} quits; resize the window. Adapter: ${adapter.info.device}`);
    return {
      app,
      device,
      window,
      context,
      defer(callback: () => void | Promise<void>) { cleanup.push(callback); },
      async run() {
        const offCount = window.on("render", () => {
          frames++;
          if(frameLimit !== undefined && frames >= frameLimit) app.stop();
        });
        try {
          await app.run({ updateHz: 120, maxFPS });
        } finally {
          offCount();
        }
        await renderingDevice.queue.onSubmittedWorkDone();
        if(failure) throw failure;
        if(frameLimit !== undefined && frames < frameLimit) throw new Error(`Stopped after ${frames}/${frameLimit} frames`);
        console.log(`Rendered ${frames} frames`);
      },
      async dispose() {
        if(disposed) return;
        disposed = true;
        // Run every cleanup, even after a partially initialized renderer fails.
        const errors: unknown[] = [];
        for(const callback of cleanup.reverse()) {
          try { await callback(); } catch (error) { errors.push(error); }
        }
        try { app.dispose(); } catch (error) { errors.push(error); }
        renderingDevice.destroy();
        if(errors.length) throw new AggregateError(errors, "Example cleanup failed");
      }
    };
  } catch (error) {
    try { app.dispose(); } finally { device?.destroy(); }
    throw error;
  }
}

export type Example = Awaited<ReturnType<typeof createExample>>;
