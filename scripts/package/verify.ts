import assert from "node:assert/strict";
import { copyFile, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import manifest from "../../package.json";
import { root } from "../native/release.ts";

async function run(command: string[], cwd: string, env = process.env, timeout = 30_000) {
  const child = Bun.spawn(command, { cwd, env, stdout: "inherit", stderr: "inherit", timeout });
  const code = await child.exited;
  if(code !== 0) throw new Error(`${command.join(" ")} failed (exit ${code}, signal ${child.signalCode || "none"}).`);
}

async function main() {
  const args = process.argv.slice(2);
  if(args.some(arg => arg !== "--headless")) throw new Error("Usage: bun scripts/package/verify.ts [--headless]");
  const headless = args.includes("--headless");
  const output = resolve(root, "build/package");
  await mkdir(output, { recursive: true });
  if(process.platform === "darwin" && process.arch === "arm64") {
    // A native addon cannot share the root package's Linux-only metadata.
    const staging = await mkdtemp(resolve(tmpdir(), "hostframe-package-"));
    try {
      await run(["bun", "run", "build"], root, { ...process.env, HOSTFRAME_PACKAGE_STAGING: "1" }, 300_000);
      for(const path of ["dist", "docs", "README.md", "LICENSE"]) {
        await cp(resolve(root, path), resolve(staging, path), { recursive: true });
      }
      const metadata = { ...manifest, os: ["darwin"], cpu: ["arm64"] };
      Reflect.deleteProperty(metadata, "libc");
      await Bun.write(resolve(staging, "package.json"), JSON.stringify(metadata, null, 2));
      await run(["npm", "pack", "--ignore-scripts", "--pack-destination", output], staging, process.env, 300_000);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  } else {
    // Exercise npm's real prepack lifecycle and file selection.
    await run(["npm", "pack", "--pack-destination", output], root, process.env, 300_000);
  }
  const tarball = resolve(output, `${manifest.name}-${manifest.version}.tgz`);
  const listing = Bun.spawn(["tar", "-tzf", tarball], { stdout: "pipe", stderr: "inherit", timeout: 10_000 });
  const contents = await new Response(listing.stdout).text();
  assert.equal(await listing.exited, 0, "Unable to list packed consumer tarball");
  const files = contents.trim().split("\n");
  for(const required of ["LICENSE", "dist/index.js", "dist/index.d.ts", "dist/globals.js", "dist/globals.d.ts", "dist/hostframe.node", "dist/THIRD_PARTY_NOTICES.txt"]) {
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
      if(manager === "npm") await run(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"], directory);
      else await run(["bun", "install", "--ignore-scripts"], directory);
      await copyFile(resolve(root, "scripts/package/fixtures/runtime.ts"), resolve(directory, "consumer.ts"));
      await copyFile(resolve(root, "scripts/package/fixtures/types.ts"), resolve(directory, "types.ts"));
      await copyFile(resolve(root, "scripts/package/fixtures/globals.ts"), resolve(directory, "globals.ts"));
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
        files: ["types.ts", "globals.ts"]
      }));
      await run(["node", resolve(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"], directory);
      for(const runtime of ["node", "bun"]) {
        await run([runtime, "globals.ts"], directory, { ...process.env, DISPLAY: "", WAYLAND_DISPLAY: "" });
        if(process.platform === "linux") await run([runtime, "consumer.ts", "--no-display"], directory, { ...process.env, DISPLAY: "" });
        if(!headless) {
          await run([runtime, "consumer.ts"], directory, {
            ...process.env,
            HOSTFRAME_CLOSE_REQUEST: resolve(root, "build/native/cmake/native_close_request")
          });
        }
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
