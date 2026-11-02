import { ACESFilmicToneMapping, Color, CylinderGeometry, DirectionalLight, DoubleSide, ExtrudeGeometry, FogExp2, Group, HemisphereLight, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, Shape, SphereGeometry, TorusGeometry, Vector3 } from "three/webgpu";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { Key } from "../../index.ts";
import { createThreeExample } from "./adapter.ts";
import { orbitCamera } from "./orbit.ts";
import { createOverlay } from "./showcase/overlay.ts";
import { disposeScene } from "./showcase/scene-resources.ts";
import { createStudioEnvironment } from "./showcase/studio.ts";

const example = await createThreeExample("kinetic", { width: 1200, height: 800 });
try {
  const { renderer } = example;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  const scene = new Scene();
  scene.background = new Color(0x101e24);
  scene.fog = new FogExp2(0x101e24, 0.045);
  scene.environment = createStudioEnvironment();
  scene.environmentIntensity = 0.8;
  example.defer(() => scene.environment?.dispose());
  example.defer(() => disposeScene(scene));
  const camera = new PerspectiveCamera(35, 1.5, 0.1, 80);
  camera.position.set(6.5, 4.6, 9.7);
  orbitCamera(example.window, camera, new Vector3(0, 1.75, 0));

  scene.add(new HemisphereLight(0xb8dce1, 0x17272b, 1.4));
  const key = new DirectionalLight(0xffd1a0, 3.5);
  key.position.set(-3, 7, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 6, bottom: -5, near: 0.1, far: 25 });
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.025;
  scene.add(key);
  const rim = new DirectionalLight(0x69c7d6, 4);
  rim.position.set(3, 4, -5);
  scene.add(rim);
  const floor = new Mesh(new PlaneGeometry(200, 200), new MeshStandardMaterial({ color: 0x172b32, roughness: 0.5, metalness: 0.2 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const stone = new MeshStandardMaterial({ color: 0x1b3035, roughness: 0.28, metalness: 0.5 });
  const brass = new MeshPhysicalMaterial({ color: 0xc69555, metalness: 1, roughness: 0.24, clearcoat: 0.35 });
  const copper = new MeshPhysicalMaterial({ color: 0xc97549, metalness: 0.94, roughness: 0.26, clearcoat: 0.3, side: DoubleSide });
  const paleCopper = new MeshPhysicalMaterial({ color: 0xe4b080, metalness: 1, roughness: 0.22, clearcoat: 0.3, side: DoubleSide });
  const plinth = new Mesh(new CylinderGeometry(1.62, 1.68, 0.28, 96), stone);
  plinth.position.y = 0.19;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  scene.add(plinth);
  const base = new Mesh(new CylinderGeometry(1.48, 1.48, 0.08, 96), brass);
  base.position.y = 0.055;
  scene.add(base);
  const trimGeometry = new TorusGeometry(1.59, 0.012, 8, 128);
  for(const y of [0.12, 0.32]) {
    const trim = new Mesh(trimGeometry, brass);
    trim.rotation.x = Math.PI / 2;
    trim.position.y = y;
    scene.add(trim);
  }
  const stem = new Mesh(new CylinderGeometry(0.065, 0.11, 1.35, 32), brass);
  stem.position.y = 0.95;
  stem.castShadow = true;
  scene.add(stem);

  const sculpture = new Group();
  sculpture.position.y = 2.2;
  scene.add(sculpture);
  const core = new Mesh(new SphereGeometry(0.38, 48, 32), brass);
  sculpture.add(core);
  const leaf = new Shape();
  leaf.moveTo(0, -1.38);
  leaf.bezierCurveTo(0.82, -0.8, 1.22, 0.64, 0.08, 1.46);
  leaf.bezierCurveTo(0.52, 0.55, 0.3, -0.62, 0, -1.38);
  const bladeGeometry = new ExtrudeGeometry(leaf, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.018, bevelSegments: 2, steps: 1, curveSegments: 32 });
  bladeGeometry.translate(0, 0, -0.0175);
  const blades: Group[] = [];
  const count = 64;
  const pinGeometry = new CylinderGeometry(0.038, 0.038, 0.14, 12);
  for(let i = 0; i < count; i++) {
    const pivot = new Group();
    const blade = new Mesh(bladeGeometry, i % 4 === 0 ? paleCopper : copper);
    blade.castShadow = true;
    blade.receiveShadow = true;
    pivot.add(blade);
    const pin = new Mesh(pinGeometry, brass);
    pin.position.y = -1.25;
    pivot.add(pin);
    sculpture.add(pivot);
    blades.push(pivot);
  }
  // A ring of radial marks makes the pedestal feel like a precision instrument.
  const markGeometry = new RoundedBoxGeometry(0.014, 0.006, 0.07, 1, 0.002);
  for(let i = 0; i < 96; i++) {
    const angle = i / 96 * Math.PI * 2;
    const mark = new Mesh(markGeometry, brass);
    mark.position.set(Math.sin(angle) * 1.47, 0.333, Math.cos(angle) * 1.47);
    mark.rotation.y = angle;
    scene.add(mark);
  }
  const overlay = createOverlay(renderer, {
    index: "02", title: "Copper in motion", subtitle: "Sixty-four leaves. One continuous breath.",
    controls: "DRAG  Orbit     SCROLL  Dolly     SPACE  Hold motion     M  Choreography     Q  Exit",
    detail: "KINETIC SCULPTURE   /   COPPER & BRASS", accent: 0xe6ac73
  });
  example.defer(() => overlay.dispose());
  let time = 0;
  let paused = false;
  let mode = 0;
  const modes = ["BREATHE", "TRAVELLING WAVE", "BLOOM"];
  example.window.on("key", event => {
    if(event.action !== "press") return;
    if(event.key === Key.SPACE) paused = !paused;
    if(event.key === Key.M) mode = (mode + 1) % modes.length;
  });
  example.app.on("fixedUpdate", ({ dt }) => { if(!paused) time += dt; });
  example.app.on("render", () => {
    sculpture.rotation.y = time * 0.11;
    for(let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2;
      const phase = mode === 1 ? angle * 2 : mode === 2 ? angle * 0.5 : 0;
      const breath = 0.5 + 0.5 * Math.sin(time * 0.65 + phase);
      const radius = 0.38 + breath * (mode === 2 ? 0.55 : 0.3);
      const pivot = blades[i]!;
      pivot.position.set(Math.cos(angle) * radius, 0.06 * Math.sin(angle * 3 + time), Math.sin(angle) * radius);
      pivot.rotation.set(0, -angle + 0.28 + breath * 0.55, -0.25 - breath * 0.22);
    }
    overlay.setStatus(`${paused ? "HELD" : "IN MOTION"}  /  ${modes[mode]}`);
    example.render(scene, camera, () => {
      renderer.render(scene, camera);
      overlay.render();
    });
  });
  console.log("Space holds the sculpture; M switches breathe / travelling wave / bloom.");
  await example.run();
} finally {
  await example.dispose();
}
