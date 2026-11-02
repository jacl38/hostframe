import { createBuffersAndAttributesFromArrays, primitives } from "webgpu-utils";
import { createDepthTexture } from "../shared/depth-texture.ts";
import { createUtilsExample, createUniforms } from "./adapter.ts";

const example = await createUtilsExample("instanced cubes");
try {
  const { device } = example;
  const mesh = createBuffersAndAttributesFromArrays(device, primitives.createCubeVertices());
  example.defer(() => { for(const buffer of mesh.buffers) buffer.destroy(); mesh.indexBuffer?.destroy(); });
  const depth = createDepthTexture(example);
  const code = `
    struct Settings { time: f32, aspect: f32 }
    @group(0) @binding(0) var<uniform> settings: Settings;
    struct Vertex { @builtin(position) position: vec4f, @location(0) color: vec3f }
    @vertex fn vertex(@location(0) position: vec3f, @location(1) normal: vec3f,
                      @builtin(instance_index) i: u32) -> Vertex {
      let angle = settings.time + f32(i)*0.1;
      let rotation = mat3x3f(vec3f(cos(angle),0,-sin(angle)), vec3f(0,1,0), vec3f(sin(angle),0,cos(angle)));
      let offset = vec3f((f32(i%10)-4.5)*1.4, (f32(i/10)-3.5)*1.4, 0);
      let p = rotation*position*0.8 + offset + vec3f(0,0,17);
      let light = 0.25 + 0.75*max(dot(rotation*normal,normalize(vec3f(-1,2,-3))),0);
      let color = vec3f(0.2+f32(i%10)*0.07,0.7,0.9-f32(i/10)*0.08)*light;
      return Vertex(vec4f(p.x*2/settings.aspect,p.y*2,p.z*100/99.9-10/99.9,p.z),color);
    }
    @fragment fn fragment(v: Vertex) -> @location(0) vec4f { return vec4f(v.color,1); }
  `;
  const uniforms = createUniforms(example, code, "settings");
  const module = device.createShaderModule({ code });
  let pipeline: GPURenderPipeline | undefined;
  let group: GPUBindGroup;
  let time = 0;
  example.app.on("fixedUpdate", ({ dt }) => { time += dt; });
  example.app.on("render", () => {
    example.draw(texture => {
      if(!pipeline) {
        pipeline = device.createRenderPipeline({
          layout: "auto", vertex: { module, entryPoint: "vertex", buffers: mesh.bufferLayouts },
          fragment: { module, entryPoint: "fragment", targets: [{ format: texture.format }] },
          depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" }
        });
        group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms.buffer } }] });
      }
      uniforms.write({ time, aspect: texture.width / texture.height });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: texture.createView(), clearValue: [0.025, 0.035, 0.065, 1], loadOp: "clear", storeOp: "store" }],
        depthStencilAttachment: { view: depth(texture.width, texture.height), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" }
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group!);
      mesh.buffers.forEach((buffer, slot) => pass.setVertexBuffer(slot, buffer));
      pass.setIndexBuffer(mesh.indexBuffer!, mesh.indexFormat!);
      pass.drawIndexed(mesh.numElements, 80);
      pass.end();
      device.queue.submit([encoder.finish()]);
    });
  });
  await example.run();
} finally {
  await example.dispose();
}
