import { createHash } from "node:crypto";

export function releaseTag(version: string, ref = "") {
  if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  const tag = `v${version}`;
  if(ref.startsWith("refs/tags/") && ref !== `refs/tags/${tag}`) {
    throw new Error(`Release tag ${ref} does not match package.json version ${version}.`);
  }
  return tag;
}

export function assertDraftEnvironment(version: string, env: NodeJS.ProcessEnv) {
  if(env.ACT) throw new Error("GitHub release creation is disabled under act.");
  const tag = releaseTag(version, env.GITHUB_REF);
  if(env.GITHUB_EVENT_NAME !== "push" || env.GITHUB_REF !== `refs/tags/${tag}` || !env.GITHUB_REPOSITORY) {
    throw new Error("Draft releases require a matching version-tag push and GITHUB_REPOSITORY.");
  }
  return { tag, repository: env.GITHUB_REPOSITORY };
}

export function symbolRequirements(symbols: string) {
  const required: Record<string, string> = {};
  for(const family of ["GLIBC", "GLIBCXX"]) {
    const versions = [...symbols.matchAll(new RegExp(`\\b${family}_(\\d+(?:\\.\\d+)+)\\b`, "g"))].map(match => match[1]!);
    versions.sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
    const latest = versions.at(-1);
    if(!latest) throw new Error(`Cannot determine ${family} requirement from the addon.`);
    required[family] = latest;
  }
  return required;
}

export function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
