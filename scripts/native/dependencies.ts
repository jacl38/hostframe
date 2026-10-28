import { $ } from "bun";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm, rmdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { archives, buildRoot, dawnRoot, dependencies, gitDependencies, getEngine, headers, source, type Archive, type GitDependency } from "./release";

export async function verifyChecksum(path: string, expected: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const actual = hash.digest("hex");
  if(actual !== expected) {
    throw new Error(`SHA-256 mismatch for ${path}: expected ${expected}, received ${actual}. Remove this cached archive and retry.`);
  }
}

async function download(archive: Archive) {
  const cache = resolve(buildRoot, "downloads");
  await mkdir(cache, { recursive: true });
  const path = resolve(cache, archive.name);
  if(await Bun.file(path).exists()) {
    await verifyChecksum(path, archive.sha256);
    return path;
  }
  console.log(`Downloading ${archive.name}`);
  const partial = `${path}.partial`;
  try {
    await $`curl --fail --location --silent --show-error --retry 2 --connect-timeout 20 --max-time 180 --output ${partial} ${archive.url}`;
    await verifyChecksum(partial, archive.sha256);
    await rename(partial, path);
    return path;
  } finally {
    await rm(partial, { force: true });
  }
}

// Both retrieval methods install transactionally and preserve existing user files.
async function installDirectory(destination: string, sentinel: string, populate: (staging: string) => Promise<void>) {
  const entries = await readdir(destination).catch((error: NodeJS.ErrnoException) => {
    if(error.code === "ENOENT") return [];
    throw error;
  });
  if(entries.length > 0) throw new Error(`Refusing to overwrite ${destination}; move it aside before setup.`);
  await mkdir(dirname(destination), { recursive: true });
  const staging = await mkdtemp(resolve(dirname(destination), ".ts-dawn-install-"));
  try {
    await populate(staging);
    if(!await Bun.file(resolve(staging, sentinel)).exists()) throw new Error(`Dependency is missing ${sentinel}.`);
    await rmdir(destination).catch((error: NodeJS.ErrnoException) => {
      if(error.code !== "ENOENT") throw error;
    });
    await rename(staging, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function assertArchive(archive: Archive) {
  const marker = Bun.file(resolve(archive.destination, ".ts-dawn-archive"));
  if(!await marker.exists() || (await marker.text()).trim() !== archive.sha256 || !await Bun.file(resolve(archive.destination, archive.sentinel)).exists()) {
    throw new Error(`Missing or mismatched dependency at ${archive.destination}. Run bun run setup; move stale dependencies aside first if needed.`);
  }
}

export async function installArchive(archive: Archive) {
  const path = await download(archive);
  if(await Bun.file(resolve(archive.destination, ".ts-dawn-archive")).exists()) {
    await assertArchive(archive);
    return;
  }
  const listing = await $`tar -tzf ${path}`.text();
  for(const entry of listing.trim().split("\n")) {
    if(entry.startsWith("/") || entry.split("/").includes("..")) throw new Error(`Unsafe archive path: ${entry}`);
  }
  await installDirectory(archive.destination, archive.sentinel, async staging => {
    await $`tar -xzf ${path} --strip-components=${archive.strip} -C ${staging}`;
    await Bun.write(resolve(staging, ".ts-dawn-archive"), `${archive.sha256}\n`);
  });
}

async function assertGitDependency(dependency: GitDependency) {
  if(!await Bun.file(resolve(dependency.destination, ".git/HEAD")).exists()) {
    throw new Error(`Missing ${dependency.name} checkout. Run bun run setup.`);
  }
  const actual = (await $`git rev-parse HEAD`.cwd(dependency.destination).text()).trim();
  if(actual !== dependency.revision) {
    throw new Error(`${dependency.name} is at ${actual}; expected ${dependency.revision}. Move the stale checkout aside and rerun setup.`);
  }
  await $`git diff --exit-code HEAD`.cwd(dependency.destination).quiet();
}

export async function installGitDependency(dependency: GitDependency) {
  if(await Bun.file(resolve(dependency.destination, ".git/HEAD")).exists()) {
    await assertGitDependency(dependency);
    return;
  }
  await installDirectory(dependency.destination, dependency.sentinel, async staging => {
    await $`git init --quiet ${staging}`;
    await $`git fetch --depth=1 ${dependency.url} ${dependency.revision}`.cwd(staging);
    await $`git checkout --quiet --detach FETCH_HEAD`.cwd(staging);
    const actual = (await $`git rev-parse HEAD`.cwd(staging).text()).trim();
    if(actual !== dependency.revision) throw new Error(`Invalid ${dependency.name} checkout.`);
  });
}

export async function assertDependencies() {
  for(const archive of archives()) await assertArchive(archive);
  for(const dependency of gitDependencies) await assertGitDependency(dependency);
}

export async function prepareDependencies() {
  await installArchive(source);
  const manifest = await Bun.file(resolve(dawnRoot, "DEPS")).text();
  for(const dependency of [...dependencies, ...gitDependencies]) {
    const block = manifest.split(`'${dependency.path}': {`)[1]?.split("\n  },")[0];
    if(!block?.includes(`@${dependency.revision}`)) {
      throw new Error(`Pinned ${dependency.path} does not match Dawn's DEPS; update dawn.lock.json.`);
    }
  }
  for(const archive of dependencies) await installArchive(archive);
  for(const dependency of gitDependencies) await installGitDependency(dependency);
  for(const archive of [headers, getEngine()]) {
    await installArchive(archive);
  }
}
