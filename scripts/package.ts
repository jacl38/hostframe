import { $ } from "bun";
import { copyFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "tsdown";
import config from "../tsdown.config.ts";
import { buildRoot, root } from "./native/release.ts";
import { writeNotices } from "./package/notices.ts";
import { prepareWindowsDxc, requireWindowsDxcRevision } from "./native/dxc.ts";

try {
  const reportHeader = Reflect.get(process.report.getReport(), "header");
  const linux = process.platform === "linux" && process.arch === "x64" && reportHeader && Reflect.get(reportHeader, "glibcVersionRuntime");
  const macos = process.platform === "darwin" && process.arch === "arm64" && process.env.HOSTFRAME_PACKAGE_STAGING === "1";
  const windows = process.platform === "win32" && process.arch === "x64" && process.env.HOSTFRAME_PACKAGE_STAGING === "1";
  if(!linux && !macos && !windows) {
    throw new Error("Package builds require Linux x64 with glibc or a staged macOS arm64 or Windows x64 build.");
  }
  // Remove old output even when the native build fails; never pack a stale addon.
  await rm(resolve(root, "dist"), { recursive: true, force: true });
  if(windows) await requireWindowsDxcRevision();
  await $`bun run native:build`.cwd(root);
  await build(config);
  await copyFile(resolve(buildRoot, "cmake/hostframe.node"), resolve(root, "dist/hostframe.node"));
  if(windows) await prepareWindowsDxc();
  await writeNotices();
  console.log("Package ready in dist/. Run npm pack or bun pm pack to create the tarball.");
} catch (error) {
  await rm(resolve(root, "dist"), { recursive: true, force: true });
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
