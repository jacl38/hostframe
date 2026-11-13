import { frame, initFromDevice, surface } from "vgpu";
import type { Effect } from "vgpu";
import { createExample } from "../shared/application.ts";

/** vgpu borrows the Hostframe device and submits only inside native render events. */
export async function createVgpuExample(title: string, options: Parameters<typeof createExample>[1] = {}) {
  const example = await createExample(`vgpu / ${title}`, options);
  try {
    const gpu = await initFromDevice(example.device);
    example.defer(() => gpu.dispose());
    let failure: unknown;
    gpu.onError(error => {
      failure ??= error;
      example.app.stop();
    });
    const canvas = {
      width: example.window.metrics.framebufferWidth,
      height: example.window.metrics.framebufferHeight,
      getContext(kind: string) {
        if(kind !== "webgpu") throw new Error(`Unsupported vgpu context: ${kind}`);
        return example.context;
      }
    };
    const output = surface(gpu, canvas as unknown as Parameters<typeof surface>[1], {
      autoResize: false,
      format: example.app.gpu.getPreferredCanvasFormat(),
      alphaMode: "opaque"
    });
    async function settled() {
      await gpu.settled();
      if(failure !== undefined) throw failure;
    }
    return {
      ...example,
      gpu,
      output,
      settled,
      render(shader: Effect) {
        const texture = example.context.getCurrentTexture();
        output.resize([texture.width, texture.height]);
        frame(gpu, current => { current.pass(output, shader); });
      },
      async run() {
        await example.run();
        // vgpu delivers captured validation errors through its own asynchronous
        // channel. Native uncaptured-error handling alone cannot observe those.
        await settled();
      }
    };
  } catch (error) {
    try { await example.dispose(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "vgpu initialization and cleanup failed");
    }
    throw error;
  }
}
