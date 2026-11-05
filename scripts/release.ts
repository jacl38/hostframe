import { $ } from "bun";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const root = resolve(import.meta.dir, "..");
const shell = $.cwd(root);

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      version: { type: "string" },
      help: { type: "boolean", short: "h" }
    },
    strict: true,
    allowPositionals: false
  });
  if(values.help) {
    console.log("Usage: bun run release --version <version>");
    return;
  }
  const version = values.version;
  if(!version) throw new Error("Usage: bun run release --version <version>");
  if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) || !Bun.semver.satisfies(version, `=${version}`)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  const tag = `v${version}`;
  const file = Bun.file(resolve(root, "package.json"));
  const manifest = await file.json();
  if(Bun.semver.order(version, manifest.version) !== 1) {
    throw new Error(`Release version ${version} must be greater than ${manifest.version}.`);
  }
  if((await shell`git status --porcelain --untracked-files=all`.text()).trim()) {
    throw new Error("Commit or stash your changes before releasing.");
  }
  const branch = (await shell`git symbolic-ref --quiet --short HEAD`.text()).trim();
  await shell`gh auth setup-git`;
  const localTag = await shell`git show-ref --verify --quiet ${`refs/tags/${tag}`}`.quiet().nothrow();
  if(localTag.exitCode === 0) throw new Error(`Tag ${tag} already exists locally.`);
  if(localTag.exitCode !== 1) throw new Error("Could not check local tags.");
  const remoteTag = await shell`git ls-remote --tags origin ${`refs/tags/${tag}`}`.text();
  if(remoteTag.trim()) throw new Error(`Tag ${tag} already exists on origin.`);

  manifest.version = version;
  await Bun.write(file, `${JSON.stringify(manifest, null, 2)}\n`);
  await shell`git add -- package.json`;
  await shell`git commit -m ${`Release ${version}`}`;
  await shell`git push origin ${`HEAD:refs/heads/${branch}`}`;
  await shell`git tag ${tag}`;
  await shell`git push origin ${`refs/tags/${tag}`}`;
  console.log(`Pushed ${tag}. GitHub Actions will build and create a draft release.`);
}

if(import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
