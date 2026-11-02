import { tgpu } from "typegpu";
import { createExample } from "../shared/application.ts";

export async function createTypeGPUExample(title: string) {
  const example = await createExample(`typegpu / ${title}`);
  try {
    const root = tgpu.initFromDevice({ device: example.device });
    example.defer(() => root.destroy());
    return { ...example, root };
  } catch (error) {
    await example.dispose();
    throw error;
  }
}
