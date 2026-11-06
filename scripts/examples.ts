import { fileURLToPath } from "node:url";
import { examples } from "../examples/catalog.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const [name, ...args] = process.argv.slice(2);
if(name === "--verify") {
  if(args.some(arg => arg !== "--representative")) throw new Error("Usage: bun run examples:verify [--representative]");
  const selected = args.includes("--representative")
    ? examples.filter(example => ["vanilla/triangle", "three/materials", "typegpu/triangle", "webgpu-utils/textures"].includes(example))
    : examples;
  for(const runtime of ["bun", "node"]) {
    for(const example of selected) {
      const child = Bun.spawn([runtime, `examples/${example}.ts`, "--frames=12"], {
        cwd: root, stdout: "pipe", stderr: "pipe", timeout: 60_000
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()
      ]);
      if(code !== 0 || !stdout.includes("Rendered 12 frames")) {
        throw new Error(`${runtime} ${example} failed (${code})\n${stdout}\n${stderr}`);
      }
      console.log(`PASS ${runtime} ${example}`);
    }
  }
} else if(name === undefined || name === "--list") {
  console.log(`Usage: bun run example <source/name> [--frames=N] [--max-fps=N] [--no-vsync]\n\n${examples.join("\n")}`);
} else {
  const example = examples.find(example => example === name);
  if(!example) throw new Error(`Unknown example: ${name}. Run bun run example --list.`);
  const child = Bun.spawn([process.execPath, `examples/${example}.ts`, ...args], {
    cwd: root, stdout: "inherit", stderr: "inherit", stdin: "inherit"
  });
  process.exitCode = await child.exited;
}
