import { getProcessGPU, NativeApplication } from "../native/bridge.ts";

/** Owns one GLFW session and its fixed-size window. Construct on the process main thread. */
export class Application {
  /** Rooted until process exit: upstream child GPU objects do not retain their owner. */
  readonly gpu: GPU;
  #native: NativeApplication;

  constructor() {
    this.#native = new NativeApplication();
    try {
      this.gpu = getProcessGPU();
    } catch (error) {
      this.#native.dispose();
      throw error;
    }
  }

  /** One live 320×240 window, retaining a caller-owned device obtained through app.gpu. */
  createWindow(device: GPUDevice) {
    return this.#native.createWindow(device);
  }

  /**
   * Disposes windows before GLFW. Idempotent; forbidden inside draw. Devices remain caller-owned.
   * A GPU cleanup timeout destroys the stalled device and throws after cleanup.
   */
  dispose() {
    this.#native.dispose();
  }
}
