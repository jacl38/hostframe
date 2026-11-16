import assert from "node:assert/strict";
import { Application } from "../../../index.ts";

if(process.platform !== "win32") throw new Error("Windows thread performance verification requires Windows");
const app = new Application();
try {
  // Warm the thread identity cache before measuring the repeated native boundary.
  app.pollEvents();
  const started = performance.now();
  for(let index = 0; index < 500; index++) app.pollEvents();
  const elapsed = performance.now() - started;
  // A per-call system-wide thread snapshot previously took over 15 seconds
  // for this loop. Leave substantial headroom for slower desktop machines.
  assert.ok(elapsed < 5000, `500 event polls took ${elapsed.toFixed(1)} ms`);
  console.log(`${process.versions.bun ? "Bun" : "Node.js"}: 500 Windows event polls in ${elapsed.toFixed(1)} ms.`);
} finally {
  app.dispose();
}
