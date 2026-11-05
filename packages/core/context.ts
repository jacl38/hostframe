import type { NativeWindow } from "../native/bridge.ts";

/** Native WebGPU presentation context. Frame textures are valid only during synchronous rendering. */
export class WindowGPUContext {
  #native: NativeWindow;
  #configuration: GPUCanvasConfiguration | null = null;
  #texture: GPUTexture | undefined;
  #dispatch: (() => undefined) | undefined;
  #frameCallback: Parameters<NativeWindow["renderFrame"]>[0];

  /** @internal Obtained through Window.getContext("webgpu"). */
  constructor(native: NativeWindow) {
    this.#native = native;
    this.#frameCallback = this.#renderFrame.bind(this);
  }

  /** Standard adapter options, restricted to adapters capable of presenting to this window. */
  async requestAdapter(options: GPURequestAdapterOptions = {}) {
    return this.#native.requestAdapter(options);
  }

  configure(configuration: GPUCanvasConfiguration) {
    try {
      this.#configuration = this.#native.configure(configuration);
    } finally {
      // Cleanup timeouts release the native configuration before throwing;
      // validation/reentrancy failures leave the previous configuration intact.
      if(!this.#native.configured) this.#configuration = null;
    }
  }

  unconfigure() {
    try {
      this.#native.unconfigure();
    } finally {
      if(!this.#native.configured) this.#configuration = null;
    }
  }

  getConfiguration() {
    this.#requireAlive();
    const configuration = this.#configuration;
    return configuration ? {
      ...configuration,
      viewFormats: [...configuration.viewFormats ?? []],
      toneMapping: { ...configuration.toneMapping }
    } : null;
  }

  getCurrentTexture() {
    this.#requireAlive();
    if(!this.#texture) throw new Error("getCurrentTexture() requires an active window render event");
    return this.#texture;
  }

  /** @internal One native frame scope surrounds the entire render dispatch. */
  render(dispatch: () => undefined) {
    this.#requireAlive();
    if(!this.#configuration) return;
    if(this.#dispatch) throw new Error("Window is already rendering");
    this.#dispatch = dispatch;
    try {
      this.#native.renderFrame(this.#frameCallback);
    } finally {
      this.#dispatch = undefined;
    }
  }

  /** @internal Release JavaScript device references after native disposal. */
  release() {
    this.#configuration = null;
    this.#dispatch = undefined;
    this.#texture = undefined;
  }

  #renderFrame(texture: GPUTexture) {
    this.#texture = texture;
    try {
      return this.#dispatch!();
    } finally {
      this.#texture = undefined;
    }
  }

  #requireAlive() {
    if(this.#native.disposed) throw new Error("Window is disposed");
  }
}
