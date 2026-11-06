import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcess } from "./process.ts";

test("failures preserve both output streams and identify exit status", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hostframe-process-"));
  try {
    const prefix = join(directory, "failure");
    await expect(runProcess([process.execPath, "-e", "console.log(\"fixture output\"); console.error(\"fixture error\"); process.exit(7);"], { prefix, timeout: 3000 })).rejects.toThrow("exit 7");
    expect(await Bun.file(`${prefix}.log`).text()).toContain("fixture output");
    expect(await Bun.file(`${prefix}.stderr`).text()).toContain("fixture error");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("timeouts report failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hostframe-process-"));
  try {
    await expect(runProcess([process.execPath, "-e", "setInterval(() => {}, 1000);"], { prefix: join(directory, "timeout"), timeout: 100 })).rejects.toThrow("timeout true");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("cancellation kills ready descendants that ignore SIGTERM", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hostframe-process-"));
  let wrapper: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const ready = join(directory, "ready");
    const survived = join(directory, "survived");
    const tree = join(directory, "tree.ts");
    await Bun.write(tree, `if(process.argv[2]) {
      process.on("SIGTERM", () => { setTimeout(() => Bun.write(${JSON.stringify(survived)}, "alive"), 500); });
      await Bun.write(${JSON.stringify(ready)}, "ready");
      setInterval(() => {}, 1000);
    } else {
      Bun.spawn([process.execPath, import.meta.path, "child"], { stdout: "inherit", stderr: "inherit" });
      setInterval(() => {}, 1000);
    }`);
    const runner = join(directory, "runner.ts");
    await Bun.write(runner, `import { runProcess } from ${JSON.stringify(join(import.meta.dir, "process.ts"))}; await runProcess([process.execPath, ${JSON.stringify(tree)}], { prefix: ${JSON.stringify(join(directory, "cancel"))}, timeout: 10000 });`);
    wrapper = Bun.spawn([process.execPath, runner], { stdout: "ignore", stderr: "ignore" });
    const deadline = performance.now() + 4000;
    while(!await Bun.file(ready).exists()) {
      expect(performance.now()).toBeLessThan(deadline);
      await Bun.sleep(10);
    }
    wrapper.kill("SIGTERM");
    expect(await wrapper.exited).not.toBe(0);
    await Bun.sleep(700);
    expect(await Bun.file(survived).exists()).toBe(false);
  } finally {
    wrapper?.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});
