import { makeShaderDataDefinitions, makeStructuredView } from "webgpu-utils";
import { createExample } from "../shared/application.ts";

export async function createUtilsExample(title: string) {
  return createExample(`webgpu-utils / ${title}`);
}

/** Derive uniform packing from WGSL instead of mirroring offsets in TypeScript. */
export function createUniforms(example: Awaited<ReturnType<typeof createUtilsExample>>, code: string, name: string) {
  const definition = makeShaderDataDefinitions(code).uniforms[name];
  if(!definition) throw new Error(`Missing shader uniform: ${name}`);
  const view = makeStructuredView(definition);
  const buffer = example.device.createBuffer({ size: view.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  example.defer(() => buffer.destroy());
  return {
    buffer,
    write(values: Parameters<typeof view.set>[0]) {
      view.set(values);
      example.device.queue.writeBuffer(buffer, 0, view.arrayBuffer);
    }
  };
}
