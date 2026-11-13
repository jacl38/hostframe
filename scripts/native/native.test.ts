import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { assertBuildSources } from "./build";
import { installArchive, installGitDependency, verifyChecksum } from "./dependencies";
import { getEngine, buildRoot, dawnRoot, root, type Archive, type GitDependency } from "./release";

const temporary: string[] = [];

afterEach(async () => {
  for(const directory of temporary.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

test("checksum verification detects corrupt or substituted downloads", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "hostframe-checksum-"));
  temporary.push(directory);
  const path = resolve(directory, "archive");
  await Bun.write(path, "pinned archive");
  const digest = createHash("sha256").update(await readFile(path)).digest("hex");
  await verifyChecksum(path, digest);
  await Bun.write(path, "corrupt archive");
  await expect(verifyChecksum(path, digest)).rejects.toThrow("SHA-256 mismatch");
});

test("unsupported hosts fail instead of selecting an incompatible engine", () => {
  expect(() => getEngine("linux", "arm64")).toThrow("No verified build configuration");
  expect(() => getEngine("win32", "x64")).toThrow("No verified build configuration");
  expect(() => getEngine("linux", "x64")).not.toThrow();
  expect(() => getEngine("darwin", "arm64")).not.toThrow();
  expect(() => getEngine("darwin", "x64")).toThrow("No verified build configuration");
});

test("build audit accepts selected integration sources and rejects engine, Tint, and proc-table entry point", () => {
  expect(assertBuildSources([
    { file: resolve(root, "packages/native/src/module.cpp") },
    { file: resolve(buildRoot, "binding/src/dawn/node/binding/GPU.cpp") },
    { file: resolve(buildRoot, "generated/src/dawn/utils/ComboLimits.cpp") },
    { file: resolve(dawnRoot, "src/dawn/glfw/utils.cpp") },
    { file: resolve(dawnRoot, "src/dawn/glfw/utils_metal.mm") },
    { file: resolve(dawnRoot, "third_party/glfw3/src/src/window.c") }
  ])).toBe(6);
  for(const file of [
    resolve(dawnRoot, "src/dawn/native/Device.cpp"),
    resolve(dawnRoot, "src/tint/lang/wgsl/reader/reader.cc"),
    resolve(buildRoot, "generated/src/dawn/native/webgpu_dawn_native_proc.cpp"),
    resolve(buildRoot, "generated/src/tint/reader.cpp"),
    resolve(buildRoot, "binding/src/dawn/node/Module.cpp"),
    resolve(buildRoot, "binding/src/dawn/node/../../../../src/tint/reader.cc")
  ]) {
    expect(() => assertBuildSources([{ file }])).toThrow();
  }
  expect(() => assertBuildSources([])).toThrow("Empty");
});

test("archive installation is reusable, rejects corrupt cache, and preserves existing directories", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "hostframe install with spaces-"));
  temporary.push(directory);
  const fixture = resolve(directory, "fixture");
  await mkdir(fixture);
  await Bun.write(resolve(fixture, "dependency.txt"), "verified input");
  const tarball = resolve(directory, "source.tar.gz");
  await $`tar -czf ${tarball} -C ${directory} fixture`;
  const name = `${basename(directory)}.tar.gz`;
  const cached = resolve(buildRoot, "downloads", name);
  temporary.push(cached);
  const archive: Archive = {
    name,
    url: new URL(`file://${tarball}`).href,
    sha256: createHash("sha256").update(await readFile(tarball)).digest("hex"),
    destination: resolve(directory, "installed"),
    strip: 1,
    sentinel: "dependency.txt"
  };
  await installArchive(archive);
  await installArchive(archive);
  expect(await Bun.file(resolve(archive.destination, "dependency.txt")).text()).toBe("verified input");
  await Bun.write(cached, "corrupt archive");
  await expect(installArchive(archive)).rejects.toThrow("SHA-256 mismatch");
  await rm(cached);
  const occupied = resolve(directory, "occupied");
  await mkdir(occupied);
  await Bun.write(resolve(occupied, "user.txt"), "preserve me");
  await expect(installArchive({ ...archive, destination: occupied })).rejects.toThrow("Refusing to overwrite");
  expect(await Bun.file(resolve(occupied, "user.txt")).text()).toBe("preserve me");
});

test("a rejected download leaves no partial or installed archive", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "hostframe-reject-"));
  temporary.push(directory);
  const source = resolve(directory, "source");
  await Bun.write(source, "untrusted content");
  const name = `${basename(directory)}.tar.gz`;
  const cached = resolve(buildRoot, "downloads", name);
  temporary.push(cached, `${cached}.partial`);
  const archive: Archive = {
    name,
    url: new URL(`file://${source}`).href,
    sha256: "0".repeat(64),
    destination: resolve(directory, "installed"),
    strip: 0,
    sentinel: "dependency.txt"
  };
  await expect(installArchive(archive)).rejects.toThrow("SHA-256 mismatch");
  expect(await Bun.file(cached).exists()).toBe(false);
  expect(await Bun.file(`${cached}.partial`).exists()).toBe(false);
  expect(await Bun.file(resolve(archive.destination, archive.sentinel)).exists()).toBe(false);
});

test("Git dependencies use pinned commits, reuse clean checkouts, and preserve stale or modified checkouts", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "hostframe git with spaces-"));
  temporary.push(directory);
  const repository = resolve(directory, "repository");
  await $`git init --quiet ${repository}`;
  await Bun.write(resolve(repository, "dependency.txt"), "pinned contents");
  await $`git add dependency.txt`.cwd(repository);
  await $`git -c user.name=Test -c user.email=test@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null commit --quiet -m fixture`.cwd(repository);
  const revision = (await $`git rev-parse HEAD`.cwd(repository).text()).trim();
  const dependency: GitDependency = {
    name: "fixture",
    path: "third_party/fixture",
    url: repository,
    revision,
    destination: resolve(directory, "installed"),
    sentinel: "dependency.txt"
  };
  await installGitDependency(dependency);
  await installGitDependency(dependency);
  expect(await Bun.file(resolve(dependency.destination, "dependency.txt")).text()).toBe("pinned contents");
  await expect(installGitDependency({ ...dependency, revision: "0".repeat(40) })).rejects.toThrow("expected");
  await Bun.write(resolve(dependency.destination, "dependency.txt"), "local edits");
  await expect(installGitDependency(dependency)).rejects.toThrow();
  expect(await Bun.file(resolve(dependency.destination, "dependency.txt")).text()).toBe("local edits");
  await expect(installGitDependency({ ...dependency, destination: resolve(directory, "failed"), revision: "0".repeat(40) })).rejects.toThrow();
  expect((await readdir(directory)).some(name => name.startsWith(".hostframe-install-"))).toBe(false);
});

test("the single CLI rejects invalid commands and flags before running tools", async () => {
  for(const cliArguments of [["invalid"], ["build", "--presentation"], ["verify", "--unknown"], ["verify", "--cleanup-timeouts-only", "--presentation"]]) {
    const result = await $`${process.execPath} ${resolve(root, "scripts/native.ts")} ${cliArguments}`.nothrow().quiet();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Usage:");
  }
});

test("cleanup-only verification requires the forced-timeout build environment", async () => {
  const env = { ...process.env, HOSTFRAME_TEST_CLEANUP_TIMEOUT: "0" };
  const result = await $`${process.execPath} ${resolve(root, "scripts/native.ts")} verify --cleanup-timeouts-only`.env(env).nothrow().quiet();
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("requires HOSTFRAME_TEST_CLEANUP_TIMEOUT=1");
});
