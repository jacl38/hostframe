import { expect, test } from "bun:test";
import { assertDxcBuildRecord, requireDxcHeadersRevision, requireDxcRevision, windowsDxc } from "../native/dxc.ts";

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
  const record = { revision: windowsDxc.revision, recipe: "hostframe-dxc-msvc-release-no-spirv-v1", sha256: "digest" };
  expect(() => assertDxcBuildRecord(record, "digest")).not.toThrow();
  expect(() => assertDxcBuildRecord(record, "altered")).toThrow("provenance mismatch");
  expect(() => assertDxcBuildRecord({ ...record, revision: "other" }, "digest")).toThrow("provenance mismatch");
  expect(() => assertDxcBuildRecord({ ...record, recipe: "other" }, "digest")).toThrow("provenance mismatch");
  expect(() => assertDxcBuildRecord(null, "digest")).toThrow("provenance mismatch");
});
