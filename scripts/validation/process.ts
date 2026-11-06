import { writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";

export function stopProcessGroup(pid: number, signal: NodeJS.Signals = "SIGKILL") {
  if(!Number.isSafeInteger(pid) || pid <= 1) throw new Error("Invalid validation process group");
  try { process.kill(-pid, signal); } catch (error) {
    if((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

/** Validation children own a POSIX process group; ordinary descendants inherit it. */
export function startProcess(argv: string[], options: {
  env?: NodeJS.ProcessEnv,
  cwd?: string,
  stdout?: "inherit" | ReturnType<typeof Bun.file>,
  stderr?: "inherit" | ReturnType<typeof Bun.file>
} = {}) {
  const child = Bun.spawn(argv, {
    ...options, stdin: "ignore", stdout: options.stdout ?? "inherit",
    stderr: options.stderr ?? "inherit", detached: true
  });
  function stop(signal: NodeJS.Signals = "SIGKILL") { stopProcessGroup(child.pid, signal); }
  return { child, stop };
}

export async function runProcess(argv: string[], options: {
  timeout: number,
  prefix: string,
  pidFile?: string,
  env?: NodeJS.ProcessEnv,
  cwd?: string
}) {
  await mkdir(dirname(options.prefix), { recursive: true });
  const managed = startProcess(argv, {
    env: options.env, cwd: options.cwd,
    stdout: Bun.file(`${options.prefix}.log`), stderr: Bun.file(`${options.prefix}.stderr`)
  });
  let timedOut = false;
  let interruptedSignal = false;
  let force: ReturnType<typeof setTimeout> | undefined;
  function terminate() {
    managed.stop("SIGTERM");
    force ??= setTimeout(() => managed.stop(), 2000);
  }
  const timer = setTimeout(() => { timedOut = true; terminate(); }, options.timeout);
  function interrupted() { interruptedSignal = true; terminate(); }
  process.on("SIGTERM", interrupted);
  process.on("SIGINT", interrupted);
  try {
    if(options.pidFile) writeFileSync(options.pidFile, String(managed.child.pid));
    const code = await managed.child.exited;
    if(code !== 0 || timedOut || interruptedSignal) {
      throw new Error(`${argv.join(" ")} failed (exit ${code}, signal ${managed.child.signalCode ?? "none"}, timeout ${timedOut}); logs: ${options.prefix}.{log,stderr}`);
    }
  } finally {
    clearTimeout(timer);
    clearTimeout(force);
    process.off("SIGTERM", interrupted);
    process.off("SIGINT", interrupted);
    managed.stop();
    if(options.pidFile) await rm(options.pidFile, { force: true });
  }
}
