import { Application, Key } from "../../index.ts";

/** Shared native lifetime only; renderer integration belongs to each source's adapter. */
export async function createExample(title: string, options: {
  width?: number,
  height?: number,
  maxFPS?: number,
  escapeQuits?: boolean
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
    const adapter = await app.gpu.requestAdapter();
    if(!adapter) throw new Error("No compatible GPU adapter");
    device = await adapter.requestDevice();
    const renderingDevice = device;
    device.onuncapturederror = event => {
      failure ??= new Error(event.error.message);
      app.stop();
    };
    const window = app.createWindow(device, {
      title: `ts-dawn ${title}`,
      width: defaults.width,
      height: defaults.height,
      resizable: true,
      vsync: !args.includes("--no-vsync")
    });
    let quit = false;
    window.on("key", event => {
      if(event.action === "press" && ((defaults.escapeQuits && event.key === Key.ESCAPE) || event.key === Key.Q)) quit = true;
    });
    app.on("fixedUpdate", () => { if(quit) app.stop(); });
    console.log(`${title}: Q${defaults.escapeQuits ? "/Escape" : ""} quits; resize the window. Adapter: ${adapter.info.device}`);
    return {
      app,
      device,
      window,
      defer(callback: () => void | Promise<void>) { cleanup.push(callback); },
      /** The callback and all GPU submission must finish before the surface expires. */
      draw(callback: (texture: GPUTexture) => undefined) {
        window.draw(texture => {
          const result = callback(texture);
          frames++;
          if(frameLimit !== undefined && frames >= frameLimit) app.stop();
          // Preserve the native runtime rejection of accidentally async callbacks.
          return result;
        });
      },
      async run() {
        await app.run({ updateHz: 120, maxFPS });
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
