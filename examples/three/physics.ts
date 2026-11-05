import { BoxGeometry, Color, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Quaternion, Scene, Vector3 } from "three/webgpu";
import { Key } from "../../index.ts";
import { createBoxWorld } from "../shared/physics.ts";
import { createThreeExample } from "./adapter.ts";
import { orbitCamera } from "./orbit.ts";

const example = await createThreeExample("Rapier physics");
try {
  const physics = await createBoxWorld();
  example.defer(() => physics.world.free());
  const scene = new Scene();
  scene.background = new Color(0x101827);
  const camera = new PerspectiveCamera(45, 1.5, 0.1, 100);
  camera.position.set(10, 9, 14);
  orbitCamera(example.window, camera, new Vector3(0, 2, 0));
  scene.add(new HemisphereLight(0xc8e7ff, 0x504030, 2));
  const light = new DirectionalLight(0xffffff, 4);
  light.position.set(5, 10, 6);
  scene.add(light);
  const geometry = new BoxGeometry();
  const material = new MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.4 });
  const meshes = physics.boxes.map(() => {
    const mesh = new Mesh(geometry, material);
    scene.add(mesh);
    return mesh;
  });
  const floorGeometry = new PlaneGeometry(24, 24);
  const floorMaterial = new MeshStandardMaterial({ color: 0x475569 });
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  example.defer(() => { geometry.dispose(); material.dispose(); floorGeometry.dispose(); floorMaterial.dispose(); });
  let scatter = false;
  example.window.on("key", event => { if(event.key === Key.SPACE && event.action === "press") scatter = true; });
  example.app.on("fixedUpdate", ({ dt }) => {
    if(scatter) { physics.scatter(); scatter = false; }
    physics.step(dt);
  });
  const rotation = new Quaternion();
  example.window.on("render", ({ alpha }) => {
    physics.boxes.forEach((box, i) => {
      const p = box.body.translation();
      const q = box.body.rotation();
      const previous = box.previousPosition;
      meshes[i]!.position.set(previous.x, previous.y, previous.z).lerp(new Vector3(p.x, p.y, p.z), alpha);
      const previousRotation = box.previousRotation;
      rotation.set(q.x, q.y, q.z, q.w);
      meshes[i]!.quaternion.set(previousRotation.x, previousRotation.y, previousRotation.z, previousRotation.w).slerp(rotation, alpha);
    });
    example.render(scene, camera);
  });
  console.log("Space scatters the boxes; simulation runs at 120 Hz with interpolated rendering.");
  await example.run();
} finally {
  await example.dispose();
}
