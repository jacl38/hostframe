import { resolve } from "node:path";
import lock from "./dawn.lock.json";

export { lock };
export const root = resolve(import.meta.dir, "../..");
export const buildRoot = resolve(root, "build/native");
export const dawnRoot = resolve(root, "vendor/dawn");

export type Archive = typeof lock.source & { destination: string };
export const source = { ...lock.source, destination: dawnRoot };
export const headers = { ...lock.headers, destination: resolve(buildRoot, "headers") };
export const dependencies = lock.dependencies.archives.map(archive => ({
  ...archive,
  destination: resolve(dawnRoot, archive.path)
}));
export const gitDependencies = lock.dependencies.git.map(dependency => ({
  ...dependency,
  destination: resolve(dawnRoot, dependency.path)
}));
export type GitDependency = typeof gitDependencies[number];

export function getEngine(platform = process.platform, arch = process.arch) {
  const engines: Record<string, typeof lock.source> = lock.engines;
  const engine = engines[`${platform}-${arch}`];
  if(!engine) {
    throw new Error(`No verified build configuration for ${platform}/${arch} in dawn.lock.json.`);
  }
  return { ...engine, destination: resolve(buildRoot, "engine") };
}

export function archives() {
  return [source, headers, getEngine(), ...dependencies];
}
