import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Color, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene } from "three/webgpu";
import { createThreeExample } from "../../examples/three/adapter.ts";

const execute = promisify(execFile);
const example = await createThreeExample("validation composition", { width: 320, height: 240 });
try {
  const { app, context, device, window } = example;
  context.configure({ device, format: app.gpu.getPreferredCanvasFormat(), usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const scene = new Scene();
  scene.background = new Color(1, 0, 0);
  const geometry = new PlaneGeometry(1, 1);
  const material = new MeshBasicMaterial({ color: new Color(0, 1, 0) });
  example.defer(() => geometry.dispose());
  example.defer(() => material.dispose());
  scene.add(new Mesh(geometry, material));
  const camera = new PerspectiveCamera(60, 1, 0.1, 10);
  camera.position.z = 2;
  const id = (await execute("xdotool", ["search", "--onlyvisible", "--pid", String(process.pid), "--name", "^hostframe three / validation composition$"], { timeout: 3000 })).stdout.trim();
  for(const [width, height] of [[320, 240], [480, 280], [256, 320]] as const) {
    await execute("xdotool", ["windowsize", "--sync", id, String(width), String(height)], { timeout: 3000 });
    const buffer = device.createBuffer({ size: 512, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    let rendered = false;
    const deadline = performance.now() + 4000;
    const off = window.on("render", () => {
      example.render(scene, camera);
      const texture = context.getCurrentTexture();
      if(texture.width !== width || texture.height !== height) return;
      const encoder = device.createCommandEncoder();
      for(const [offset, x, y] of [[0, 0, 0], [256, width / 2, height / 2]] as const) {
        encoder.copyTextureToBuffer({ texture, origin: [x, y] }, { buffer, offset, bytesPerRow: 256 }, [1, 1]);
      }
      device.queue.submit([encoder.finish()]);
      rendered = true;
      app.stop();
    });
    const offDeadline = app.on("fixedUpdate", () => { assert.ok(performance.now() < deadline, "Resized framebuffer did not arrive"); });
    try { await app.run({ maxFPS: 30 }); } finally { off(); offDeadline(); }
    assert.ok(rendered);
    await buffer.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(buffer.getMappedRange());
    const bgra = context.getConfiguration()!.format.startsWith("bgra");
    assert.deepEqual(Array.from(bytes.slice(0, 4)), bgra ? [0, 0, 255, 255] : [255, 0, 0, 255], "Background must survive half-float composition");
    assert.deepEqual(Array.from(bytes.slice(256, 260)), [0, 255, 0, 255], "Center geometry must survive composition and resize");
    buffer.unmap();
    buffer.destroy();
    console.log(`PASS ${process.versions.bun ? "bun" : "node"} composition pixels ${width}x${height}`);
  }
} finally {
  await example.dispose();
}
