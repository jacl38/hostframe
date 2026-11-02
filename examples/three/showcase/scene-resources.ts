import { Light, Mesh } from "three/webgpu";
import type { BufferGeometry, Material, Scene } from "three/webgpu";

/** Scene geometry/materials are shared by many meshes, and released once. */
export function disposeScene(scene: Scene) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  scene.traverse(object => {
    if(object instanceof Light) object.dispose();
    if(!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    for(const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    if("dispose" in object && typeof object.dispose === "function") object.dispose();
  });
  for(const geometry of geometries) geometry.dispose();
  for(const material of materials) material.dispose();
}
