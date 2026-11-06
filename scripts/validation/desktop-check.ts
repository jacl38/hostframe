import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
await mkdir(join(root, "build/validation"), { recursive: true });
const directory = await mkdtemp(join(root, "build/validation/lifecycle-"));
console.log(`Desktop lifecycle diagnostics: ${directory}`);

function launch(args: string[], name: string) {
  return Bun.spawn([process.execPath, join(import.meta.dir, "desktop.ts"), ...args], {
    stdout: Bun.file(join(directory, `${name}.log`)),
    stderr: Bun.file(join(directory, `${name}.stderr`)), timeout: 30_000
  });
}

async function evidence(name: string) {
  const log = await Bun.file(join(directory, `${name}.log`)).text();
  const output = log.match(/Private X11 validation diagnostics: (.*)/)?.[1];
  const stderr = await Bun.file(join(directory, `${name}.stderr`)).text();
  const diagnostics = `Runner "${name}" did not reach display initialization; logs: ${directory}/${name}.{log,stderr}\n${log}\n${stderr}`;
  assert.ok(output, diagnostics);
  assert.ok(await Bun.file(join(output, "display.json")).exists(), diagnostics);
  const metadata: { serverPID: number } = await Bun.file(join(output, "display.json")).json();
  assert.throws(() => process.kill(metadata.serverPID, 0), "Xvfb must be reaped");
  assert.ok(await Bun.file(join(output, "command.log")).exists());
  assert.ok(await Bun.file(join(output, "command.stderr")).exists());
  return output;
}

const failure = launch([process.execPath, "-e", "console.log('failure evidence'); process.exit(7);"], "failure");
assert.notEqual(await failure.exited, 0);
const failedOutput = await evidence("failure");
assert.ok(await Bun.file(join(failedOutput, "failure.png")).exists(), "Command failure must capture the private display");
assert.match(await Bun.file(join(failedOutput, "command.log")).text(), /failure evidence/);

const ready = join(directory, "ready");
const survived = join(directory, "survived");
const fixture = join(directory, "tree.ts");
await Bun.write(fixture, `if(process.argv[2]) {
  process.on("SIGTERM", () => { setTimeout(() => Bun.write(${JSON.stringify(survived)}, "alive"), 500); });
  await Bun.write(${JSON.stringify(ready)}, String(process.pid));
  setInterval(() => {}, 1000);
} else {
  Bun.spawn([process.execPath, import.meta.path, "child"], { stdout: "inherit", stderr: "inherit" });
  setInterval(() => {}, 1000);
}`);
const cancellation = launch([process.execPath, fixture], "cancellation");
try {
  const deadline = performance.now() + 15_000;
  while(!await Bun.file(ready).exists()) {
    assert.ok(performance.now() < deadline, "Grandchild did not become ready");
    await Bun.sleep(20);
  }
  cancellation.kill("SIGTERM");
  assert.notEqual(await cancellation.exited, 0);
  await Bun.sleep(800);
  assert.equal(await Bun.file(survived).exists(), false, "SIGTERM-ignoring grandchild survived cleanup");
  await evidence("cancellation");
} finally {
  cancellation.kill("SIGTERM");
  await cancellation.exited;
}
console.log(`PASS desktop failure capture, cancellation and process-tree cleanup: ${directory}`);
