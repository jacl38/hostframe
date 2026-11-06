import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runProcess, stopProcessGroup } from "./process.ts";

const root = resolve(import.meta.dir, "../..");
const [mode, ...args] = process.argv.slice(2);

async function command(argv: string[], timeout = 10_000) {
  const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", timeout });
  const [code, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()
  ]);
  assert.equal(code, 0, `${argv.join(" ")} failed (${code}, ${child.signalCode}): ${stderr}`);
  return stdout;
}

if(mode === "--session") {
  const directory = args[0]!;
  assert.ok(process.env.DISPLAY && process.env.XDG_CONFIG_HOME === join(directory, "config"), "Private display session required");
  const wm = Bun.spawn(["kwin_x11", "--replace"], {
    stdout: Bun.file(join(directory, "wm.log")), stderr: Bun.file(join(directory, "wm.stderr"))
  });
  try {
    const deadline = performance.now() + 15_000;
    while(!(await command(["xprop", "-root", "_NET_SUPPORTING_WM_CHECK"])).includes("window id")) {
      assert.ok(performance.now() < deadline, "EWMH window manager did not become ready");
      await delay(100);
    }
    const argv: string[] = await Bun.file(join(directory, "command.json")).json();
    await runProcess(argv, { prefix: join(directory, "command"), timeout: 900_000, pidFile: join(directory, "command.pid") });
    console.log(await Bun.file(join(directory, "command.log")).text());
  } catch (error) {
    await command(["import", "-window", "root", join(directory, "failure.png")]).catch(captureError => console.error(captureError));
    throw error;
  } finally {
    wm.kill("SIGKILL");
    await wm.exited;
  }
} else {
  assert.equal(process.platform, "linux", "Isolated desktop validation requires Linux/X11");
  assert.ok(mode, "Usage: bun scripts/validation/desktop.ts <command> [args...]");
  for(const tool of ["Xvfb", "xauth", "dbus-run-session", "kwin_x11", "xdotool", "xprop", "import", mode]) {
    assert.ok(Bun.which(tool), `Missing validation prerequisite: ${tool}`);
  }
  const output = join(root, "build/validation");
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(join(output, "desktop-"));
  for(const name of ["runtime", "config", "cache"]) await mkdir(join(directory, name));
  await chmod(join(directory, "runtime"), 0o700);
  await Bun.write(join(directory, "command.json"), JSON.stringify([mode, ...args]));
  const env: NodeJS.ProcessEnv = { ...process.env, XDG_RUNTIME_DIR: join(directory, "runtime"), XDG_CONFIG_HOME: join(directory, "config"), XDG_CACHE_HOME: join(directory, "cache"), QT_QPA_PLATFORM: "xcb" };
  for(const name of ["DISPLAY", "WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS", "SESSION_MANAGER"]) Reflect.deleteProperty(env, name);
  console.log(`Private X11 validation diagnostics: ${directory}`);
  env.HOSTFRAME_CAPTURE_DIRECTORY = join(directory, "captures");
  const authority = join(directory, "Xauthority");
  const cookie = randomBytes(16).toString("hex");
  await command(["xauth", "-f", authority, "add", ":0", ".", cookie]);
  const server = Bun.spawn(["Xvfb", "-displayfd", "1", "-screen", "0", "1280x960x24", "-nolisten", "tcp", "-auth", authority], {
    stdout: "pipe", stderr: Bun.file(join(directory, "xvfb.stderr"))
  });
  function stopServer() { server.kill("SIGKILL"); }
  process.on("SIGTERM", stopServer);
  process.on("SIGINT", stopServer);
  try {
    const reader = server.stdout.getReader();
    const timer = setTimeout(() => server.kill("SIGKILL"), 10_000);
    const first = await reader.read().finally(() => clearTimeout(timer));
    const display = new TextDecoder().decode(first.value).trim();
    assert.match(display, /^\d+$/, "Xvfb must allocate its own display");
    await command(["xauth", "-f", authority, "add", `:${display}`, ".", cookie]);
    await Bun.write(join(directory, "display.json"), JSON.stringify({ display: `:${display}`, serverPID: server.pid, width: 1280, height: 960 }));
    await runProcess(["dbus-run-session", "--", process.execPath, import.meta.path, "--session", directory], {
      cwd: root, env: { ...env, DISPLAY: `:${display}`, XAUTHORITY: authority }, prefix: join(directory, "session"), timeout: 960_000
    });
    console.log(await Bun.file(join(directory, "session.log")).text());
  } finally {
    process.off("SIGTERM", stopServer);
    process.off("SIGINT", stopServer);
    // D-Bus can exit before the nested session finishes its signal handler.
    // Reap the separately grouped command even when that session was killed.
    try {
      const commandPID = Bun.file(join(directory, "command.pid"));
      if(await commandPID.exists()) stopProcessGroup(Number(await commandPID.text()));
    } finally {
      stopServer();
      await server.exited;
    }
  }
}
