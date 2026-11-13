import type { FreeCamera, Vector3 } from "@babylonjs/core";
import { PointerButton } from "../../index.ts";
import type { Window } from "../../index.ts";

/** Uses native input rather than Babylon's DOM camera controls. */
export function orbitCamera(window: Window, camera: FreeCamera, target: Vector3) {
  let dragging = false;
  let theta = -0.65;
  let phi = 1.13;
  let radius = 8;
  window.on("pointerButton", event => {
    if(event.button === PointerButton.LEFT) dragging = event.action === "press";
  });
  window.on("focus", event => { if(!event.focused) dragging = false; });
  window.on("pointerMove", event => {
    if(!dragging) return;
    theta -= event.deltaX * 0.006;
    phi = Math.max(0.35, Math.min(1.48, phi + event.deltaY * 0.006));
  });
  window.on("scroll", event => { radius = Math.max(3, Math.min(18, radius * Math.exp(-event.deltaY * 0.1))); });
  return function update() {
    const azimuth = theta;
    camera.position.set(
      target.x + radius * Math.sin(phi) * Math.sin(azimuth),
      target.y + radius * Math.cos(phi),
      target.z + radius * Math.sin(phi) * Math.cos(azimuth)
    );
    camera.setTarget(target);
  };
}
