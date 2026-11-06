import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("desktop runner reports missing tools before attempting a display", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hostframe-prerequisites-"));
  try {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "desktop.ts"), process.execPath], {
      env: { ...process.env, PATH: directory }, stdout: "pipe", stderr: "pipe", timeout: 3000
    });
    const stderr = await new Response(child.stderr).text();
    expect(await child.exited).not.toBe(0);
    expect(stderr).toContain("Missing validation prerequisite: Xvfb");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
