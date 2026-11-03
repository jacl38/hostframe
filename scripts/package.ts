import { $ } from "bun";
import { copyFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "tsdown";
import config from "../tsdown.config.ts";
import { buildRoot, root } from "./native/release.ts";
import { writeNotices } from "./package/notices.ts";

try {
  const reportHeader = Reflect.get(process.report.getReport(), "header");
  if(process.platform !== "linux" || process.arch !== "x64" || !reportHeader || !Reflect.get(reportHeader, "glibcVersionRuntime")) {
    throw new Error("Package builds currently require Linux x64 with glibc.");
  }
  // Remove old output even when the native build fails; never pack a stale addon.
  await rm(resolve(root, "dist"), { recursive: true, force: true });
  await $`bun run native:build`.cwd(root);
  await build(config);
  await copyFile(resolve(buildRoot, "cmake/hostframe.node"), resolve(root, "dist/hostframe.node"));
  await writeNotices();
  console.log("Package ready in dist/. Run npm pack or bun pm pack to create the tarball.");
} catch (error) {
  await rm(resolve(root, "dist"), { recursive: true, force: true });
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
