import type { Example } from "./application.ts";

/** Recreate only the owned depth attachment; never retain the acquired surface. */
export function createDepthTexture(example: Example) {
  let depth: GPUTexture | undefined;
  example.defer(() => depth?.destroy());
  return (width: number, height: number) => {
    if(!depth || depth.width !== width || depth.height !== height) {
      depth?.destroy();
      depth = example.device.createTexture({
        size: [width, height], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT
      });
    }
    return depth.createView();
  };
}
