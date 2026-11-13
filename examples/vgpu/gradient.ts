import { prepareShader } from "@vgpu/wgsl/prepare";
import { effect } from "vgpu";
import { Key } from "../../index.ts";
import { createVgpuExample } from "./adapter.ts";

const example = await createVgpuExample("gradient");
try {
  const shader = effect(example.gpu, prepareShader(`
    struct Params { resolution: vec2f, time: f32 }
    @group(0) @binding(0) var<uniform> params: Params;
    @fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
      let uv = position.xy / params.resolution;
      let wave = 0.5 + 0.5 * sin(uv.x * 8.0 + uv.y * 4.0 - params.time);
      let blue = vec3f(0.04, 0.16, 0.38);
      let teal = vec3f(0.05, 0.7, 0.6);
      return vec4f(mix(blue, teal, wave) * (0.6 + uv.y * 0.4), 1.0);
    }
  `), { set: { params: { resolution: example.output.size, time: 0 } } });
  await shader.compile(example.output);
  let time = 0;
  let paused = false;
  example.window.on("key", event => {
    if(event.action === "press" && event.key === Key.SPACE) paused = !paused;
  });
  example.app.on("fixedUpdate", event => { if(!paused) time += event.dt; });
  example.window.on("render", () => {
    const texture = example.context.getCurrentTexture();
    shader.set({ params: { resolution: [texture.width, texture.height], time } });
    example.render(shader);
  });
  console.log("Space pauses the gradient.");
  await example.run();
} finally {
  await example.dispose();
}
