import type { NativeWindow } from "../native/bridge.ts";

type WindowGPUContextController = {
  render(dispatch: () => undefined): boolean,
  release(): void
};

const controllers = new WeakMap<WindowGPUContext, WindowGPUContextController>();

/** @internal Connects a Window-owned controller without exposing scheduling operations publicly. */
export function createWindowGPUContext(native: NativeWindow, isApplicationRunning: () => boolean) {
  const context = new WindowGPUContext(native, isApplicationRunning);
  return { context, controller: controllers.get(context)! };
}

/** @internal Returns the Window-owned controller for integration instrumentation. */
export function getWindowGPUContextController(context: WindowGPUContext) {
  const controller = controllers.get(context);
  if(!controller) throw new Error("WindowGPUContext has no controller");
  return controller;
}

/** Native WebGPU presentation context. Frame textures are valid only during synchronous rendering. */
export class WindowGPUContext {
  #native: NativeWindow;
  #isApplicationRunning: () => boolean;
  #configuration: GPUCanvasConfiguration | null = null;
  #texture: GPUTexture | undefined;
  #dispatch: (() => undefined) | undefined;
  #didDraw = false;
  #frameCallback: Parameters<NativeWindow["renderFrame"]>[0];

  /** @internal Obtained through Window.getContext("webgpu"). */
  constructor(native: NativeWindow, isApplicationRunning = () => false) {
    this.#native = native;
    this.#isApplicationRunning = isApplicationRunning;
    this.#frameCallback = this.#renderFrame.bind(this);
    controllers.set(this, {
      render: dispatch => this.#render(dispatch),
      release: () => this.#release()
    });
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
    if(!this.#texture) throw new Error("getCurrentTexture() requires an active window render or manual draw callback");
    return this.#texture;
  }

  /**
   * Acquires, draws, and presents one synchronous frame for a caller-owned loop.
   * Returns false when the context is unconfigured or no drawable texture is available.
   */
  draw(dispatch: () => undefined) {
    if(this.#isApplicationRunning()) throw new Error("Cannot draw while Application.run() is active");
    return this.#render(dispatch);
  }

  #render(dispatch: () => undefined) {
    this.#requireAlive();
    if(!this.#configuration) return false;
    if(this.#dispatch) throw new Error("Window is already rendering");
    this.#dispatch = dispatch;
    this.#didDraw = false;
    try {
      this.#native.renderFrame(this.#frameCallback);
      return this.#didDraw;
    } finally {
      this.#dispatch = undefined;
    }
  }

  #release() {
    this.#configuration = null;
    this.#dispatch = undefined;
    this.#texture = undefined;
    this.#didDraw = false;
  }

  #renderFrame(texture: GPUTexture) {
    this.#texture = texture;
    this.#didDraw = true;
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
