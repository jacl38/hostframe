import assert from "node:assert/strict";

// GLFW sizes use screen coordinates; Retina framebuffers use device pixels.
export function assertFramebufferSize(texture: GPUTexture, width: number, height: number) {
  const scale = texture.width / width;
  assert.ok(Number.isInteger(scale) && scale >= 1);
  assert.equal(texture.height, height * scale);
  if(process.platform === "linux") assert.equal(scale, 1);
}
