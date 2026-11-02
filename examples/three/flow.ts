import { ACESFilmicToneMapping, AdditiveBlending, Color, InstancedMesh, PerspectiveCamera, PlaneGeometry, RenderPipeline, Scene, SpriteNodeMaterial, Vector3 } from "three/webgpu";
import { Fn, cos, float, hash, instanceIndex, instancedArray, mix, pass, sin, uniform, uv, vec4 } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { Key } from "../../index.ts";
import { createThreeExample } from "./adapter.ts";
import { orbitCamera } from "./orbit.ts";
import { createOverlay } from "./showcase/overlay.ts";
import { disposeScene } from "./showcase/scene-resources.ts";

const example = await createThreeExample("flow", { width: 1200, height: 800 });
try {
  const { renderer } = example;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  const scene = new Scene();
  scene.background = new Color(0x03080e);
  example.defer(() => disposeScene(scene));
  const camera = new PerspectiveCamera(38, 1.5, 0.1, 100);
  camera.position.set(5.5, 3.2, 10.5);
  orbitCamera(example.window, camera, new Vector3());
  const count = 65_536;
  const positions = instancedArray(count, "vec4");
  const clock = uniform(0);
  const morph = uniform(0);
  const paletteA = uniform(new Color(0x26d6c8));
  const paletteB = uniform(new Color(0xf08c73));

  // Each invocation advances one particle along a closed, twisted streamline.
  // Parameters stay on the GPU; there is no per-frame position upload.
  const update = Fn(() => {
    const id = float(instanceIndex);
    const strand = hash(instanceIndex).toVar();
    const speed = strand.mul(0.12).add(0.12);
    const t = id.div(count).mul(Math.PI * 2).add(clock.mul(speed));
    const winding = mix(float(3), float(5), morph);
    const r = cos(t.mul(winding)).mul(0.72).add(2.1);
    const angle = t.mul(2);
    const filament = hash(instanceIndex.add(17)).mul(Math.PI * 2).add(clock.mul(0.12));
    const spread = strand.pow(1.5).mul(0.27).add(0.025);
    const ripple = sin(t.mul(13).add(filament)).mul(0.025);
    const x = r.add(cos(filament).mul(spread)).mul(cos(angle));
    const y = sin(t.mul(winding)).mul(0.95).add(sin(filament).mul(spread)).add(ripple);
    const z = r.add(cos(filament).mul(spread)).mul(sin(angle));
    positions.element(instanceIndex).assign(vec4(x, y, z, strand));
  })().compute(count);
  example.defer(() => update.dispose());
  const material = new SpriteNodeMaterial({ blending: AdditiveBlending, depthWrite: false, transparent: true });
  material.positionNode = positions.toAttribute().xyz;
  material.scaleNode = hash(instanceIndex.add(39)).mul(0.018).add(0.019);
  const hue = sin(positions.toAttribute().y.mul(1.4).add(positions.toAttribute().x.mul(0.6))).mul(0.5).add(0.5);
  material.colorNode = mix(paletteA, paletteB, hue).mul(1.5);
  const distance = uv().sub(0.5).length().mul(2);
  material.opacityNode = float(1).sub(distance).max(0).pow(2).mul(0.6);
  const particles = new InstancedMesh(new PlaneGeometry(1, 1), material, count);
  particles.frustumCulled = false;
  particles.rotation.z = -0.22;
  scene.add(particles);

  const pipeline = new RenderPipeline(renderer);
  // The analytic sprite falloff supplies coverage; MSAA adds bandwidth without
  // helping these soft additive particles. The vector HUD has its own MSAA.
  const scenePass = pass(scene, camera, { samples: 0 });
  const sceneColor = scenePass.getTextureNode("output");
  const glow = bloom(sceneColor, 0.38, 0.35, 0.5);
  pipeline.outputNode = sceneColor.add(glow);
  example.defer(() => { pipeline.dispose(); scenePass.dispose(); glow.dispose(); });
  const overlay = createOverlay(renderer, {
    index: "03", title: "Slow current", subtitle: "Sixty-five thousand points, finding their way.",
    controls: "DRAG  Orbit     SCROLL  Dolly     SPACE  Hold flow     C  Palette     M  Winding     Q  Exit",
    detail: "65,536 PARTICLES   /   GPU STREAMLINES", accent: 0x75dbd1
  });
  example.defer(() => overlay.dispose());
  const palettes = [
    { a: 0x26d6c8, b: 0xf08c73, name: "LAGOON / CORAL" },
    { a: 0x5579ff, b: 0xe49dff, name: "ULTRAVIOLET" },
    { a: 0xf27035, b: 0xffda8c, name: "EMBER" }
  ];
  let palette = 0;
  let paused = false;
  let targetMorph = 0;
  example.window.on("key", event => {
    if(event.action !== "press") return;
    if(event.key === Key.SPACE) paused = !paused;
    if(event.key === Key.C) palette = (palette + 1) % palettes.length;
    if(event.key === Key.M) targetMorph = 1 - targetMorph;
  });
  example.app.on("fixedUpdate", ({ dt }) => {
    if(!paused) clock.value += dt;
    morph.value += (targetMorph - morph.value) * (1 - Math.exp(-dt * 2));
  });
  example.app.on("render", () => {
    paletteA.value.setHex(palettes[palette]!.a);
    paletteB.value.setHex(palettes[palette]!.b);
    overlay.setStatus(`${paused ? "HELD" : "FLOWING"}  /  ${palettes[palette]!.name}`);
    example.render(scene, camera, () => {
      renderer.compute(update);
      pipeline.render();
      overlay.render();
    });
  });
  console.log("Space holds the flow; C changes palette; M morphs between windings.");
  await example.run();
} finally {
  await example.dispose();
}
