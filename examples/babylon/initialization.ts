import type { WindowGPUContext } from "../../index.ts";

/** Babylon 9.36 requests its own device through navigator.gpu. Scope this facade to initAsync. */
export async function withBabylonGPU<T>(context: WindowGPUContext, format: GPUTextureFormat, initialize: () => Promise<T>) {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const restoreFeatures: Array<() => void> = [];
  try {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
      userAgent: "hostframe Babylon example",
      gpu: {
        getPreferredCanvasFormat: () => format,
        async requestAdapter(options: GPURequestAdapterOptions) {
          const adapter = await context.requestAdapter(options);
          if(!adapter) return null;
          return {
            info: adapter.info,
            limits: adapter.limits,
            features: new Set(adapter.features),
            async requestDevice(descriptor: GPUDeviceDescriptor) {
              const device = await adapter.requestDevice(descriptor);
              // The pinned Dawn binding has a feature iterator but no forEach.
              // Shadow only this device's getter during Babylon initialization;
              // neither upstream prototypes nor other devices are modified.
              if(typeof device.features.forEach !== "function") {
                const previous = Object.getOwnPropertyDescriptor(device, "features");
                Object.defineProperty(device, "features", { configurable: true, value: new Set(device.features) });
                restoreFeatures.push(() => {
                  if(previous) Object.defineProperty(device, "features", previous);
                  else Reflect.deleteProperty(device, "features");
                });
              }
              return device;
            }
          };
        }
      }
    } });
    return await initialize();
  } finally {
    for(const restore of restoreFeatures.reverse()) restore();
    if(previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
}
