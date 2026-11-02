import { readFileSync } from "node:fs";
import { Color, DoubleSide, Group, HalfFloatType, Mesh, MeshBasicMaterial, MeshBasicNodeMaterial, NoToneMapping, OrthographicCamera, PlaneGeometry, QuadMesh, RenderTarget, Scene, ShapeGeometry, Vector2 } from "three/webgpu";
import type { WebGPURenderer } from "three/webgpu";
import { texture } from "three/tsl";
import { FontLoader } from "three/addons/loaders/FontLoader.js";

const font = new FontLoader().parse(JSON.parse(readFileSync(new URL("./assets/helvetiker-regular.json", import.meta.url), "utf8")));

/** Vector typography rendered by Three itself; no canvas, DOM or image loader. */
export function createOverlay(renderer: WebGPURenderer, options: {
  index: string,
  title: string,
  subtitle: string,
  controls: string,
  detail: string,
  accent: number,
  ink?: number,
  muted?: number
}) {
  const scene = new Scene();
  const camera = new OrthographicCamera(0, 1200, 0, 800, -10, 10);
  const ink = new MeshBasicMaterial({ color: options.ink ?? 0xe8edf2, depthTest: false, depthWrite: false, toneMapped: false, side: DoubleSide });
  const muted = new MeshBasicMaterial({ color: options.muted ?? 0x77828e, depthTest: false, depthWrite: false, toneMapped: false, side: DoubleSide });
  const accent = new MeshBasicMaterial({ color: options.accent, depthTest: false, depthWrite: false, toneMapped: false, side: DoubleSide });
  const geometries = new Set<ShapeGeometry | PlaneGeometry>();
  function text(value: string, size: number, x: number, y: number, material = ink) {
    const geometry = new ShapeGeometry(font.generateShapes(value, size), 4);
    geometries.add(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.scale.y = -1;
    mesh.position.set(x, y, 0);
    return mesh;
  }
  function line(x: number, y: number, width: number, material = muted) {
    const geometry = new PlaneGeometry(width, 0.6);
    geometries.add(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x + width / 2, y, 0);
    scene.add(mesh);
  }
  scene.add(text(`${options.index}   /   NATIVE STUDIES`, 10, 44, 43, accent));
  scene.add(text(options.title, 43, 42, 105));
  scene.add(text(options.subtitle, 11, 44, 135, muted));
  scene.add(text("TS / DAWN", 14, 1042, 45));
  scene.add(text("THREE.JS   /   WEBGPU", 8, 1042, 63, muted));
  line(44, 724, 1112);
  line(44, 724, 44, accent);
  scene.add(text(options.controls, 10, 44, 758, muted));
  scene.add(text(options.detail, 10, 44, 695, muted));
  const status = new Group();
  scene.add(status);
  let previous = "";
  const viewport = new Vector2();
  const target = new RenderTarget(1200, 800, { type: HalfFloatType, samples: 4, depthBuffer: false });
  const image = texture(target.texture);
  const composite = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  // The transparent HUD target contains premultiplied color after rasterization.
  composite.colorNode = image.rgb.div(image.a.max(0.0001));
  composite.opacityNode = image.a;
  const quad = new QuadMesh(composite);
  let dirty = true;
  const clearColor = new Color();
  return {
    setStatus(value: string) {
      if(value === previous) return;
      previous = value;
      dirty = true;
      while(status.children.length) {
        const child = status.children[0]!;
        if(child instanceof Mesh) {
          geometries.delete(child.geometry);
          child.geometry.dispose();
        }
        status.remove(child);
      }
      const label = text(value, 11, 0, 695, accent);
      label.geometry.computeBoundingBox();
      label.position.x = 1156 - (label.geometry.boundingBox?.max.x ?? 0);
      status.add(label);
    },
    render() {
      renderer.getSize(viewport);
      // Keep labels legible at every aspect ratio without changing the scene camera.
      camera.right = 800 * viewport.x / viewport.y;
      camera.updateProjectionMatrix();
      scene.scale.x = camera.right / 1200;
      const autoClear = renderer.autoClear;
      const toneMapping = renderer.toneMapping;
      const renderTarget = renderer.getRenderTarget();
      renderer.getClearColor(clearColor);
      const clearAlpha = renderer.getClearAlpha();
      try {
        renderer.toneMapping = NoToneMapping;
        if(target.width !== viewport.x || target.height !== viewport.y) {
          target.setSize(viewport.x, viewport.y);
          dirty = true;
        }
        if(dirty) {
          renderer.setRenderTarget(target);
          renderer.setClearColor(0, 0);
          renderer.autoClear = true;
          renderer.render(scene, camera);
          dirty = false;
        }
        renderer.setRenderTarget(renderTarget);
        renderer.autoClear = false;
        // A fullscreen composite uses the same single-sample canvas attachment
        // as RenderPipeline, rather than resolving an unrelated MSAA buffer.
        quad.render(renderer);
      } finally {
        renderer.setRenderTarget(renderTarget);
        renderer.setClearColor(clearColor, clearAlpha);
        renderer.autoClear = autoClear;
        renderer.toneMapping = toneMapping;
      }
    },
    dispose() {
      for(const geometry of geometries) geometry.dispose();
      ink.dispose();
      muted.dispose();
      accent.dispose();
      composite.dispose();
      target.dispose();
    }
  };
}
