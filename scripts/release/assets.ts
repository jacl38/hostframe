import { $ } from "bun";
import { createHash } from "node:crypto";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import manifest from "../../package.json";
import { getEngine, lock, root } from "../native/release.ts";

const directory = resolve(root, "build/release");
const filename = `${manifest.name}-${manifest.version}-linux-x64.tgz`;
const tarball = resolve(directory, filename);

async function prepare() {
  if(process.platform === "darwin" && process.arch === "arm64") return prepareMac();
  const tag = releaseTag(manifest.version, process.env.GITHUB_REF);
  if(process.platform !== "linux" || process.arch !== "x64") throw new Error("Release assets require Linux x64.");
  const packed = resolve(root, `build/package/${manifest.name}-${manifest.version}.tgz`);
  const metadata = JSON.parse(await $`tar -xOf ${packed} package/package.json`.text());
  if(metadata.name !== manifest.name || metadata.version !== manifest.version || metadata.license !== manifest.license) {
    throw new Error("Packed package metadata does not match package.json. Run package:verify first.");
  }
  // Inspect the packaged binary itself, so notes cannot describe another local build.
  const temporary = resolve(root, "build/release-addon.node");
  let requirements: ReturnType<typeof symbolRequirements>;
  try {
    await $`tar -xOf ${packed} package/dist/hostframe.node > ${Bun.file(temporary)}`.quiet();
    requirements = symbolRequirements(await $`objdump -T ${temporary}`.text());
  } finally {
    await rm(temporary, { force: true });
  }
  const bytes = new Uint8Array(await Bun.file(packed).arrayBuffer());
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await copyFile(packed, tarball);
  await Bun.write(resolve(directory, "SHA256SUMS"), `${sha256(bytes)}  ${filename}\n`);
  const repository = manifest.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
  const url = `${repository}/releases/download/${tag}/${filename}`;
  // Bun's process.versions.node is a compatibility value, not the installed Node.
  const nodeVersion = (await $`node --version`.text()).trim();
  await Bun.write(resolve(directory, "release-notes.md"), `# hostframe ${manifest.version}

Linux x64/glibc package with ESM JavaScript, TypeScript declarations, the native addon, Apache-2.0 license, and third-party notices. No native build or install scripts are needed by consumers.

## Install after publishing this draft

\`\`\`sh
bun add hostframe@${url}
# Or download the tarball, verify SHA256SUMS, then install the local file.
\`\`\`

## Runtime requirements and validation

- Linux x64 with glibc >= ${requirements.GLIBC} and libstdc++ providing GLIBCXX_${requirements.GLIBCXX}.
- X11 (including Xwayland), X11/Xfixes runtime libraries, and a usable Vulkan loader/driver.
- Verified in this build using Node.js ${nodeVersion} and Bun ${Bun.version}.
- Native presentation and clean npm/Bun consumer checks use Xvfb and Mesa lavapipe. Physical GPU presentation, older Linux distributions, and other platforms are not established by this release build.
- Dawn ${lock.release}, revision ${lock.revision}; engine archive SHA-256 ${lock.engines["linux-x64"].sha256}.

This is a GitHub Releases distribution; no package has been published to the npm registry. Versioned release URLs pin installs to this release; update the URL to upgrade.
If macOS arm64 assets are attached, see the accompanying macos-arm64-notes.md and SHA256SUMS-darwin-arm64.
`);
  console.log(`Release assets prepared in ${directory}`);
}

async function prepareMac() {
  const tag = releaseTag(manifest.version, process.env.GITHUB_REF);
  const packed = resolve(root, `build/package/${manifest.name}-${manifest.version}.tgz`);
  const metadata = JSON.parse(await $`tar -xOf ${packed} package/package.json`.text());
  if(metadata.name !== manifest.name || metadata.version !== manifest.version || metadata.license !== manifest.license ||
    JSON.stringify(metadata.os) !== JSON.stringify(["darwin"]) || JSON.stringify(metadata.cpu) !== JSON.stringify(["arm64"]) || metadata.libc) {
    throw new Error("Packed macOS metadata does not match the release. Run package:verify first.");
  }
  const temporary = resolve(root, "build/release-addon.node");
  try {
    await $`tar -xOf ${packed} package/dist/hostframe.node > ${Bun.file(temporary)}`.quiet();
    const architectures = (await $`lipo -archs ${temporary}`.text()).trim();
    if(architectures !== "arm64") throw new Error(`Unexpected macOS addon architecture: ${architectures}`);
  } finally {
    await rm(temporary, { force: true });
  }
  const output = resolve(root, "build/release-macos");
  const name = `${manifest.name}-${manifest.version}-darwin-arm64.tgz`;
  const bytes = new Uint8Array(await Bun.file(packed).arrayBuffer());
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await copyFile(packed, resolve(output, name));
  await Bun.write(resolve(output, "SHA256SUMS-darwin-arm64"), `${sha256(bytes)}  ${name}\n`);
  const repository = manifest.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
  const nodeVersion = (await $`node --version`.text()).trim();
  await Bun.write(resolve(output, "macos-arm64-notes.md"), `# macOS arm64 package\n\nInstall from ${repository}/releases/download/${tag}/${name} after verifying SHA256SUMS-darwin-arm64.\n\nBuilt and validated on macOS arm64 with Node.js ${nodeVersion} and Bun ${Bun.version}; Metal compute and presentation were tested on the runner. Earlier macOS versions and Intel Macs are not verified.\n\nDawn ${lock.release}, revision ${lock.revision}; engine archive SHA-256 ${getEngine().sha256}.\n`);
  console.log(`macOS release assets prepared in ${output}`);
}

async function attachMac() {
  const { tag, repository } = assertDraftEnvironment(manifest.version, process.env);
  const output = resolve(directory, "macos");
  const name = `${manifest.name}-${manifest.version}-darwin-arm64.tgz`;
  const packed = resolve(output, name);
  const checksum = resolve(output, "SHA256SUMS-darwin-arm64");
  const expected = `${sha256(new Uint8Array(await Bun.file(packed).arrayBuffer()))}  ${name}\n`;
  if(await Bun.file(checksum).text() !== expected) throw new Error("macOS release checksum mismatch.");
  const draftState = (await $`gh release view ${tag} --repo ${repository} --json isDraft --jq .isDraft`.text()).trim();
  if(draftState !== "true") throw new Error("macOS assets require an existing draft release.");
  await $`gh release upload ${tag} ${packed} ${checksum} ${resolve(output, "macos-arm64-notes.md")} --repo ${repository}`.cwd(root);
}

async function draft() {
  const { tag, repository } = assertDraftEnvironment(manifest.version, process.env);
  const expected = `${sha256(new Uint8Array(await Bun.file(tarball).arrayBuffer()))}  ${filename}\n`;
  if(await Bun.file(resolve(directory, "SHA256SUMS")).text() !== expected) throw new Error("Release checksum mismatch.");
  const flags = manifest.version.includes("-") ? ["--prerelease"] : [];
  await $`gh release create ${tag} ${tarball} ${resolve(directory, "SHA256SUMS")} --repo ${repository} --verify-tag --draft --title ${`${manifest.name} ${tag}`} --notes-file ${resolve(directory, "release-notes.md")} ${flags}`.cwd(root);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if(rest.length > 0) throw new Error("Usage: bun scripts/release/assets.ts <check-tag|prepare|draft|attach-macos>");
  switch(command) {
    case "check-tag":
      console.log(`Release version: ${releaseTag(manifest.version, process.env.GITHUB_REF)}`);
      break;
    case "prepare":
      await prepare();
      break;
    case "draft":
      await draft();
      break;
    case "attach-macos":
      await attachMac();
      break;
    default:
      throw new Error("Usage: bun scripts/release/assets.ts <check-tag|prepare|draft|attach-macos>");
  }
}

if(import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

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
