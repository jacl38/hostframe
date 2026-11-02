import { HalfFloatType, LinearSRGBColorSpace, WebGPURenderer } from "three/webgpu";
import type { PerspectiveCamera, Scene } from "three/webgpu";
import { createExample } from "../shared/application.ts";

/** A frame-scoped canvas facade. GLFW owns configuration, acquisition and presentation. */
export async function createThreeExample(title: string, options: Parameters<typeof createExample>[1] = {}) {
  const example = await createExample(`three / ${title}`, options);
  try {
    let currentTexture: GPUTexture | undefined;
    const canvas = { width: options.width ?? 960, height: options.height ?? 640 };
    let output = example.device.createTexture({
      size: [canvas.width, canvas.height], format: "rgba16float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
    });
    example.defer(() => output.destroy());
    let blit: GPURenderPipeline | undefined;
    const context = {
      configure(configuration: GPUCanvasConfiguration) {
        if(configuration.device !== example.device || configuration.format !== "rgba16float") {
          throw new Error("The Three.js adapter requires the native device and rgba16float output");
        }
      },
      getCurrentTexture() {
        if(!currentTexture) throw new Error("Three.js requested a surface texture outside draw()");
        return currentTexture;
      }
    };
    // Three's types describe a DOM canvas/context. Only dimensions, configure and
    // getCurrentTexture are used here; browser controls and image loaders are not supplied.
    const renderer = new WebGPURenderer({
      device: example.device,
      canvas: canvas as unknown as NonNullable<ConstructorParameters<typeof WebGPURenderer>[0]>["canvas"],
      context,
      outputType: HalfFloatType,
      antialias: true
    });
    example.defer(() => renderer.dispose());
    // Keep linear color in half floats to preserve dark gradients. The native sRGB target
    // performs the output transfer once during composition.
    renderer.outputColorSpace = LinearSRGBColorSpace;
    // Three captures self during init for its internal frame bookkeeping. Feed that
    // scheduler from ts-dawn, with no extra timer loop and no persistent global shim.
    let nextFrame: ((time: number) => void) | undefined;
    const previousSelf = Object.getOwnPropertyDescriptor(globalThis, "self");
    try {
      Object.defineProperty(globalThis, "self", { configurable: true, value: {
        requestAnimationFrame(callback: (time: number) => void) { nextFrame = callback; return 1; },
        cancelAnimationFrame() { nextFrame = undefined; }
      } });
      await renderer.init();
    } finally {
      if(previousSelf) Object.defineProperty(globalThis, "self", previousSelf);
      else Reflect.deleteProperty(globalThis, "self");
    }
    renderer.onError = error => { throw new Error(error); };
    return {
      ...example,
      renderer,
      // Custom rendering stays inside the same acquisition/composition scope.
      // This supports progressive tracers, post-processing and native HUDs.
      render(scene: Scene, camera: PerspectiveCamera, draw?: () => undefined) {
        example.draw(texture => {
          if(output.width !== texture.width || output.height !== texture.height) {
            output.destroy();
            output = example.device.createTexture({
              size: [texture.width, texture.height], format: "rgba16float",
              usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
            });
          }
          currentTexture = output;
          try {
            if(canvas.width !== texture.width || canvas.height !== texture.height) {
              renderer.setSize(texture.width, texture.height, false);
            }
            camera.aspect = texture.width / texture.height;
            camera.updateProjectionMatrix();
            nextFrame?.(performance.now());
            if(draw) {
              const result: unknown = draw();
              if(result !== undefined) {
                void Promise.resolve(result).catch(() => {});
                throw new TypeError("Three.js rendering callbacks must return undefined synchronously");
              }
            } else renderer.render(scene, camera);
            if(!blit) {
              const shader = example.device.createShaderModule({ code: `
              @group(0) @binding(0) var source: texture_2d<f32>;
              @vertex fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
                let p = array(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
                return vec4f(p[i], 0, 1);
              }
              @fragment fn fragment(@builtin(position) p: vec4f) -> @location(0) vec4f {
                let color = textureLoad(source, vec2i(p.xy), 0);
                return ${texture.format.endsWith("-srgb") ? "color" : "vec4f(pow(color.rgb, vec3f(1.0 / 2.2)), color.a)"};
              }
            ` });
              blit = example.device.createRenderPipeline({
                layout: "auto", vertex: { module: shader, entryPoint: "vertex" },
                fragment: { module: shader, entryPoint: "fragment", targets: [{ format: texture.format }] }
              });
            }
            const encoder = example.device.createCommandEncoder();
            const pass = encoder.beginRenderPass({ colorAttachments: [{
              view: texture.createView(), loadOp: "clear", storeOp: "store"
            }] });
            pass.setPipeline(blit);
            pass.setBindGroup(0, example.device.createBindGroup({ layout: blit.getBindGroupLayout(0), entries: [{ binding: 0, resource: output.createView() }] }));
            pass.draw(3);
            pass.end();
            example.device.queue.submit([encoder.finish()]);
          } finally {
            currentTexture = undefined;
          }
        });
      }
    };
  } catch (error) {
    await example.dispose();
    throw error;
  }
}
