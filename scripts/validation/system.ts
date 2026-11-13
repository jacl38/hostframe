import { root } from "../native/release.ts";

// Each case protects a connection owned by Hostframe. Gallery breadth and
// WebGPU feature coverage are deliberately independent of this gate.
async function check(contract: string, command: string[], completion?: string) {
  console.log(`CHECK ${contract}: ${command.join(" ")}`);
  const child = Bun.spawn(command, { cwd: root, stdout: "pipe", stderr: "pipe", timeout: 180_000 });
  const [code, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()
  ]);
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  if(code !== 0 || (completion !== undefined && !stdout.includes(completion))) {
    throw new Error(`${contract} failed (exit ${code}, signal ${child.signalCode || "none"})`);
  }
  console.log(`PASS ${contract}`);
}

const args = process.argv.slice(2);
if(args.some(arg => arg !== "--adapters-only")) throw new Error("Usage: bun scripts/validation/system.ts [--adapters-only]");
if(!args.includes("--adapters-only")) {
  await check("native ownership, frames, scheduling and input", ["bun", "scripts/native.ts", "verify", "--window-interactions"]);
}
for(const runtime of ["node", "bun"]) {
  // Three's output fixture exercises its real adapter, composition, resize,
  // stop/restart and teardown, so a second Three gallery smoke adds no boundary.
  await check(`${runtime} Three composition and resize`, [runtime, "scripts/validation/renderer-output.ts"]);
  await check(`${runtime} Babylon initialization, native output and cleanup`, [runtime, "scripts/validation/babylon-output.ts"]);
  for(const [contract, example] of [
    ["TypeGPU borrowed-device integration", "typegpu/triangle"],
    ["webgpu-utils native texture integration", "webgpu-utils/textures"]
  ]) {
    await check(`${runtime} ${contract}`, [runtime, `examples/${example}.ts`, "--frames=12"], "Rendered 12 frames");
  }
}
