import { $ } from "bun";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { buildNative, checkBuild, checkPrerequisites } from "./native/build";
import { prepareDependencies } from "./native/dependencies";
import { generateBindings } from "./native/generate";
import { buildRoot, root } from "./native/release";

export async function withBuildLock(action: () => Promise<void>) {
  await mkdir(buildRoot, { recursive: true });
  const lock = resolve(buildRoot, ".lock");
  try {
    await mkdir(lock);
  } catch (error) {
    if(error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(`Another native setup/build is running. If a previous run was interrupted, remove ${lock} and retry.`);
    }
    throw error;
  }
  try {
    await action();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

async function verify(presentation: boolean) {
  const checks = [
    ["node", resolve(root, "packages/native/test/compute.mjs")],
    ["bun", resolve(root, "packages/native/test/compute.mjs")]
  ];
  if(presentation) checks.push([resolve(buildRoot, "cmake/native_presentation_check")]);
  for(const command of checks) {
    // Verification needs bounded process lifetimes and signal diagnostics.
    const child = Bun.spawn(command, { cwd: root, stdout: "inherit", stderr: "inherit", timeout: 30_000 });
    const code = await child.exited;
    if(code !== 0) throw new Error(`${command[0]} verification failed (exit ${code}, signal ${child.signalCode || "none"}).`);
  }
}

async function main() {
  const [command, ...flags] = process.argv.slice(2);
  const usage = "Usage: bun scripts/native.ts <setup|build|check-build|verify> [--presentation]";
  if(command === "--help") {
    console.log(usage);
    return;
  }
  if(!command || !["setup", "build", "check-build", "verify"].includes(command) || flags.some(flag => command !== "verify" || flag !== "--presentation")) {
    throw new Error(usage);
  }
  if(command === "verify") return verify(flags.includes("--presentation"));
  if(command === "check-build") return checkBuild();
  checkPrerequisites(command === "setup");
  await withBuildLock(async () => {
    if(command === "setup") {
      await prepareDependencies();
      await generateBindings();
    }
    await buildNative();
  });
}

if(import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    if(error instanceof $.ShellError && error.stderr.length > 0) console.error(error.stderr.toString().trim());
    process.exitCode = 1;
  }
}
