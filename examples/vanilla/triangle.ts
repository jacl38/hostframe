import { createExample } from "../shared/application.ts";

const example = await createExample("vanilla / triangle");
try {
  const { device } = example;
  const shader = device.createShaderModule({ code: `
    struct Vertex { @builtin(position) position: vec4f, @location(0) color: vec3f }
    @vertex fn vertex(@builtin(vertex_index) i: u32) -> Vertex {
      let positions = array(vec2f(0, 0.75), vec2f(-0.75, -0.65), vec2f(0.75, -0.65));
      let colors = array(vec3f(1, 0.2, 0.3), vec3f(0.2, 1, 0.5), vec3f(0.2, 0.5, 1));
      return Vertex(vec4f(positions[i], 0, 1), colors[i]);
    }
    @fragment fn fragment(v: Vertex) -> @location(0) vec4f { return vec4f(v.color, 1); }
  ` });
  let pipeline: GPURenderPipeline | undefined;
  example.app.on("render", () => {
    example.draw(texture => {
      pipeline ??= device.createRenderPipeline({
        layout: "auto",
        vertex: { module: shader, entryPoint: "vertex" },
        fragment: { module: shader, entryPoint: "fragment", targets: [{ format: texture.format }] }
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{
        view: texture.createView(), clearValue: [0.025, 0.035, 0.065, 1], loadOp: "clear", storeOp: "store"
      }] });
      pass.setPipeline(pipeline);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
    });
  });
  await example.run();
} finally {
  await example.dispose();
}
