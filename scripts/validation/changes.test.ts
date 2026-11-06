import { expect, test } from "bun:test";
import { needsIntegration } from "./changes.ts";

test("documentation-only changes skip integration while source, tooling and unknown paths require it", () => {
  expect(needsIntegration(["README.md", "docs/native-build.md", "LICENSE"])).toBe(false);
  for(const path of ["index.ts", "packages/native/src/input.cpp", "examples/three/adapter.ts", "bun.lock", ".github/workflows/validation.yml", "new-subsystem/file", "docs/snippet.ts"]) {
    expect(needsIntegration(["README.md", path])).toBe(true);
  }
});
