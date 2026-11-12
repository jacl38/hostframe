import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

// A separate Node process loads the freshly linked binary, bypassing require's
// addon cache. Write to a file so extraction also works with runtime shims.
const require = createRequire(import.meta.url);
const addon = require(process.argv[2]!);
const declarations: unknown = addon.__typescript;
const inputEventTypes: unknown = addon.__inputEventTypes;
if(typeof declarations !== "string") throw new Error("Addon has no nobind17 declarations.");
if(!Array.isArray(inputEventTypes) || inputEventTypes.length === 0 ||
   inputEventTypes.some(name => typeof name !== "string") || new Set(inputEventTypes).size !== inputEventTypes.length) {
  throw new Error("Addon has invalid input event metadata.");
}
await writeFile(process.argv[3]!, declarations);
await writeFile(process.argv[4]!, `export const inputEventTypes = Object.freeze(${JSON.stringify(inputEventTypes)} as const);\n`);

// Export only values present in both the pinned addon and upstream standard
// types. Experimental Dawn-only constructors have no public typed contract.
const typesPath = require.resolve("@webgpu/types/dist/index.d.ts");
const types = ts.createSourceFile(typesPath, await readFile(typesPath, "utf8"), ts.ScriptTarget.Latest);
const names = types.statements.filter(ts.isVariableStatement)
  .flatMap(statement => statement.declarationList.declarations)
  .map(declaration => declaration.name)
  .filter(ts.isIdentifier)
  .map(name => name.text)
  .filter(name => Object.hasOwn(addon.globals, name))
  .sort();
if(!names.includes("GPUBufferUsage") || !names.includes("GPU")) throw new Error("Incomplete WebGPU globals.");
const globalsOutput = process.argv[5]!;
const bridge = relative(dirname(process.argv[6]!), resolve(import.meta.dirname, "../../packages/native/bridge.ts")).replaceAll("\\", "/");
await writeFile(globalsOutput, [
  `import { webGPUGlobals } from ${JSON.stringify(bridge.startsWith(".") ? bridge : `./${bridge}`)};`,
  "",
  `export const { ${names.join(", ")} } = webGPUGlobals as Pick<typeof globalThis,`,
  `  ${names.map(name => JSON.stringify(name)).join(" | ")}>;`,
  ""
].join("\n"));
