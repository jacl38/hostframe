import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { OIDNDenoiser, WebGPUPathTracer } from "three-gpu-pathtracer/webgpu";
import type { WebGPURenderer } from "three/webgpu";

export function createPathTracer(renderer: WebGPURenderer) {
  const tracer = new WebGPUPathTracer(renderer);
  // Version 0.0.27 omits this method from its declarations. The upstream Three
  // example selects it too: the wavefront backend currently emits invalid WGSL
  // for arrays of structures containing runtime-sized arrays in Three r187.
  if(!("useMegakernel" in tracer) || typeof tracer.useMegakernel !== "function") {
    tracer.dispose();
    throw new Error("The pinned path tracer must provide its megakernel backend");
  }
  tracer.useMegakernel(true);
  tracer.maxBounces = 6;
  tracer.renderScale = 0.75;
  tracer.lowResScale = 0.3;
  tracer.renderDelay = 150;
  tracer.fadeDuration = 250;
  tracer.frameBudget = 150_000;
  return tracer;
}

export async function createPathDenoiser() {
  // The published unbundled entry has extensionless imports, which Node cannot
  // resolve. Its bundled ESM entry works in both runtimes; retain upstream types.
  const require = createRequire(import.meta.url);
  const bundle = new URL("../dist/oidn.js", pathToFileURL(require.resolve("oidn-web")));
  const oidn: typeof import("oidn-web") = await import(bundle.href);
  const weights = await readFile(new URL("./assets/rt-hdr-alb-nrm-small.tza", import.meta.url));
  const buffer = weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength);
  const initialized: Array<ReturnType<typeof oidn.initUNetFromBuffer>> = [];
  const denoiser = new OIDNDenoiser({
    auxWeightsUrl: "local:oidn-small",
    initUNetFromURL(_url: string, backend: Parameters<typeof oidn.initUNetFromBuffer>[1], options: Parameters<typeof oidn.initUNetFromBuffer>[2]) {
      const network = oidn.initUNetFromBuffer(buffer, backend, options);
      initialized.push(network);
      return network;
    },
    maxTileSize: 128,
    dynamicTile: false
  });
  return {
    // Present completed frames together. The library's partial output can have
    // visible tile seams/unwritten borders; retain its actual resource ownership.
    denoiser: new Proxy(denoiser, {
      get(target, property, receiver) {
        if(property === "texture" && !target.complete) return null;
        return Reflect.get(target, property, receiver);
      }
    }),
    // The tracer owns the denoiser. Wait for in-flight GPU/network setup before
    // allowing the shared example to dispose its renderer and caller-owned device.
    async drain() {
      await Promise.all(initialized);
    }
  };
}
