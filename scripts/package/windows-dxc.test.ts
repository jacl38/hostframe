import { expect, test } from "bun:test";
import { assertDxcFile, windowsDxc, windowsDxcFiles } from "../native/dxc.ts";

test("Windows DXC release includes runtime DLLs and licenses and rejects altered files", () => {
  expect(windowsDxc.version).toBe("v1.9.2609");
  expect(Object.values(windowsDxcFiles)).toEqual([
    "dxcompiler.dll", "dxil.dll", "DXC-LICENSE-MIT.txt", "DXC-LICENSE-LLVM.txt", "DXC-LICENSE-MS.txt"
  ]);
  for(const source of Object.keys(windowsDxcFiles) as Array<keyof typeof windowsDxcFiles>) {
    expect(windowsDxc.files[source]).toMatch(/^[a-f0-9]{64}$/);
    expect(() => assertDxcFile(source, new TextEncoder().encode("altered"))).toThrow("checksum mismatch");
  }
});
