import { Key } from "../../index.ts";
import { createExample } from "../shared/application.ts";

const example = await createExample("window lifecycle", { width: 640, height: 400 });
try {
  const { window, context, device } = example;
  let dirty = true;
  let confirmation = false;
  let large = false;
  let alive = true;
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  example.defer(() => { alive = false; clearTimeout(showTimer); });
  function afterInput(action: () => void) {
    queueMicrotask(() => { if(alive && !window.shouldClose) action(); });
  }
  function title() {
    window.setTitle(confirmation
      ? "Unsaved work: S saves and closes; C cancels"
      : `hostframe lifecycle ${dirty ? "[unsaved]" : "[saved]"} — R resize, P move, H hide briefly`);
  }
  title();
  window.on("closeRequest", event => {
    if(!dirty) return;
    // Cancel synchronously, then offer a decision outside the callback. A real
    // editor can await its save dialog before calling the force path requestClose.
    event.preventDefault();
    confirmation = true;
    // Runtime controls retain their native guards in all input/lifecycle listeners.
    afterInput(title);
  });
  window.on("key", event => {
    if(event.action !== "press") return;
    const key = event.key;
    if(key === Key.S) {
      dirty = false; // Replace with a successful save before closing in a real editor.
      if(confirmation) window.requestClose();
      else afterInput(title);
    }
    if(key === Key.C) { confirmation = false; afterInput(title); }
    if(key === Key.D) { dirty = true; afterInput(title); }
    if(key === Key.R) {
      afterInput(() => {
        large = !large;
        window.setSize(large ? 880 : 640, large ? 520 : 400);
      });
    }
    if(key === Key.P) afterInput(() => { window.setPosition(120, 100); });
    if(key === Key.H) {
      afterInput(() => {
        window.setVisible(false);
        clearTimeout(showTimer);
        showTimer = setTimeout(() => { if(alive && !window.shouldClose) window.setVisible(true); }, 1000);
      });
    }
  });
  window.on("metrics", ({ metrics }) => { console.log("Client units / framebuffer pixels:", metrics); });
  window.on("minimize", () => { console.log("Minimized; events still progress"); });
  window.on("restore", () => { console.log("Restored"); });
  window.on("render", () => {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: confirmation ? [0.7, 0.18, 0.04, 1] : dirty ? [0.12, 0.25, 0.6, 1] : [0.05, 0.45, 0.22, 1],
      loadOp: "clear",
      storeOp: "store"
    }] });
    pass.end();
    device.queue.submit([encoder.finish()]);
  });
  console.log("Use the window manager close button or Alt+F4 for the unsaved-work flow. S saves, C cancels, D marks dirty. Q/Escape force-close.");
  await example.run();
} finally {
  await example.dispose();
}
