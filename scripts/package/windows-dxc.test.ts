import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { assertDxcBuildRecord, requireDxcHeadersRevision, requireDxcRevision, verifyDxcCache, windowsDxc } from "../native/dxc.ts";

test("Windows packaging refuses DXC binaries that differ from Dawn DEPS", () => {
  const pinned = "1527671533a955c40a7e43a68f767fde734c4cb5";
  const candidate = "01b62ad47db7dee3dd33f90e7339cf9e860b3f93";
  const manifest = `'third_party/directx-shader-compiler/src': {\n    'url': '{chromium_git}/external/github.com/microsoft/DirectXShaderCompiler@${pinned}',\n  },`;
  expect(() => requireDxcRevision(manifest, pinned)).not.toThrow();
  expect(() => requireDxcRevision(manifest, candidate)).toThrow(`does not match Dawn DEPS revision ${pinned}`);
  expect(() => requireDxcRevision("", pinned)).toThrow("Cannot find");
  expect(() => requireDxcRevision("'third_party/directx-shader-compiler/src': {\n 'something': 1,\n},\n" + manifest.replace("third_party/directx-shader-compiler/src", "other"), pinned)).toThrow("Cannot find");
});

test("DXC DirectX-Headers must match Dawn's selected revision", () => {
  const revision = "980971e835876dc0cde415e8f9bc646e64667bf7";
  const manifest = `'third_party/directx-headers/src': {\n    'url': '{chromium_git}/DirectX-Headers@${revision}',\n  },`;
  expect(() => requireDxcHeadersRevision(manifest, revision)).not.toThrow();
  expect(() => requireDxcHeadersRevision(manifest, "0".repeat(40))).toThrow("does not match Dawn DEPS");
  expect(() => requireDxcHeadersRevision("", revision)).toThrow("does not match Dawn DEPS");
});

test("DXC build records reject altered binaries, revisions and recipes", () => {
  const record = { revision: windowsDxc.revision, recipe: "hostframe-dxc-msvc-release-no-spirv-v1", sha256: "digest", toolchain: process.env.HOSTFRAME_DXC_TOOLCHAIN ?? null };
  expect(() => assertDxcBuildRecord(record, "digest")).not.toThrow();
  expect(() => assertDxcBuildRecord(record, "altered")).toThrow("provenance mismatch");
  expect(() => assertDxcBuildRecord({ ...record, revision: "other" }, "digest")).toThrow("provenance mismatch");
  expect(() => assertDxcBuildRecord({ ...record, recipe: "other" }, "digest")).toThrow("provenance mismatch");
  expect(() => assertDxcBuildRecord({ ...record, toolchain: "wrong" }, "digest", "expected")).toThrow("provenance mismatch");
  expect(() => assertDxcBuildRecord(null, "digest")).toThrow("provenance mismatch");
});

test("restored DXC cache works without a source checkout and rejects missing or changed files", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "hostframe-dxc-cache-"));
  const headerRevision = "980971e835876dc0cde415e8f9bc646e64667bf7";
  const manifest = `'third_party/directx-shader-compiler/src': {\n 'url': 'DirectXShaderCompiler@${windowsDxc.revision}',\n  },\n` +
    `'third_party/directx-headers/src': {\n 'url': 'DirectX-Headers@${headerRevision}',\n  },`;
  function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
  const names = ["DXC-LICENSE.txt", "DXC-DirectX-Headers-LICENSE.txt"];
  try {
    await Bun.write(resolve(directory, "dxcompiler.dll"), "binary");
    for(const name of names) await Bun.write(resolve(directory, name), name);
    const licenseHashes = Object.fromEntries(names.map(name => [name, digest(name)]));
    await Bun.write(resolve(directory, "hostframe-build.json"), JSON.stringify({
      revision: windowsDxc.revision, recipe: "hostframe-dxc-msvc-release-no-spirv-v1",
      sha256: digest("binary"), headersRevision: headerRevision, licenseHashes,
      toolchain: process.env.HOSTFRAME_DXC_TOOLCHAIN ?? null
    }));
    expect(await verifyDxcCache(directory, manifest)).toBe(digest("binary"));
    await Bun.write(resolve(directory, "dxcompiler.dll"), "corrupt");
    await expect(verifyDxcCache(directory, manifest)).rejects.toThrow("provenance mismatch");
    await Bun.write(resolve(directory, "dxcompiler.dll"), "binary");
    await Bun.write(resolve(directory, names[0]!), "corrupt");
    await expect(verifyDxcCache(directory, manifest)).rejects.toThrow("license mismatch");
    await Bun.write(resolve(directory, names[0]!), names[0]!);
    await rm(resolve(directory, names[1]!));
    await expect(verifyDxcCache(directory, manifest)).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
