import { tgpu, d } from "typegpu";
import { createTypeGPUExample } from "./adapter.ts";

const example = await createTypeGPUExample("triangle");
try {
  const vertex = tgpu.vertexFn({
    in: { index: d.builtin.vertexIndex },
    out: { position: d.builtin.position, color: d.vec3f }
  })`{
    let positions = array(vec2f(0, 0.75), vec2f(-0.75, -0.65), vec2f(0.75, -0.65));
    let colors = array(vec3f(1, 0.2, 0.4), vec3f(0.4, 1, 0.3), vec3f(0.3, 0.4, 1));
    return Out(vec4f(positions[index], 0, 1), colors[index]);
  }`;
  const fragment = tgpu.fragmentFn({ in: { color: d.vec3f }, out: d.vec4f })`{
    return vec4f(in.color, 1);
  }`;
  function createPipeline(format: GPUTextureFormat) {
    return example.root.createRenderPipeline({ vertex, fragment, targets: { format } });
  }
  let pipeline: ReturnType<typeof createPipeline> | undefined;
  example.window.on("render", () => {
    const texture = example.context.getCurrentTexture();
    pipeline ??= createPipeline(texture.format);
    pipeline.withColorAttachment({ view: texture.createView(), clearValue: [0.025, 0.035, 0.065, 1] }).draw(3);
  });
  await example.run();
} finally {
  await example.dispose();
}
