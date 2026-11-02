import { DataTexture, DataUtils, EquirectangularReflectionMapping, HalfFloatType, LinearFilter, LinearSRGBColorSpace, RGBAFormat } from "three/webgpu";

/** CPU-authored HDR softboxes work with both raster lighting and the path tracer. */
export function createStudioEnvironment() {
  const width = 512;
  const height = 256;
  const pixels = new Float32Array(width * height * 4);
  const panels = [
    { azimuth: -0.8, elevation: 0.7, width: 0.45, height: 0.6, intensity: 9, tint: [1, 0.89, 0.73] },
    { azimuth: 2.3, elevation: 0.35, width: 0.28, height: 0.8, intensity: 6, tint: [0.71, 0.85, 1] },
    { azimuth: 0.8, elevation: 1.1, width: 0.7, height: 0.3, intensity: 5, tint: [1, 0.97, 0.91] }
  ];
  for(let y = 0; y < height; y++) {
    const elevation = (0.5 - y / (height - 1)) * Math.PI;
    for(let x = 0; x < width; x++) {
      const azimuth = (x / (width - 1) - 0.5) * Math.PI * 2;
      const base = 0.12 + 0.16 * Math.max(0, Math.sin(elevation));
      const offset = (y * width + x) * 4;
      pixels[offset] = base;
      pixels[offset + 1] = base * 0.96;
      pixels[offset + 2] = base * 0.9;
      pixels[offset + 3] = 1;
      for(const panel of panels) {
        const angle = Math.atan2(Math.sin(azimuth - panel.azimuth), Math.cos(azimuth - panel.azimuth));
        const value = panel.intensity * Math.exp(-Math.pow(angle / panel.width, 8) - Math.pow((elevation - panel.elevation) / panel.height, 8));
        for(let channel = 0; channel < 3; channel++) pixels[offset + channel]! += value * panel.tint[channel]!;
      }
    }
  }
  // Half floats remain filterable without optional float32-filterable support.
  const texture = new DataTexture(Uint16Array.from(pixels, value => DataUtils.toHalfFloat(value)), width, height, RGBAFormat, HalfFloatType);
  texture.mapping = EquirectangularReflectionMapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.colorSpace = LinearSRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
