import { tgpu, d } from "typegpu";
import { createTypeGPUExample } from "./adapter.ts";

const example = await createTypeGPUExample("compute particles");
try {
  const { root } = example;
  const count = 2048;
  const state = root.createBuffer(d.arrayOf(d.vec4f, count), Array.from({ length: count }, (_, i) => {
    const angle = i * 2.399963;
    const radius = Math.sqrt(i / count) * 0.8;
    return d.vec4f(Math.cos(angle) * radius, Math.sin(angle) * radius, -Math.sin(angle) * 0.3, Math.cos(angle) * 0.3);
  })).$usage("storage");
  const settings = root.createBuffer(d.vec4f, d.vec4f(1 / 120, 1.5, 0, 0)).$usage("uniform");
  example.defer(() => state.destroy());
  example.defer(() => settings.destroy());
  const computeLayout = tgpu.bindGroupLayout({
    state: { storage: d.arrayOf(d.vec4f, count), access: "mutable" }, settings: { uniform: d.vec4f }
  });
  const renderLayout = tgpu.bindGroupLayout({
    state: { storage: d.arrayOf(d.vec4f, count), access: "readonly" }, settings: { uniform: d.vec4f }
  });
  const computeShader = tgpu.computeFn({
    in: { id: d.builtin.globalInvocationId }, workgroupSize: [64]
  })(`{
    if(id.x >= ${count}u) { return; }
    var p = state[id.x];
    p.zw += -p.xy * settings.x * 0.5;
    p.xy += p.zw * settings.x;
    state[id.x] = p;
  }`).$uses({
    get state() { return computeLayout.$.state; },
    get settings() { return computeLayout.$.settings; }
  });
  const compute = root.createComputePipeline({ compute: computeShader });
  const computeGroup = root.createBindGroup(computeLayout, { state, settings });
  const renderGroup = root.createBindGroup(renderLayout, { state, settings });
  const vertex = tgpu.vertexFn({
    in: { vertex: d.builtin.vertexIndex, instance: d.builtin.instanceIndex },
    out: { position: d.builtin.position, color: d.vec3f }
  })`{
    let corners = array(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
    let p = state[instance];
    let pos = (p.xy + corners[vertex]*0.008) * vec2f(1/settings.y, 1);
    return Out(vec4f(pos, 0, 1), vec3f(0.6+abs(p.x)*0.4, 0.3+abs(p.y)*0.7, 1));
  }`.$uses({
      get state() { return renderLayout.$.state; },
      get settings() { return renderLayout.$.settings; }
    });
  const fragment = tgpu.fragmentFn({ in: { color: d.vec3f }, out: d.vec4f })`{
    return vec4f(in.color, 1);
  }`;
  function createPipeline(format: GPUTextureFormat) {
    return root.createRenderPipeline({ vertex, fragment, targets: { format } }).with(renderGroup);
  }
  let pipeline: ReturnType<typeof createPipeline> | undefined;
  let aspect = 1.5;
  example.app.on("fixedUpdate", ({ dt }) => {
    settings.write(d.vec4f(dt, aspect, 0, 0));
    compute.with(computeGroup).dispatchWorkgroups(Math.ceil(count / 64));
  });
  example.app.on("render", () => {
    example.draw(texture => {
      aspect = texture.width / texture.height;
      pipeline ??= createPipeline(texture.format);
      pipeline.withColorAttachment({ view: texture.createView(), clearValue: [0.01, 0.015, 0.035, 1] }).draw(6, count);
    });
  });
  await example.run();
} finally {
  await example.dispose();
}
