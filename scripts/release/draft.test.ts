import { expect, test } from "bun:test";
import { chmod, copyFile, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import { root } from "../native/release.ts";
import { sha256 } from "./assets.ts";

test("release CLI guards draft creation and macOS attachment with checksums", async () => {
  const directory = await realpath(await mkdtemp(resolve(tmpdir(), "hostframe-draft-")));
  try {
    for(const file of ["scripts/release/assets.ts", "scripts/native/release.ts", "scripts/native/dependencies.ts", "scripts/native/dawn.lock.json", "scripts/native/dxc.ts"]) {
      const destination = resolve(directory, file);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(resolve(root, file), destination);
    }
    await Bun.write(resolve(directory, "package.json"), JSON.stringify({
      name: "fixture",
      version: "1.2.3-alpha.1",
      type: "module"
    }));
    const filename = "fixture-1.2.3-alpha.1-linux-x64.tgz";
    const release = resolve(directory, "build/release");
    await mkdir(release, { recursive: true });
    const bytes = new TextEncoder().encode("verified tarball fixture");
    await Bun.write(resolve(release, filename), bytes);
    const checksums = resolve(release, "SHA256SUMS");
    await Bun.write(checksums, `${sha256(bytes)}  ${filename}\n`);
    await Bun.write(resolve(release, "release-notes.md"), "Fixture notes");
    const capture = resolve(directory, "arguments");
    const gh = resolve(directory, process.platform === "win32" ? "gh.cmd" : "gh");
    async function writeGh(view?: boolean) {
      if(process.platform === "win32") {
        const response = view === undefined ? "" : `if "%~2"=="view" (echo ${view} & exit /b 0)\r\n`;
        await Bun.write(gh, `@echo off\r\n${response}type nul > "%HOSTFRAME_TEST_GH_ARGS%"\r\n:args\r\nif "%~1"=="" exit /b 0\r\n>> "%HOSTFRAME_TEST_GH_ARGS%" echo(%~1\r\nshift\r\ngoto args\r\n`);
      } else {
        const response = view === undefined ? "" : `if [ "$2" = view ]; then echo ${view}; exit 0; fi\n`;
        await Bun.write(gh, `#!/bin/sh\n${response}printf "%s\\n" "$@" > "$HOSTFRAME_TEST_GH_ARGS"\n`);
        await chmod(gh, 0o755);
      }
    }
    await writeGh();
    const env = {
      ...process.env,
      PATH: `${directory}${delimiter}${process.env.PATH}`,
      ACT: "",
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
      GH_ENTERPRISE_TOKEN: "",
      GITHUB_ENTERPRISE_TOKEN: "",
      GH_CONFIG_DIR: resolve(directory, "gh-config"),
      GH_PROMPT_DISABLED: "1",
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/tags/v1.2.3-alpha.1",
      GITHUB_REPOSITORY: "example/repo",
      HOSTFRAME_TEST_GH_ARGS: capture
    };
    async function invoke() {
      const child = Bun.spawn([process.execPath, "scripts/release/assets.ts", "draft"], {
        cwd: directory, env, stdout: "pipe", stderr: "pipe", timeout: 10_000
      });
      const stderr = await new Response(child.stderr).text();
      return { code: await child.exited, stderr };
    }
    expect(await invoke()).toEqual({ code: 0, stderr: "" });
    const args = (await Bun.file(capture).text()).trim().split(/\r?\n/);
    expect(args.slice(0, 3)).toEqual(["release", "create", "v1.2.3-alpha.1"]);
    for(const flag of ["--draft", "--prerelease", "--verify-tag"]) expect(args).toContain(flag);
    expect(args[args.indexOf("--repo") + 1]).toBe("example/repo");
    expect(args[args.indexOf("--notes-file") + 1]).toBe(resolve(release, "release-notes.md"));
    expect(args).toContain(resolve(release, filename));
    expect(args).toContain(checksums);
    await rm(capture);
    await Bun.write(checksums, "corrupt checksum\n");
    const rejected = await invoke();
    expect(rejected.code).not.toBe(0);
    expect(rejected.stderr).toContain("checksum mismatch");
    expect(await Bun.file(capture).exists()).toBe(false);

    const mac = resolve(release, "macos");
    await mkdir(mac);
    const macName = "fixture-1.2.3-alpha.1-darwin-arm64.tgz";
    await Bun.write(resolve(mac, macName), bytes);
    const macChecksums = resolve(mac, "SHA256SUMS-darwin-arm64");
    await Bun.write(macChecksums, `${sha256(bytes)}  ${macName}\n`);
    await Bun.write(resolve(mac, "macos-arm64-notes.md"), "macOS notes");
    await writeGh(true);
    async function attach() {
      const child = Bun.spawn([process.execPath, "scripts/release/assets.ts", "attach-macos"], {
        cwd: directory, env, stdout: "pipe", stderr: "pipe", timeout: 10_000
      });
      const stderr = await new Response(child.stderr).text();
      return { code: await child.exited, stderr };
    }
    expect(await attach()).toEqual({ code: 0, stderr: "" });
    const attached = (await Bun.file(capture).text()).trim().split(/\r?\n/);
    expect(attached.slice(0, 3)).toEqual(["release", "upload", "v1.2.3-alpha.1"]);
    expect(attached).toContain(resolve(mac, macName));
    expect(attached).toContain(macChecksums);
    await rm(capture);
    await Bun.write(macChecksums, "corrupt checksum\n");
    expect((await attach()).stderr).toContain("checksum mismatch");
    expect(await Bun.file(capture).exists()).toBe(false);
    await Bun.write(macChecksums, `${sha256(bytes)}  ${macName}\n`);
    await rm(resolve(mac, "macos-arm64-notes.md"));
    expect((await attach()).stderr).toContain("notes are missing");
    expect(await Bun.file(capture).exists()).toBe(false);
    await Bun.write(resolve(mac, "macos-arm64-notes.md"), "macOS notes");
    await writeGh(false);
    expect((await attach()).stderr).toContain("existing draft release");
    expect(await Bun.file(capture).exists()).toBe(false);
    const windows = resolve(release, "windows");
    await mkdir(windows);
    const windowsName = "fixture-1.2.3-alpha.1-win32-x64.tgz";
    await Bun.write(resolve(windows, windowsName), bytes);
    const windowsChecksum = resolve(windows, "SHA256SUMS-win32-x64");
    await Bun.write(windowsChecksum, `${sha256(bytes)}  ${windowsName}\n`);
    const windowsNotes = resolve(windows, "windows-x64-notes.md");
    await Bun.write(windowsNotes, "revision 1527671533a955c40a7e43a68f767fde734c4cb5, DLL SHA-256 fixture");
    await writeGh(true);
    async function attachWindows() {
      const child = Bun.spawn([process.execPath, "scripts/release/assets.ts", "attach-windows"], {
        cwd: directory, env, stdout: "pipe", stderr: "pipe", timeout: 20_000
      });
      const stderr = await new Response(child.stderr).text();
      return { code: await child.exited, stderr };
    }
    expect(await attachWindows()).toEqual({ code: 0, stderr: "" });
    expect((await Bun.file(capture).text()).trim().split(/\r?\n/)).toContain(resolve(windows, windowsName));
    await rm(capture, { force: true });
    await Bun.write(windowsChecksum, `${"0".repeat(64)}  ${windowsName}\n`);
    expect((await attachWindows()).stderr).toContain("checksum mismatch");
    expect(await Bun.file(capture).exists()).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 40_000);
