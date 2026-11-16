import { $ } from "bun";
import { createHash } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyChecksum } from "./dependencies.ts";
import { buildRoot, lock, root } from "./release.ts";

export const windowsDxc = lock.dependencies.dxc;
export const windowsDxcFiles = {
  "bin/x64/dxcompiler.dll": "dxcompiler.dll",
  "bin/x64/dxil.dll": "dxil.dll",
  "LICENCE-MIT.txt": "DXC-LICENSE-MIT.txt",
  "LICENSE-LLVM.txt": "DXC-LICENSE-LLVM.txt",
  "LICENSE-MS.txt": "DXC-LICENSE-MS.txt"
} as const;

export function assertDxcFile(source: keyof typeof windowsDxcFiles, bytes: Uint8Array) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if(actual !== windowsDxc.files[source]) throw new Error(`DXC file checksum mismatch: ${source}`);
}

async function downloadDxc() {
  const directory = resolve(buildRoot, "downloads");
  const path = resolve(directory, windowsDxc.name);
  await mkdir(directory, { recursive: true });
  if(!await Bun.file(path).exists()) {
    const partial = path + ".partial";
    try {
      await $`curl --fail --location --silent --show-error --retry 2 --connect-timeout 20 --max-time 180 --output ${partial} ${windowsDxc.url}`;
      await verifyChecksum(partial, windowsDxc.sha256);
      await rename(partial, path);
    } finally {
      await rm(partial, { force: true });
    }
  }
  await verifyChecksum(path, windowsDxc.sha256);
  return path;
}

export async function prepareWindowsDxc() {
  const archive = await downloadDxc();
  for(const [source, destination] of Object.entries(windowsDxcFiles)) {
    const child = Bun.spawn(["tar", "-xOf", archive, source], { stdout: "pipe", stderr: "inherit", timeout: 30_000 });
    const bytes = new Uint8Array(await new Response(child.stdout).arrayBuffer());
    if(await child.exited !== 0) throw new Error(`Unable to extract ${source} from DXC archive.`);
    assertDxcFile(source as keyof typeof windowsDxcFiles, bytes);
    await Bun.write(resolve(root, "dist", destination), bytes);
  }
}
