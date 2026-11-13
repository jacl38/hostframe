import { Color3, Color4, DirectionalLight, FreeCamera, HemisphericLight, MeshBuilder, Scene, ShadowGenerator, StandardMaterial, Vector3 } from "@babylonjs/core";
import { Key } from "../../index.ts";
import { createBabylonExample } from "./adapter.ts";
import { orbitCamera } from "./orbit.ts";

const example = await createBabylonExample("cubes");
try {
  const scene = new Scene(example.engine);
  example.defer(() => scene.dispose());
  scene.detachControl();
  scene.clearColor = new Color4(0.04, 0.06, 0.09, 1);
  const camera = new FreeCamera("camera", new Vector3(5, 4, 6), scene);
  const updateCamera = orbitCamera(example.window, camera, new Vector3(0, 0.7, 0));
  const fill = new HemisphericLight("fill", Vector3.Up(), scene);
  fill.intensity = 0.65;
  const light = new DirectionalLight("sun", new Vector3(-1, -2, 1), scene);
  light.position.set(5, 8, -5);
  light.intensity = 1.2;
  light.shadowMinZ = 1;
  light.shadowMaxZ = 25;
  const shadows = new ShadowGenerator(1024, light);
  shadows.usePercentageCloserFiltering = true;
  shadows.normalBias = 0.02;
  const floor = MeshBuilder.CreateGround("floor", { width: 10, height: 10 }, scene);
  const floorMaterial = new StandardMaterial("slate", scene);
  floorMaterial.diffuseColor = new Color3(0.17, 0.2, 0.24);
  floor.material = floorMaterial;
  floor.receiveShadows = true;
  const blue = new StandardMaterial("blue", scene);
  blue.diffuseColor = new Color3(0.12, 0.48, 0.8);
  const source = MeshBuilder.CreateBox("cube", { size: 0.8 }, scene);
  source.material = blue;
  source.isVisible = false;
  const cubes = Array.from({ length: 8 }, (_, i) => {
    const cube = source.createInstance(`cube ${i}`);
    const angle = i / 8 * Math.PI * 2;
    cube.position.set(Math.cos(angle) * 2.2, 0.5, Math.sin(angle) * 2.2);
    shadows.addShadowCaster(cube);
    return cube;
  });
  const sphere = MeshBuilder.CreateSphere("sphere", { diameter: 1.3, segments: 24 }, scene);
  const copper = new StandardMaterial("copper", scene);
  copper.diffuseColor = new Color3(0.85, 0.3, 0.1);
  sphere.material = copper;
  sphere.position.y = 1.1;
  shadows.addShadowCaster(sphere);
  let time = 0;
  let paused = false;
  example.window.on("key", event => {
    if(event.action === "press" && event.key === Key.SPACE) paused = !paused;
  });
  example.app.on("fixedUpdate", event => { if(!paused) time += event.dt; });
  example.window.on("render", () => {
    cubes.forEach((cube, i) => {
      cube.rotation.y = time * 0.5 + i;
      cube.position.y = 0.6 + Math.sin(time * 1.5 + i) * 0.15;
    });
    sphere.position.y = 1.1 + Math.sin(time) * 0.2;
    updateCamera();
    example.render(scene);
  });
  console.log("Left drag orbits; wheel zooms; Space pauses.");
  await example.run();
} finally {
  await example.dispose();
}
