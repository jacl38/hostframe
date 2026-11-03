import { $ } from "bun";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import manifest from "../../package.json";
import { root } from "../native/release.ts";

async function run(command: string[], cwd: string, env = process.env) {
  const child = Bun.spawn(command, { cwd, env, stdout: "inherit", stderr: "inherit", timeout: 30_000 });
  const code = await child.exited;
  if(code !== 0) throw new Error(`${command.join(" ")} failed (exit ${code}, signal ${child.signalCode || "none"}).`);
}

async function main() {
  const output = resolve(root, "build/package");
  await mkdir(output, { recursive: true });
  // Exercise npm's real prepack lifecycle and file selection.
  await $`npm pack --pack-destination ${output}`.cwd(root);
  const tarball = resolve(output, `${manifest.name}-${manifest.version}.tgz`);
  const files = (await $`tar -tzf ${tarball}`.text()).trim().split("\n");
  for(const required of ["LICENSE", "dist/index.js", "dist/index.d.ts", "dist/hostframe.node", "dist/THIRD_PARTY_NOTICES.txt"]) {
    assert.ok(files.includes(`package/${required}`), `Missing ${required} in tarball`);
  }
  for(const file of files) {
    assert.match(file, /^package\/(?:dist\/|docs\/|package\.json$|README\.md$|LICENSE$)/);
  }

  const temporary = await mkdtemp(resolve(tmpdir(), "hostframe-consumer-"));
  try {
    // Separate consumers prove both package managers install the actual tarball.
    for(const manager of ["npm", "bun"]) {
      const directory = resolve(temporary, manager);
      await mkdir(directory);
      await Bun.write(resolve(directory, "package.json"), JSON.stringify({
        private: true,
        type: "module",
        dependencies: { hostframe: `file:${tarball}` }
      }));
      if(manager === "npm") await $`npm install --ignore-scripts --no-audit --no-fund`.cwd(directory);
      else await $`bun install --ignore-scripts`.cwd(directory);
      await copyFile(resolve(root, "scripts/package/fixtures/runtime.ts"), resolve(directory, "consumer.ts"));
      await copyFile(resolve(root, "scripts/package/fixtures/types.ts"), resolve(directory, "types.ts"));
      await Bun.write(resolve(directory, "tsconfig.json"), JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "ES2022",
          lib: ["ES2022", "DOM"],
          module: "NodeNext",
          moduleResolution: "NodeNext",
          types: [],
          skipLibCheck: false
        },
        files: ["types.ts"]
      }));
      await run(["node", resolve(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"], directory);
      for(const runtime of ["node", "bun"]) {
        await run([runtime, "consumer.ts", "--no-display"], directory, { ...process.env, DISPLAY: "" });
        await run([runtime, "consumer.ts"], directory);
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  console.log(`Verified packed package in npm and Bun consumers: ${tarball}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
