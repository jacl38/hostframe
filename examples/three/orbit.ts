import { Vector3 } from "three/webgpu";
import type { PerspectiveCamera } from "three/webgpu";
import { PointerButton } from "../../index.ts";
import type { Window } from "../../index.ts";

/** Native input equivalent of a small orbit control: left drag rotates, wheel zooms. */
export function orbitCamera(window: Window, camera: PerspectiveCamera, target = new Vector3()) {
  const offset = camera.position.clone().sub(target);
  let radius = offset.length();
  let theta = Math.atan2(offset.x, offset.z);
  let phi = Math.acos(offset.y / radius);
  let dragging = false;
  // Input snapshots describe the end of a polled batch. Track ordered events so
  // a press, move and release in one batch still rotates the camera.
  window.on("pointerButton", event => {
    if(event.button === PointerButton.LEFT) dragging = event.action === "press";
  });
  window.on("focus", event => { if(!event.focused) dragging = false; });
  function update() {
    camera.position.set(
      target.x + radius * Math.sin(phi) * Math.sin(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * Math.sin(phi) * Math.cos(theta)
    );
    camera.lookAt(target);
  }
  window.on("pointerMove", event => {
    if(!dragging) return;
    theta -= event.deltaX * 0.008;
    phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi + event.deltaY * 0.008));
    update();
  });
  window.on("scroll", event => {
    radius = Math.max(2, Math.min(60, radius * Math.exp(-event.deltaY * 0.1)));
    update();
  });
  update();
  console.log("Left drag orbits; wheel zooms.");
}
