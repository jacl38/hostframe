import { createExample } from "../shared/application.ts";

const example = await createExample("vanilla / compute particles");
try {
  const { device } = example;
  const count = 4096;
  const initial = new Float32Array(count * 4);
  for(let i = 0; i < count; i++) {
    const angle = i * 2.399963;
    const radius = Math.sqrt(i / count) * 0.8;
    initial.set([Math.cos(angle) * radius, Math.sin(angle) * radius, -Math.sin(angle) * 0.2, Math.cos(angle) * 0.2], i * 4);
  }
  const particles = device.createBuffer({ size: initial.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(particles, 0, initial);
  example.defer(() => particles.destroy());
  const step = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  example.defer(() => step.destroy());
  const computeShader = device.createShaderModule({ code: `
    @group(0) @binding(0) var<storage, read_write> particles: array<vec4f>;
    @group(0) @binding(1) var<uniform> step: vec4f;
    @compute @workgroup_size(64) fn compute(@builtin(global_invocation_id) id: vec3u) {
      if(id.x >= arrayLength(&particles)) { return; }
      var p = particles[id.x];
      p.zw += -p.xy * step.x * 0.4;
      p.xy += p.zw * step.x;
      particles[id.x] = p;
    }
  ` });
  const compute = device.createComputePipeline({ layout: "auto", compute: { module: computeShader, entryPoint: "compute" } });
  const computeGroup = device.createBindGroup({ layout: compute.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: particles } }, { binding: 1, resource: { buffer: step } }
  ] });
  const renderShader = device.createShaderModule({ code: `
    @group(0) @binding(0) var<storage, read> particles: array<vec4f>;
    struct Vertex { @builtin(position) position: vec4f, @location(0) color: vec3f }
    @vertex fn vertex(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Vertex {
      let corners = array(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
      let p = particles[i];
      return Vertex(vec4f(p.xy + corners[v]*0.006, 0, 1), vec3f(0.2+abs(p.x), 0.35+abs(p.y), 0.95));
    }
    @fragment fn fragment(v: Vertex) -> @location(0) vec4f { return vec4f(v.color,1); }
  ` });
  let pipeline: GPURenderPipeline | undefined;
  let renderGroup: GPUBindGroup;
  example.app.on("fixedUpdate", ({ dt }) => {
    device.queue.writeBuffer(step, 0, new Float32Array([dt, 0, 0, 0]));
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(compute);
    pass.setBindGroup(0, computeGroup);
    pass.dispatchWorkgroups(Math.ceil(count / 64));
    pass.end();
    device.queue.submit([encoder.finish()]);
  });
  example.app.on("render", () => {
    example.draw(texture => {
      if(!pipeline) {
        pipeline = device.createRenderPipeline({ layout: "auto", vertex: { module: renderShader, entryPoint: "vertex" }, fragment: { module: renderShader, entryPoint: "fragment", targets: [{ format: texture.format }] } });
        renderGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: particles } }] });
      }
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), clearValue: [0.01, 0.015, 0.035, 1], loadOp: "clear", storeOp: "store" }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, renderGroup!);
      pass.draw(6, count);
      pass.end();
      device.queue.submit([encoder.finish()]);
    });
  });
  await example.run();
} finally {
  await example.dispose();
}
