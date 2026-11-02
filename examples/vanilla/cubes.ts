import { createExample } from "../shared/application.ts";
import { createDepthTexture } from "../shared/depth-texture.ts";

const example = await createExample("vanilla / cubes");
try {
  const { device } = example;
  // Six faces, each carrying an independent normal for flat lighting.
  const data: number[] = [];
  const faces = [
    [[1, 0, 0], [1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]],
    [[-1, 0, 0], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]],
    [[0, 1, 0], [-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]],
    [[0, -1, 0], [-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]],
    [[0, 0, 1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
    [[0, 0, -1], [1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]
  ];
  for(const [normal, ...corners] of faces) {
    for(const index of [0, 1, 2, 0, 2, 3]) data.push(...corners[index]!, ...normal!);
  }
  const vertices = device.createBuffer({ size: data.length * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vertices, 0, new Float32Array(data));
  example.defer(() => vertices.destroy());
  const uniforms = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  example.defer(() => uniforms.destroy());
  const depth = createDepthTexture(example);
  const shader = device.createShaderModule({ code: `
    @group(0) @binding(0) var<uniform> settings: vec4f;
    struct Vertex { @builtin(position) position: vec4f, @location(0) color: vec3f }
    fn rotate(p: vec3f, t: f32) -> vec3f {
      let y = vec3f(p.x*cos(t)+p.z*sin(t), p.y, -p.x*sin(t)+p.z*cos(t));
      return vec3f(y.x, y.y*cos(t*0.7)-y.z*sin(t*0.7), y.y*sin(t*0.7)+y.z*cos(t*0.7));
    }
    @vertex fn vertex(@location(0) position: vec3f, @location(1) normal: vec3f,
                      @builtin(instance_index) i: u32) -> Vertex {
      let t = settings.x + f32(i)*0.5;
      let offset = vec3f((f32(i%3)-1)*2.8, (f32(i/3)-0.5)*2.8, 0);
      let p = rotate(position*0.8, t) + offset + vec3f(0, 0, 10);
      let light = 0.2 + 0.8*max(dot(rotate(normal,t), normalize(vec3f(-1,2,-3))), 0);
      let color = vec3f(0.25+f32(i)*0.1, 0.6, 0.95-f32(i)*0.1)*light;
      return Vertex(vec4f(p.x*2/settings.y, p.y*2, p.z*100/99.9-10/99.9, p.z), color);
    }
    @fragment fn fragment(v: Vertex) -> @location(0) vec4f { return vec4f(v.color, 1); }
  ` });
  let pipeline: GPURenderPipeline | undefined;
  let bindGroup: GPUBindGroup;
  let time = 0;
  example.app.on("fixedUpdate", ({ dt }) => { time += dt; });
  example.app.on("render", () => {
    example.draw(texture => {
      if(!pipeline) {
        pipeline = device.createRenderPipeline({
          layout: "auto",
          vertex: { module: shader, entryPoint: "vertex", buffers: [{ arrayStride: 24, attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x3" }
          ] }] },
          fragment: { module: shader, entryPoint: "fragment", targets: [{ format: texture.format }] },
          depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" }
        });
        bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }] });
      }
      device.queue.writeBuffer(uniforms, 0, new Float32Array([time, texture.width / texture.height, 0, 0]));
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: texture.createView(), clearValue: [0.025, 0.035, 0.065, 1], loadOp: "clear", storeOp: "store" }],
        depthStencilAttachment: { view: depth(texture.width, texture.height), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" }
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup!);
      pass.setVertexBuffer(0, vertices);
      pass.draw(36, 6);
      pass.end();
      device.queue.submit([encoder.finish()]);
    });
  });
  await example.run();
} finally {
  await example.dispose();
}
