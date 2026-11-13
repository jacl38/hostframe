import { expect, test } from "bun:test";
import { chmod, copyFile, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { root } from "../native/release.ts";
import { sha256 } from "./assets.ts";

test("release CLI guards draft creation and macOS attachment with checksums", async () => {
  const directory = await realpath(await mkdtemp(resolve(tmpdir(), "hostframe-draft-")));
  try {
    for(const file of ["scripts/release/assets.ts", "scripts/native/release.ts", "scripts/native/dawn.lock.json"]) {
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
    const gh = resolve(directory, "gh");
    await Bun.write(gh, "#!/bin/sh\nprintf \"%s\\n\" \"$@\" > \"$HOSTFRAME_TEST_GH_ARGS\"\n");
    await chmod(gh, 0o755);
    const env = {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      ACT: "",
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
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
    const args = (await Bun.file(capture).text()).trim().split("\n");
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
    await Bun.write(gh, "#!/bin/sh\nif [ \"$2\" = view ]; then echo true; else printf \"%s\\n\" \"$@\" > \"$HOSTFRAME_TEST_GH_ARGS\"; fi\n");
    async function attach() {
      const child = Bun.spawn([process.execPath, "scripts/release/assets.ts", "attach-macos"], {
        cwd: directory, env, stdout: "pipe", stderr: "pipe", timeout: 10_000
      });
      const stderr = await new Response(child.stderr).text();
      return { code: await child.exited, stderr };
    }
    expect(await attach()).toEqual({ code: 0, stderr: "" });
    const attached = (await Bun.file(capture).text()).trim().split("\n");
    expect(attached.slice(0, 3)).toEqual(["release", "upload", "v1.2.3-alpha.1"]);
    expect(attached).toContain(resolve(mac, macName));
    expect(attached).toContain(macChecksums);
    await rm(capture);
    await Bun.write(macChecksums, "corrupt checksum\n");
    expect((await attach()).stderr).toContain("checksum mismatch");
    expect(await Bun.file(capture).exists()).toBe(false);
    await Bun.write(macChecksums, `${sha256(bytes)}  ${macName}\n`);
    await Bun.write(gh, "#!/bin/sh\nif [ \"$2\" = view ]; then echo false; else printf invoked > \"$HOSTFRAME_TEST_GH_ARGS\"; fi\n");
    expect((await attach()).stderr).toContain("existing draft release");
    expect(await Bun.file(capture).exists()).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
