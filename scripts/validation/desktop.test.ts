import { expect, test } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("desktop runner reports missing tools before attempting a display", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hostframe-prerequisites-"));
  try {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "desktop.ts"), process.execPath], {
      env: { ...process.env, PATH: directory }, stdout: "pipe", stderr: "pipe", timeout: 3000
    });
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text()
    ]);
    expect(await child.exited).not.toBe(0);
    expect(stderr).toContain("Missing validation prerequisite: Xvfb");
    const evidence = stdout.match(/Private X11 validation diagnostics: (.*)/)?.[1];
    expect(evidence).toBeDefined();
    expect(await Bun.file(join(evidence!, "startup.stderr")).text()).toMatch(/prerequisites: AssertionError.*Missing validation prerequisite: Xvfb/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("missing selected window manager preserves the startup cause in lifecycle diagnostics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hostframe-missing-wm-"));
  try {
    for(const name of ["Xvfb", "xauth", "dbus-run-session"]) await symlink(process.execPath, join(directory, name));
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "desktop-check.ts")], {
      env: { ...process.env, PATH: directory, HOSTFRAME_X11_WM: "openbox" }, stdout: "pipe", stderr: "pipe", timeout: 3000
    });
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text()
    ]);
    expect(await child.exited).not.toBe(0);
    expect(stderr).toContain("Missing validation prerequisite: openbox");
    const lifecycle = stdout.match(/Desktop lifecycle diagnostics: (.*)/)?.[1];
    expect(lifecycle).toBeDefined();
    expect(await Bun.file(join(lifecycle!, "failure.stderr")).text()).toContain("Missing validation prerequisite: openbox");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
