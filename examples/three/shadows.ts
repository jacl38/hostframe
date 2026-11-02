import { Color, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, TorusKnotGeometry, Vector3 } from "three/webgpu";
import { createThreeExample } from "./adapter.ts";
import { orbitCamera } from "./orbit.ts";

const example = await createThreeExample("shadows");
try {
  const scene = new Scene();
  scene.background = new Color(0x101827);
  const camera = new PerspectiveCamera(45, 1.5, 0.1, 100);
  camera.position.set(6, 5, 9);
  orbitCamera(example.window, camera, new Vector3(0, 1, 0));
  example.renderer.shadowMap.enabled = true;
  scene.add(new HemisphereLight(0xb8d8ff, 0x302820, 1));
  const light = new DirectionalLight(0xffefd5, 4);
  light.position.set(4, 8, 3);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  Object.assign(light.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 0.5, far: 25 });
  light.shadow.normalBias = 0.03;
  example.defer(() => light.dispose());
  scene.add(light);
  const geometry = new TorusKnotGeometry(1, 0.35, 100, 16);
  const material = new MeshStandardMaterial({ color: 0xff7040, roughness: 0.3, metalness: 0.3 });
  const knot = new Mesh(geometry, material);
  knot.position.y = 2;
  knot.castShadow = true;
  knot.receiveShadow = true;
  scene.add(knot);
  const floorGeometry = new PlaneGeometry(30, 30);
  const floorMaterial = new MeshStandardMaterial({ color: 0x718096, roughness: 1 });
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  example.defer(() => { geometry.dispose(); material.dispose(); floorGeometry.dispose(); floorMaterial.dispose(); });
  example.app.on("fixedUpdate", ({ dt }) => { knot.rotation.y += dt * 0.4; knot.rotation.x += dt * 0.2; });
  example.app.on("render", () => { example.render(scene, camera); });
  await example.run();
} finally {
  await example.dispose();
}
