import { Application, Key, Modifier, PointerButton } from "hostframe";
import type { FixedWindow, InputEvent, InputState, PresentMode, Window, WindowOptions } from "hostframe";

// Compiled in a clean consumer without Bun or Node ambient types.
// @webgpu/types uses DOM base types even when the runtime is native.
export function usePublicAPI(app: Application, device: GPUDevice) {
  const options = { width: 320, height: 240, vsync: true } satisfies WindowOptions;
  const window: Window = app.createWindow(device, options);
  const legacy: FixedWindow = window;
  const mode: PresentMode = legacy.presentMode;
  const state: InputState = window.input;
  const gpu: GPU = app.gpu;
  window.on("key", event => {
    const input: InputEvent = event;
    const key: number = input.key;
    void key;
  });
  window.draw(texture => {
    const gpuTexture: GPUTexture = texture;
    void gpuTexture;
  });
  app.on("fixedUpdate", event => { void event.dt; });
  // @ts-expect-error Unknown event names must remain rejected after declaration bundling.
  window.on("invalid", () => {});
  // @ts-expect-error Options must retain their native field types.
  app.createWindow(device, { width: "320" });
  // @ts-expect-error Drawing must remain synchronous.
  window.draw(async () => {});
  return { mode, state, gpu, key: Key.W, button: PointerButton.LEFT, modifier: Modifier.SHIFT };
}
