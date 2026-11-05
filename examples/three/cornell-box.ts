import { ACESFilmicToneMapping, Color, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, RectAreaLight, RectAreaLightNode, Scene, SphereGeometry, Vector3 } from "three/webgpu";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RectAreaLightTexturesLib } from "three/addons/lights/RectAreaLightTexturesLib.js";
import { Key } from "../../index.ts";
import { createThreeExample } from "./adapter.ts";
import { orbitCamera } from "./orbit.ts";
import { createOverlay } from "./showcase/overlay.ts";
import { createPathDenoiser, createPathTracer } from "./showcase/path-tracer.ts";
import { disposeScene } from "./showcase/scene-resources.ts";

const example = await createThreeExample("Cornell box", { width: 1200, height: 800, optionalFeatures: ["shader-f16"] });
try {
  const { renderer } = example;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
  const scene = new Scene();
  scene.background = new Color(0x0c1217);
  example.defer(() => disposeScene(scene));
  const camera = new PerspectiveCamera(38, 1.5, 0.1, 80);
  camera.position.set(0, 2.6, 13.8);
  orbitCamera(example.window, camera, new Vector3(0, 2.45, 0));

  // Five inward-facing walls, an open front, and one finite ceiling emitter.
  // There is no environment light: the colored bounce light is traced.
  const white = new MeshStandardMaterial({ color: 0xd6d3cb, roughness: 1 });
  const red = new MeshStandardMaterial({ color: 0xcc3c32, roughness: 1 });
  const green = new MeshStandardMaterial({ color: 0x39ad4b, roughness: 1 });
  const wallGeometry = new PlaneGeometry(5, 5);
  const back = new Mesh(wallGeometry, white);
  back.position.set(0, 2.5, -2.5);
  const left = new Mesh(wallGeometry, red);
  left.position.set(-2.5, 2.5, 0);
  left.rotation.y = Math.PI / 2;
  const right = new Mesh(wallGeometry, green);
  right.position.set(2.5, 2.5, 0);
  right.rotation.y = -Math.PI / 2;
  const floor = new Mesh(wallGeometry, white);
  floor.rotation.x = -Math.PI / 2;
  const ceiling = new Mesh(wallGeometry, white);
  ceiling.position.y = 5;
  ceiling.rotation.x = Math.PI / 2;
  scene.add(back, left, right, floor, ceiling);

  const blockMaterial = new MeshPhysicalMaterial({ color: 0xe1ded5, roughness: 0.72 });
  const tall = new Mesh(new RoundedBoxGeometry(1.5, 2.9, 1.5, 2, 0.015), blockMaterial);
  tall.position.set(0.8, 1.45, -0.9);
  tall.rotation.y = -0.3;
  const short = new Mesh(new RoundedBoxGeometry(1.65, 1.45, 1.65, 2, 0.015), blockMaterial);
  short.position.set(-0.95, 0.725, 0.5);
  short.rotation.y = 0.28;
  scene.add(tall, short);
  const glass = new Mesh(new SphereGeometry(0.61, 48, 32), new MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0, transmission: 1, thickness: 1.22, ior: 1.5
  }));
  glass.position.set(1.15, 0.61, 1.25);
  scene.add(glass);
  const light = new RectAreaLight(0xffffff, 17, 1.6, 1.35);
  light.visibleToCameraRays = true;
  light.position.set(0, 4.985, -0.25);
  light.lookAt(0, 0, -0.25);
  scene.add(light);
  // Area lights are visible to camera rays in the path tracer. This non-lighting
  // marker only supplies their appearance in the direct raster preview.
  const lightMarker = new Mesh(new PlaneGeometry(1.6, 1.35), new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  lightMarker.position.copy(light.position);
  lightMarker.quaternion.copy(light.quaternion);
  lightMarker.visible = false;
  scene.add(lightMarker);

  const overlay = createOverlay(renderer, {
    index: "01", title: "Cornell box", subtitle: "One light. Two colors. Every bounce counts.",
    controls: "DRAG  Orbit     SCROLL  Dolly     B  Bounces     1 / 2 / 3  Material     P  Preview     D  Raw / clean     R  Reset     Q  Exit",
    detail: "DIFFUSE TRANSPORT   /   SOFT SHADOWS   /   GLASS", accent: 0xd9c795
  });
  example.defer(() => overlay.dispose());
  const tracer = createPathTracer(renderer);
  example.defer(() => tracer.dispose());
  const { denoiser, drain } = await createPathDenoiser();
  tracer.setDenoiser(denoiser);
  tracer.maxSamples = 24;
  example.defer(drain);
  tracer.setScene(scene, camera);
  let preview = false;
  let materialIndex = 0;
  let appliedMaterial = -1;
  let reset = false;
  let previousCamera = "";
  let sampleLabel = "ACCUMULATING LIGHT";
  let measuring = false;
  let lastMeasurement = 0;
  let generation = 0;
  let clean = true;
  let appliedClean = true;
  let reportedGeneration = -1;
  let requestedBounces = 6;
  const presets = [
    { color: 0xe1ded5, metalness: 0, roughness: 0.72, name: "MATTE" },
    { color: 0xc7d4df, metalness: 1, roughness: 0.08, name: "CHROME" },
    { color: 0xe5d1b0, metalness: 1, roughness: 0.19, name: "BRASS" }
  ];
  example.window.on("key", event => {
    if(event.action !== "press") return;
    if(event.key >= Key.ONE && event.key <= Key.THREE) materialIndex = event.key - Key.ONE;
    if(event.key === Key.P) { preview = !preview; reset = true; }
    if(event.key === Key.R) reset = true;
    if(event.key === Key.D) clean = !clean;
    if(event.key === Key.B) requestedBounces = requestedBounces === 6 ? 1 : 6;
  });
  example.window.on("render", () => {
    example.render(scene, camera, () => {
      if(tracer.maxBounces !== requestedBounces) {
        tracer.maxBounces = requestedBounces;
        reset = true;
      }
      if(appliedMaterial !== materialIndex) {
        const preset = presets[materialIndex]!;
        blockMaterial.color.setHex(preset.color);
        blockMaterial.metalness = preset.metalness;
        blockMaterial.roughness = preset.roughness;
        tracer.updateMaterials();
        appliedMaterial = materialIndex;
        reset = true;
      }
      if(appliedClean !== clean) {
        // Keep ownership with the tracer; maxSamples=0 continues raw accumulation.
        tracer.maxSamples = clean ? 24 : 0;
        denoiser.reset();
        appliedClean = clean;
        reset = true;
      }
      camera.updateMatrixWorld();
      const fingerprint = [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements].join();
      if(fingerprint !== previousCamera || reset) {
        tracer.updateCamera();
        previousCamera = fingerprint;
        reset = false;
        generation++;
        sampleLabel = "ACCUMULATING LIGHT";
      }
      lightMarker.visible = preview;
      if(preview) renderer.render(scene, camera);
      else tracer.renderSample();
      const now = performance.now();
      if(!preview && !measuring && now - lastMeasurement > 750) {
        measuring = true;
        lastMeasurement = now;
        const measuredGeneration = generation;
        void tracer.getSampleCountsAsync().then(counts => {
          if(generation === measuredGeneration) sampleLabel = `${Math.floor(counts.avg)} SAMPLES / PIXEL`;
        }).finally(() => { measuring = false; });
      }
      const status = preview ? "RASTER PREVIEW" : denoiser.complete ? "DENOISED / 24 SPP" : denoiser.running ? "DENOISING" : sampleLabel;
      if(denoiser.complete && reportedGeneration !== generation) {
        console.log(`Cornell box converged: ${presets[materialIndex]!.name}, 24 SPP + OIDN`);
        reportedGeneration = generation;
      }
      overlay.setStatus(`${presets[materialIndex]!.name}  /  ${requestedBounces} BOUNCES  /  ${status}`);
      overlay.render();
    });
  });
  console.log("B compares one/six bounces; 1/2/3 selects matte/chrome/brass blocks; P toggles raster preview; D toggles denoising; R restarts accumulation.");
  await example.run();
} finally {
  await example.dispose();
}
