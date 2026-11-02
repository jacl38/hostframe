import { createTextureFromSource } from "webgpu-utils";
import { createUtilsExample } from "./adapter.ts";

const example = await createUtilsExample("textures / generated mipmaps");
try {
  const { device } = example;
  // Typed pixel data avoids browser-only image decoders and external downloads.
  const size = 256;
  const pixels = new Uint8Array(size * size * 4);
  for(let y = 0; y < size; y++) {
    for(let x = 0; x < size; x++) {
      const on = ((x >> 3) + (y >> 3)) % 2 === 0;
      pixels.set(on ? [240, 160, 30, 255] : [20, 60, 140, 255], (y * size + x) * 4);
    }
  }
  const image = createTextureFromSource(device, { data: pixels, width: size, height: size }, { mips: true });
  example.defer(() => image.destroy());
  const sampler = device.createSampler({ minFilter: "linear", magFilter: "linear", mipmapFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" });
  const shader = device.createShaderModule({ code: `
    @group(0) @binding(0) var image: texture_2d<f32>;
    @group(0) @binding(1) var imageSampler: sampler;
    struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
    @vertex fn vertex(@builtin(vertex_index) i: u32) -> Vertex {
      let p = array(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
      return Vertex(vec4f(p[i],0,1),p[i]*0.5+0.5);
    }
    @fragment fn fragment(v: Vertex) -> @location(0) vec4f {
      let uv = vec2f((v.uv.x-0.5)*3/(v.uv.y+0.08),1/(v.uv.y+0.08));
      return textureSample(image,imageSampler,uv);
    }
  ` });
  let pipeline: GPURenderPipeline | undefined;
  let group: GPUBindGroup;
  example.app.on("render", () => {
    example.draw(texture => {
      if(!pipeline) {
        pipeline = device.createRenderPipeline({ layout: "auto", vertex: { module: shader, entryPoint: "vertex" }, fragment: { module: shader, entryPoint: "fragment", targets: [{ format: texture.format }] } });
        group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: image.createView() }, { binding: 1, resource: sampler }] });
      }
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: "clear", storeOp: "store" }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group!);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
    });
  });
  await example.run();
} finally {
  await example.dispose();
}
