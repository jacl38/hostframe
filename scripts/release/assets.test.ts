import { expect, test } from "bun:test";
import { assertDraftEnvironment, releaseTag, symbolRequirements } from "./assets.ts";

test("release tags must match the package version; manual branch builds remain available", () => {
  expect(releaseTag("0.1.0-alpha.0", "refs/heads/master")).toBe("v0.1.0-alpha.0");
  expect(releaseTag("1.2.3", "refs/tags/v1.2.3")).toBe("v1.2.3");
  expect(() => releaseTag("1.2.3", "refs/tags/v1.2.4")).toThrow("does not match");
  expect(() => releaseTag("../escape")).toThrow("Invalid release version");
});

test("draft creation rejects local act runs, manual dispatches, and mismatched tags", () => {
  const env = { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/v1.2.3", GITHUB_REPOSITORY: "owner/repo" };
  expect(assertDraftEnvironment("1.2.3", env)).toEqual({ tag: "v1.2.3", repository: "owner/repo" });
  expect(() => assertDraftEnvironment("1.2.3", { ...env, ACT: "true" })).toThrow("disabled under act");
  expect(() => assertDraftEnvironment("1.2.3", { ...env, GITHUB_EVENT_NAME: "workflow_dispatch" })).toThrow("version-tag push");
  expect(() => assertDraftEnvironment("1.2.3", { ...env, GITHUB_REF: "refs/tags/v1.2.4" })).toThrow("does not match");
  expect(() => assertDraftEnvironment("1.2.3", { ...env, GITHUB_REPOSITORY: "" })).toThrow("version-tag push");
});

test("binary requirements use numeric symbol versions and fail on missing evidence", () => {
  expect(symbolRequirements("GLIBC_2.9 GLIBC_2.43 GLIBC_2.34 GLIBCXX_3.4.9 GLIBCXX_3.4.32")).toEqual({ GLIBC: "2.43", GLIBCXX: "3.4.32" });
  expect(() => symbolRequirements("GLIBC_2.43")).toThrow("GLIBCXX");
  expect(() => symbolRequirements("")).toThrow("GLIBC");
});
