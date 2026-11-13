import assert from "node:assert/strict";
import { Color3, Color4, FreeCamera, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { createBabylonExample } from "../../examples/babylon/adapter.ts";
import { withBabylonGPU } from "../../examples/babylon/initialization.ts";

const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const example = await createBabylonExample("validation output", { width: 320, height: 240 });
try {
  const { app, window, context, device, engine } = example;
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, "navigator"), navigatorBefore, "Initialization must restore navigator");
  const rawAdapter = await context.requestAdapter();
  assert.ok(rawAdapter);
  const featurePrototype = Object.getPrototypeOf(rawAdapter.features);
  const featureDescriptors = Object.getOwnPropertyDescriptors(featurePrototype);
  assert.equal(Object.getPrototypeOf(device.features), featurePrototype, "Initialization must restore native feature access");
  let abandoned: GPUDevice | undefined;
  const sentinel = Symbol("initialization failure");
  try {
    await assert.rejects(withBabylonGPU(context, app.gpu.getPreferredCanvasFormat(), async () => {
      const adapter = await navigator.gpu.requestAdapter();
      assert.ok(adapter);
      abandoned = await adapter.requestDevice();
      assert.equal(typeof abandoned.features.forEach, "function");
      throw sentinel;
    }), error => error === sentinel);
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, "navigator"), navigatorBefore);
    assert.ok(abandoned);
    assert.equal(Object.getPrototypeOf(abandoned.features), featurePrototype, "Failed initialization must restore device getters");
    assert.deepEqual(Reflect.ownKeys(featurePrototype), Reflect.ownKeys(featureDescriptors));
    for(const key of Reflect.ownKeys(featureDescriptors)) {
      assert.deepEqual(Object.getOwnPropertyDescriptor(featurePrototype, key), Reflect.get(featureDescriptors, key), "Feature shims must not mutate native prototypes");
    }
  } finally { abandoned?.destroy(); }

  const scene = new Scene(engine);
  scene.detachControl();
  example.defer(() => scene.dispose());
  scene.clearColor = new Color4(1, 0, 0, 1);
  const camera = new FreeCamera("camera", new Vector3(0, 0, -3), scene);
  camera.setTarget(Vector3.Zero());
  const plane = MeshBuilder.CreatePlane("plane", { size: 1 }, scene);
  const material = new StandardMaterial("green", scene);
  material.disableLighting = true;
  material.emissiveColor = Color3.Green();
  plane.material = material;
  await material.forceCompilationAsync(plane);
  const canvasContext = engine.getRenderingCanvas()!.getContext("webgpu") as GPUCanvasContext;
  assert.throws(() => canvasContext.getCurrentTexture(), /outside a Hostframe render event/);
  assert.throws(() => example.render(scene), /active.*render/);
  for(const [width, height] of [[320, 240], [480, 280], [256, 320]] as const) {
    window.setSize(width, height);
    const buffer = device.createBuffer({ size: 512, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const errors: string[] = [];
    function onError(event: GPUUncapturedErrorEvent) { errors.push(event.error.message); }
    device.addEventListener("uncapturederror", onError);
    const deadline = performance.now() + 5000;
    const off = window.on("render", () => {
      example.render(scene);
      assert.throws(() => canvasContext.getCurrentTexture(), /outside a Hostframe render event/, "The Babylon bridge must expire its frame reference after render returns");
      const texture = context.getCurrentTexture();
      if(texture.width !== width || texture.height !== height) return;
      const encoder = device.createCommandEncoder();
      for(const [offset, x, y] of [[0, 0, 0], [256, width / 2, height / 2]] as const) {
        encoder.copyTextureToBuffer({ texture, origin: [x, y] }, { buffer, offset, bytesPerRow: 256 }, [1, 1]);
      }
      device.queue.submit([encoder.finish()]);
      app.stop();
    });
    const offDeadline = app.on("fixedUpdate", () => { assert.ok(performance.now() < deadline, "Babylon resize did not arrive"); });
    try {
      await app.run({ maxFPS: 30 });
      assert.equal(engine.getRenderWidth(), width);
      assert.equal(engine.getRenderHeight(), height);
      await buffer.mapAsync(GPUMapMode.READ);
      const bytes = new Uint8Array(buffer.getMappedRange());
      const bgra = context.getConfiguration()!.format.startsWith("bgra");
      assert.deepEqual(Array.from(bytes.slice(0, 4)), bgra ? [0, 0, 255, 255] : [255, 0, 0, 255]);
      assert.deepEqual(Array.from(bytes.slice(256, 260)), [0, 255, 0, 255], "Babylon output must reach the native frame after resize");
      buffer.unmap();
      assert.deepEqual(errors, []);
    } finally {
      off();
      offDeadline();
      buffer.destroy();
      device.removeEventListener("uncapturederror", onError);
    }
    console.log(`PASS Babylon native output ${width}x${height}`);
  }
} finally {
  await example.dispose();
  await example.dispose();
}
assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, "navigator"), navigatorBefore);
assert.equal((await example.device.lost).reason, "destroyed", "Babylon must destroy its device after native teardown");

const failing = await createBabylonExample("validation cleanup failure", { width: 32, height: 32 });
const cleanupFailure = Symbol("cleanup failure");
failing.defer(() => { throw cleanupFailure; });
await assert.rejects(failing.dispose(), error => error instanceof AggregateError && error.errors.includes(cleanupFailure));
assert.equal((await failing.device.lost).reason, "destroyed", "Failed deferred cleanup must still destroy Babylon's device");
assert.throws(() => failing.app.createWindow(), /disposed/);
await failing.dispose();
console.log("PASS Babylon initialization isolation, native frame scope, resize and cleanup");
