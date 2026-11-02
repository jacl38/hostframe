import { Color, DirectionalLight, HemisphereLight, IcosahedronGeometry, InstancedMesh, MeshStandardMaterial, Object3D, PerspectiveCamera, Scene } from "three/webgpu";
import { createThreeExample } from "./adapter.ts";
import { orbitCamera } from "./orbit.ts";

const example = await createThreeExample("instancing / 1600 objects");
try {
  const scene = new Scene();
  scene.background = new Color(0x101827);
  const camera = new PerspectiveCamera(45, 1.5, 0.1, 150);
  camera.position.set(25, 28, 35);
  orbitCamera(example.window, camera);
  scene.add(new HemisphereLight(0xc8e7ff, 0x303050, 2));
  const light = new DirectionalLight(0xffffff, 4);
  light.position.set(10, 20, 10);
  scene.add(light);
  const geometry = new IcosahedronGeometry(0.35, 0);
  const material = new MeshStandardMaterial({ roughness: 0.35, metalness: 0.3 });
  const mesh = new InstancedMesh(geometry, material, 1600);
  const transform = new Object3D();
  const color = new Color();
  for(let i = 0; i < mesh.count; i++) mesh.setColorAt(i, color.setHSL(i / mesh.count, 0.7, 0.5));
  scene.add(mesh);
  example.defer(() => { mesh.dispose(); geometry.dispose(); material.dispose(); });
  let time = 0;
  example.app.on("fixedUpdate", ({ dt }) => { time += dt; });
  example.app.on("render", () => {
    for(let i = 0; i < mesh.count; i++) {
      const x = (i % 40 - 19.5) * 0.9;
      const z = (Math.floor(i / 40) - 19.5) * 0.9;
      transform.position.set(x, Math.sin(Math.hypot(x, z) * 0.4 - time * 2) * 1.5, z);
      transform.rotation.set(time * 0.4, time + i, 0);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    // The wave stays within this conservative bound, independent of animation.
    mesh.frustumCulled = false;
    example.render(scene, camera);
  });
  await example.run();
} finally {
  await example.dispose();
}
