import { $ } from "bun";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { dawnRoot, dxcBuildRoot, lock, root } from "./release.ts";

export const windowsDxc = lock.dependencies.dxc;
const dxcRoot = dxcBuildRoot;
const source = resolve(dxcRoot, "source");
const output = resolve(dxcRoot, "cmake");
const cache = resolve(dxcRoot, "cache");
const binary = resolve(cache, "dxcompiler.dll");
const marker = resolve(cache, "hostframe-build.json");
const licenses = [
  ["LICENSE.TXT", "DXC-LICENSE.txt"],
  ["external/DirectX-Headers/LICENSE", "DXC-DirectX-Headers-LICENSE.txt"]
] as const;
const modules = ["external/DirectX-Headers"];
const recipe = "hostframe-dxc-msvc-release-no-spirv-v1";

export function assertDxcBuildRecord(data: unknown, digest: string, toolchain = process.env.HOSTFRAME_DXC_TOOLCHAIN) {
  if(typeof data !== "object" || data === null ||
      Reflect.get(data, "revision") !== windowsDxc.revision ||
      Reflect.get(data, "recipe") !== recipe || Reflect.get(data, "sha256") !== digest ||
      (toolchain !== undefined && Reflect.get(data, "toolchain") !== toolchain)) {
    throw new Error("DXC build provenance mismatch; run bun scripts/native.ts dxc.");
  }
}

export function requireDxcRevision(manifest: string, revision: string) {
  const match = manifest.match(/'third_party\/directx-shader-compiler\/src':\s*\{\s*'url':[^\r\n]*DirectXShaderCompiler@([0-9a-f]{40})/);
  if(!match) throw new Error("Cannot find the DirectX Shader Compiler revision in Dawn DEPS.");
  if(match[1] !== revision) throw new Error(`DXC revision ${revision} does not match Dawn DEPS revision ${match[1]}.`);
}

export function requireDxcHeadersRevision(manifest: string, revision: string) {
  const block = manifest.split("'third_party/directx-headers/src': {")[1]?.split("\n  },")[0];
  const pinned = block?.match(/DirectX-Headers@([0-9a-f]{40})/)?.[1];
  if(!pinned || pinned !== revision) throw new Error("DXC DirectX-Headers revision does not match Dawn DEPS.");
}

export async function requireWindowsDxcRevision() {
  requireDxcRevision(await Bun.file(resolve(dawnRoot, "DEPS")).text(), windowsDxc.revision);
}

async function hash(path: string) {
  return createHash("sha256").update(new Uint8Array(await Bun.file(path).arrayBuffer())).digest("hex");
}

async function assertSource() {
  if((await $`git rev-parse HEAD`.cwd(source).text()).trim() !== windowsDxc.revision) throw new Error("DXC source revision mismatch.");
  if((await $`git status --porcelain`.cwd(source).text()).trim()) throw new Error("DXC source checkout has local changes.");
  const states = (await $`git submodule status --recursive ${modules}`.cwd(source).text()).trimEnd().split(/\r?\n/);
  if(states.length < modules.length || states.some(line => !line.startsWith(" "))) throw new Error("DXC submodules are missing or not at their pinned revisions.");
  for(const module of modules) {
    if((await $`git -C ${resolve(source, module)} status --porcelain`.text()).trim()) throw new Error(`DXC submodule ${module} has local changes.`);
  }
  const actualHeader = (await $`git -C ${resolve(source, "external/DirectX-Headers")} rev-parse HEAD`.text()).trim();
  requireDxcHeadersRevision(await Bun.file(resolve(dawnRoot, "DEPS")).text(), actualHeader);
}

export async function buildWindowsDxc() {
  if(process.platform !== "win32" || process.arch !== "x64") throw new Error("DXC build requires Windows x64.");
  const missing = ["git", "cmake", "ninja", "cl"].filter(tool => !Bun.which(tool));
  if(missing.length) throw new Error(`Missing DXC build tools: ${missing.join(", ")}. Run from an x64 Visual Studio developer prompt with C++ and ATL installed.`);
  await requireWindowsDxcRevision();
  await mkdir(dxcRoot, { recursive: true });
  await rm(marker, { force: true });
  if(!await Bun.file(resolve(source, ".git/HEAD")).exists()) {
    const entries = await readdir(source).catch((error: NodeJS.ErrnoException) => {
      if(error.code === "ENOENT") return [];
      throw error;
    });
    if(entries.length) throw new Error(`Refusing to overwrite existing DXC source directory: ${source}`);
    await $`git init ${source}`;
    await $`git remote add origin ${windowsDxc.url}`.cwd(source);
    await $`git fetch --depth=1 origin ${windowsDxc.revision}`.cwd(source);
    await $`git checkout --detach FETCH_HEAD`.cwd(source);
    await $`git submodule update --init --recursive ${modules}`.cwd(source);
  }
  await assertSource();
  const jobs = process.env.HOSTFRAME_JOBS || "2";
  if(!/^[1-9]\d*$/.test(jobs)) throw new Error("HOSTFRAME_JOBS must be a positive integer.");
  const compiler = await Bun.file(resolve(output, "CMakeCache.txt")).exists() ? [] : ["-DCMAKE_C_COMPILER=cl", "-DCMAKE_CXX_COMPILER=cl"];
  // ARC migration is unrelated to shader compilation and enables DXC's broken Objective-C rewriter.
  await $`cmake -S ${source} -B ${output} -G Ninja ${compiler} -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DLLVM_TARGETS_TO_BUILD=None -DLLVM_INCLUDE_TESTS=OFF -DHLSL_INCLUDE_TESTS=OFF -DLLVM_ENABLE_ASSERTIONS=OFF -DCLANG_ENABLE_ARCMT=OFF -DENABLE_SPIRV_CODEGEN=OFF -DSPIRV_BUILD_TESTS=OFF`.cwd(root);
  const cmakeCache = await Bun.file(resolve(output, "CMakeCache.txt")).text();
  if(!/^CMAKE_CXX_COMPILER:(?:FILEPATH|STRING)=.*[/\\]cl\.exe\s*$/im.test(cmakeCache)) {
    throw new Error("DXC build requires the Visual Studio MSVC compiler; use a clean DXC build directory.");
  }
  await $`cmake --build ${output} --target dxcompiler --parallel ${jobs}`.cwd(root);
  await assertSource();
  await mkdir(cache, { recursive: true });
  await copyFile(resolve(output, "bin/dxcompiler.dll"), binary);
  const licenseHashes: Record<string, string> = {};
  for(const [from, to] of licenses) {
    await copyFile(resolve(source, from), resolve(cache, to));
    licenseHashes[to] = await hash(resolve(cache, to));
  }
  const headersRevision = (await $`git -C ${resolve(source, "external/DirectX-Headers")} rev-parse HEAD`.text()).trim();
  await Bun.write(marker, JSON.stringify({ revision: windowsDxc.revision, recipe, sha256: await hash(binary), headersRevision, licenseHashes, toolchain: process.env.HOSTFRAME_DXC_TOOLCHAIN ?? null }) + "\n");
}

export async function verifyDxcCache(directory: string, manifest: string) {
  requireDxcRevision(manifest, windowsDxc.revision);
  const data = await Bun.file(resolve(directory, "hostframe-build.json")).json();
  const digest = await hash(resolve(directory, "dxcompiler.dll"));
  assertDxcBuildRecord(data, digest);
  requireDxcHeadersRevision(manifest, data.headersRevision);
  for(const [, name] of licenses) {
    if(!data.licenseHashes || data.licenseHashes[name] !== await hash(resolve(directory, name))) {
      throw new Error(`DXC cached license mismatch: ${name}. Rebuild the compiler.`);
    }
  }
  return digest;
}

export async function windowsDxcHash() {
  return verifyDxcCache(cache, await Bun.file(resolve(dawnRoot, "DEPS")).text());
}

export async function prepareWindowsDxc() {
  await windowsDxcHash();
  await copyFile(binary, resolve(root, "dist/dxcompiler.dll"));
  for(const [, name] of licenses) await copyFile(resolve(cache, name), resolve(root, "dist", name));
}
