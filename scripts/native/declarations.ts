import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { buildRoot, root } from "./release";

async function writeChanged(path: string, content: string) {
  const file = Bun.file(path);
  if(await file.exists() && await file.text() === content) return false;
  await Bun.write(path, content);
  return true;
}

/** Extract from the just-linked binary in a fresh process; never reuse a cached addon. */
export async function generateDeclarations(addon = resolve(buildRoot, "cmake/hostframe.node"), output = resolve(buildRoot, "generated/native.d.ts")) {
  await mkdir(resolve(output, ".."), { recursive: true });
  const temporary = await mkdtemp(resolve(output, "../.declarations-"));
  let declarations: string;
  let inputEvents: string;
  let webgpuGlobals: string;
  try {
    const extracted = resolve(temporary, "native.d.ts");
    const extractedEvents = resolve(temporary, "input-events.ts");
    const extractedGlobals = resolve(temporary, "webgpu-globals.ts");
    const child = Bun.spawn(["node", resolve(root, "scripts/native/extract-declarations.ts"), addon, extracted, extractedEvents, extractedGlobals, resolve(output, "../webgpu-globals.ts")], {
      stdout: "inherit",
      stderr: "inherit",
      timeout: 30_000
    });
    const code = await child.exited;
    if(code !== 0) throw new Error(`Native declaration extraction failed (${code}).`);
    declarations = await Bun.file(extracted).text();
    inputEvents = await Bun.file(extractedEvents).text();
    webgpuGlobals = await Bun.file(extractedGlobals).text();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  if(!declarations.includes("export class Application") || /\b(?:any|unknown)\b/.test(declarations.replace("Record<string, unknown>", ""))) {
    throw new Error("Incomplete native declarations; check typed registrations and boundary maps.");
  }
  const hash = createHash("sha256").update(new Uint8Array(await Bun.file(addon).arrayBuffer())).digest("hex");
  await mkdir(resolve(output, ".."), { recursive: true });
  const changed = await writeChanged(output, `// Generated from nobind17 registrations. Do not edit.\n// Addon SHA-256: ${hash}\n/// <reference types="@webgpu/types" />\n\n${declarations}`);
  const eventsChanged = await writeChanged(resolve(output, "../input-events.ts"),
    `// Generated from the native InputEvent variant. Do not edit.\n// Addon SHA-256: ${hash}\n\n${inputEvents}`);
  const globalsChanged = await writeChanged(resolve(output, "../webgpu-globals.ts"),
    `// Generated from Dawn globals and @webgpu/types. Do not edit.\n${webgpuGlobals}`);
  return changed || eventsChanged || globalsChanged;
}
