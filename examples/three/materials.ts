import { Color, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, SphereGeometry } from "three/webgpu";
import { createThreeExample } from "./adapter.ts";
import { orbitCamera } from "./orbit.ts";

const example = await createThreeExample("materials");
try {
  const scene = new Scene();
  scene.background = new Color(0x101827);
  const camera = new PerspectiveCamera(45, 1.5, 0.1, 100);
  camera.position.set(0, 0, 10);
  orbitCamera(example.window, camera);
  scene.add(new HemisphereLight(0xc8e7ff, 0x503040, 3));
  const light = new DirectionalLight(0xffffff, 5);
  light.position.set(3, 5, 4);
  scene.add(light);
  const geometry = new SphereGeometry(0.65, 32, 24);
  example.defer(() => geometry.dispose());
  for(let row = 0; row < 3; row++) {
    for(let column = 0; column < 5; column++) {
      const material = new MeshStandardMaterial({ color: 0x38bdf8, metalness: row / 2, roughness: 0.08 + column * 0.22 });
      example.defer(() => material.dispose());
      const mesh = new Mesh(geometry, material);
      mesh.position.set((column - 2) * 1.6, (1 - row) * 1.6, 0);
      scene.add(mesh);
    }
  }
  example.window.on("render", () => {
    example.render(scene, camera);
  });
  await example.run();
} finally {
  await example.dispose();
}
