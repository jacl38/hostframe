import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { generateDeclarations } from "./declarations";
import { buildRoot } from "./release";

// Runtime integration tests run under native:verify. This test covers extraction
// and recovery from stale/missing build output using the actual compiled addon.
test("declarations and runtime event names are extracted and regenerated together", async () => {
  const addon = resolve(buildRoot, "cmake/hostframe.node");
  if(!await Bun.file(addon).exists()) throw new Error("Run bun run setup before declaration regression tests.");
  const directory = await mkdtemp(resolve(tmpdir(), "hostframe declarations "));
  const output = resolve(directory, "native.d.ts");
  const eventsOutput = resolve(directory, "input-events.ts");
  const globalsOutput = resolve(directory, "webgpu-globals.ts");
  try {
    expect(await generateDeclarations(addon, output)).toBe(true);
    const content = await Bun.file(output).text();
    const events = await Bun.file(eventsOutput).text();
    const globals = await Bun.file(globalsOutput).text();
    expect(globals).toContain("GPUBufferUsage");
    expect(globals).toContain("GPUValidationError");
    expect(globals).toContain("Pick<typeof globalThis,");
    const runtime = await import(eventsOutput);
    expect(runtime.inputEventTypes).toEqual(["closeRequest", "minimize", "restore", "metrics", "key", "text", "pointerMove", "pointerButton", "scroll", "focus", "pointerCapture"]);
    expect(Object.isFrozen(runtime.inputEventTypes)).toBe(true);
    expect(content).toContain("GPUCanvasConfiguration");
    expect(content).toContain("GPURequestAdapterOptions");
    expect(content).toContain("GPUTexture");
    expect(content).toContain("arg1?: WindowOptions");
    const modified = (await stat(output, { bigint: true })).mtimeNs;
    const eventsModified = (await stat(eventsOutput, { bigint: true })).mtimeNs;
    expect(await generateDeclarations(addon, output)).toBe(false);
    expect((await stat(output, { bigint: true })).mtimeNs).toBe(modified);
    expect((await stat(eventsOutput, { bigint: true })).mtimeNs).toBe(eventsModified);
    await Bun.write(output, "stale");
    expect(await generateDeclarations(addon, output)).toBe(true);
    expect(await Bun.file(output).text()).toBe(content);
    await Bun.write(globalsOutput, "stale globals");
    expect(await generateDeclarations(addon, output)).toBe(true);
    expect(await Bun.file(globalsOutput).text()).toBe(globals);
    await rm(globalsOutput);
    expect(await generateDeclarations(addon, output)).toBe(true);
    expect(await Bun.file(globalsOutput).text()).toBe(globals);
    const refreshed = (await stat(output, { bigint: true })).mtimeNs;
    await Bun.write(eventsOutput, "stale event names");
    expect(await generateDeclarations(addon, output)).toBe(true);
    expect(await Bun.file(eventsOutput).text()).toBe(events);
    expect((await stat(output, { bigint: true })).mtimeNs).toBe(refreshed);
    await rm(eventsOutput);
    expect(await generateDeclarations(addon, output)).toBe(true);
    expect(await Bun.file(eventsOutput).text()).toBe(events);
    await rm(output);
    expect(await generateDeclarations(addon, output)).toBe(true);
    expect(await Bun.file(output).text()).toBe(content);
    expect(await Bun.file(eventsOutput).text()).toBe(events);
    await expect(generateDeclarations(resolve(directory, "missing.node"), output)).rejects.toThrow();
    expect(await Bun.file(output).text()).toBe(content);
    expect(await Bun.file(eventsOutput).text()).toBe(events);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
