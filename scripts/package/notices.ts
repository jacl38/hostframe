import { resolve } from "node:path";
import { dawnRoot, getEngine, lock, root } from "../native/release.ts";

/** Notices for redistributed native code, including dependencies in the pinned engine. */
export async function writeNotices() {
  const licenses: Array<[string, string]> = [
    ["Dawn and Tint (binding modified with GPUDevice::GetNativeDevice)", resolve(dawnRoot, "LICENSE")],
    ["Abseil", resolve(root, "scripts/package/licenses/abseil.txt")],
    ["SPIRV-Tools", resolve(dawnRoot, "third_party/spirv-tools/LICENSE")],
    ["SPIRV-Headers", resolve(dawnRoot, "third_party/spirv-headers/LICENSE")],
    ["Vulkan-Headers", resolve(dawnRoot, "third_party/vulkan-headers/LICENSE.txt")],
    ["Vulkan-Utility-Libraries", resolve(root, "scripts/package/licenses/vulkan-utility-libraries.txt")],
    ["WebGPU-Headers", resolve(dawnRoot, "third_party/webgpu-headers/LICENSE")],
    ["GLFW", resolve(dawnRoot, "third_party/glfw3/src/LICENSE.md")],
    ["node-api-headers", resolve(dawnRoot, "third_party/node-api-headers/LICENSE")],
    ["node-addon-api (Dawn)", resolve(dawnRoot, "third_party/node-addon-api/LICENSE.md")],
    ["node-addon-api (hostframe)", resolve(root, "node_modules/node-addon-api/LICENSE.md")],
    ["nobind17 (adapted for synchronous Bun compatibility)", resolve(root, "node_modules/nobind17/LICENSE")]
  ];
  let notices = `hostframe native third-party notices\n\nDawn release: ${lock.release}\nDawn revision: ${lock.revision}\nEngine archive SHA-256: ${getEngine().sha256}\n`;
  for(const [name, path] of licenses) {
    notices += `\n${"=".repeat(72)}\n${name}\n${"=".repeat(72)}\n\n${await Bun.file(path).text()}\n`;
  }
  await Bun.write(resolve(root, "dist/THIRD_PARTY_NOTICES.txt"), notices);
}
