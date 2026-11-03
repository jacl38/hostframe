import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";

// Run hardware diagnostics in a private KWin/Xwayland session. The compositor
// must have its own cache as well as config: sharing ksycoca with another KDE
// session can repeatedly rebuild the database on the compositor's main thread.
const root = resolve(import.meta.dir, "../..");
const [first, ...args] = process.argv.slice(2);

if(first === "--child") {
  const directory = args[0]!;
  const command: string[] = await Bun.file(join(directory, "command.json")).json();
  await Bun.write(join(directory, "display.json"), JSON.stringify({
    DISPLAY: process.env.DISPLAY,
    XAUTHORITY: process.env.XAUTHORITY ?? "",
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS
  }, null, 2));
  const child = Bun.spawn(command, {
    cwd: root,
    stdout: Bun.file(join(directory, "command.log")),
    stderr: Bun.file(join(directory, "command.stderr"))
  });
  const code = await child.exited;
  await Bun.write(join(directory, "result.json"), JSON.stringify({ code, signal: child.signalCode }));
  process.exitCode = code;
} else {
  assert.ok(first, "Usage: bun scripts/benchmarks/display.ts <command> [arguments...]");
  for(const tool of ["dbus-run-session", "kwin_wayland", first]) {
    assert.ok(Bun.which(tool), `Missing executable: ${tool}`);
  }
  const output = join(root, "build/benchmarks");
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(join(output, "display-"));
  for(const name of ["runtime", "config", "cache"]) await mkdir(join(directory, name));
  await chmod(join(directory, "runtime"), 0o700);
  await Bun.write(join(directory, "command.json"), JSON.stringify([first, ...args]));
  const env = {
    ...process.env,
    XDG_RUNTIME_DIR: join(directory, "runtime"),
    XDG_CONFIG_HOME: join(directory, "config"),
    XDG_CACHE_HOME: join(directory, "cache"),
    KWIN_COMPOSE: "O2",
    DAWNNODE_BACKEND: process.env.DAWNNODE_BACKEND ?? "vulkan",
    VK_DRIVER_FILES: process.env.VK_DRIVER_FILES ?? "/usr/share/vulkan/icd.d/intel_icd.x86_64.json",
    HOSTFRAME_EXPECT_VENDOR: process.env.HOSTFRAME_EXPECT_VENDOR ?? "intel"
  };
  Reflect.deleteProperty(env, "DISPLAY");
  Reflect.deleteProperty(env, "WAYLAND_DISPLAY");
  // KWin parses this argument into a command; Bun.spawn itself uses no shell.
  function quote(value: string) { return `'${value.replaceAll("'", "'\\''")}'`; }
  const session = [process.execPath, import.meta.path, "--child", directory].map(quote).join(" ");
  const timeout = Number(process.env.HOSTFRAME_DISPLAY_TIMEOUT_MS ?? 120_000);
  assert.ok(Number.isSafeInteger(timeout) && timeout > 0, "HOSTFRAME_DISPLAY_TIMEOUT_MS must be a positive integer");
  console.log(`Diagnostic display evidence: ${directory}`);
  const compositor = Bun.spawn([
    "dbus-run-session", "--", "kwin_wayland",
    "--virtual", "--width", "1280", "--height", "960", "--scale", "1", "--output-count", "1",
    "--xwayland", "--socket", "hostframe-benchmark",
    "--no-lockscreen", "--no-global-shortcuts", "--no-kactivities",
    "--exit-with-session", session
  ], {
    cwd: root,
    env,
    stdout: Bun.file(join(directory, "compositor.log")),
    stderr: Bun.file(join(directory, "compositor.stderr")),
    timeout
  });
  const code = await compositor.exited;
  const resultFile = Bun.file(join(directory, "result.json"));
  assert.ok(await resultFile.exists(), `Diagnostic session failed (exit ${code}); see ${directory}`);
  const result: { code: number } = await resultFile.json();
  console.log(await Bun.file(join(directory, "command.log")).text());
  if(result.code !== 0) console.error(await Bun.file(join(directory, "command.stderr")).text());
  process.exitCode = result.code;
}
