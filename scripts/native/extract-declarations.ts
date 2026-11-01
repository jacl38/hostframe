import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";

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
