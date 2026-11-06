import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateInputConstants, resolveInputConstants } from "./input-constants";

const fixture = `
/* #define GLFW_KEY_NOT_A_KEY 999 */
#define GLFW_KEY_UNKNOWN -1
#define GLFW_KEY_0 48
#define GLFW_KEY_W 0x57 /* W */
#define GLFW_KEY_LEFT_SHIFT 340
#define GLFW_KEY_KP_ENTER 335
#define GLFW_KEY_LAST GLFW_KEY_KP_ENTER
#define GLFW_MOUSE_BUTTON_LEFT GLFW_MOUSE_BUTTON_1
#define GLFW_MOUSE_BUTTON_RIGHT GLFW_MOUSE_BUTTON_2
#define GLFW_MOUSE_BUTTON_MIDDLE GLFW_MOUSE_BUTTON_3
#define GLFW_MOUSE_BUTTON_1 0
#define GLFW_MOUSE_BUTTON_2 1
#define GLFW_MOUSE_BUTTON_3 2
#define GLFW_MOUSE_BUTTON_4 3
#define GLFW_MOUSE_BUTTON_LAST GLFW_MOUSE_BUTTON_4
#define GLFW_MOD_SHIFT 0x0001
#define GLFW_MOD_CONTROL 0x0002 // control
`;
const temporary: string[] = [];

afterEach(async () => {
  for(const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function resolveFixture(header: string) {
  const directory = await mkdtemp(resolve(tmpdir(), "hostframe GLFW compiler "));
  temporary.push(directory);
  const path = resolve(directory, "glfw3.h");
  await Bun.write(path, header);
  return resolveInputConstants(path);
}

test("compiler resolves GLFW signed/hex values and forward aliases without exposing sentinels", async () => {
  expect(await resolveFixture(fixture)).toEqual({
    Key: { UNKNOWN: -1, ZERO: 48, W: 87, LEFT_SHIFT: 340, KP_ENTER: 335 },
    PointerButton: { LEFT: 0, RIGHT: 1, MIDDLE: 2, ONE: 0, TWO: 1, THREE: 2, FOUR: 3 },
    Modifier: { SHIFT: 1, CONTROL: 2 }
  });
  const changed = fixture.replace("GLFW_MOUSE_BUTTON_1 0", "GLFW_MOUSE_BUTTON_1 10");
  const values = await resolveFixture(changed);
  expect(values.PointerButton.LEFT).toBe(10);
  expect(values.PointerButton.ONE).toBe(10);
});

test("only standalone digits are renamed; new keys, suffixes and aliases remain automatic", async () => {
  const digits = Array.from({ length: 9 }, (_, index) => `#define GLFW_KEY_${index + 1} (GLFW_KEY_0 + ${index + 1})`).join("\n");
  const values = await resolveFixture(`${fixture}\n${digits}
#define GLFW_KEY_KP_0 GLFW_KEY_0
#define GLFW_KEY_LEFT__SHIFT GLFW_KEY_LEFT_SHIFT
#define GLFW_KEY_FUTURE_KEY (GLFW_KEY_W + 100)
#define GLFW_KEY_ALIAS GLFW_KEY_FUTURE_KEY
`);
  expect(values.Key).toMatchObject({
    ZERO: 48,
    ONE: 49,
    TWO: 50,
    THREE: 51,
    FOUR: 52,
    FIVE: 53,
    SIX: 54,
    SEVEN: 55,
    EIGHT: 56,
    NINE: 57,
    KP_0: 48,
    LEFT__SHIFT: 340,
    FUTURE_KEY: 187,
    ALIAS: 187
  });
  for(const digit of Array.from({ length: 10 }, (_, index) => String(index))) {
    expect(Object.hasOwn(values.Key, digit)).toBe(false);
  }
  for(const group of Object.values(values)) expect(Object.hasOwn(group, "LAST")).toBe(false);
  expect(Object.hasOwn(values.Key, "LeftShift")).toBe(false);
  expect(Object.hasOwn(values.Key, "Digit0")).toBe(false);
});

test("compiler evaluates expressions, integer suffixes, casts, octal and active conditional branches", async () => {
  const header = fixture
    .replace("GLFW_MOD_SHIFT 0x0001", "GLFW_MOD_SHIFT (1U << 4)")
    .replace("GLFW_MOD_CONTROL 0x0002", "GLFW_MOD_CONTROL static_cast<int>(010UL | 2U)") + `
#if 0
#define GLFW_KEY_INACTIVE 999
#define GLFW_KEY_W 88
#endif
#if defined(__cplusplus)
#define GLFW_KEY_TEST (GLFW_KEY_W + 1)
#endif
`;
  const values = await resolveFixture(header);
  expect(values.Modifier).toEqual({ SHIFT: 16, CONTROL: 10 });
  expect(values.Key.W).toBe(87);
  expect(values.Key.TEST).toBe(88);
  expect(values.Key.INACTIVE).toBeUndefined();
});

for(const [name, header] of [
  ["unsafe integer", fixture.replace("GLFW_MOD_SHIFT 0x0001", "GLFW_MOD_SHIFT 9007199254740992")],
  ["unsigned overflow", fixture.replace("GLFW_MOD_SHIFT 0x0001", "GLFW_MOD_SHIFT 0xffffffffffffffffULL")],
  ["missing alias", fixture.replace("GLFW_MOUSE_BUTTON_LEFT GLFW_MOUSE_BUTTON_1", "GLFW_MOUSE_BUTTON_LEFT GLFW_MOUSE_BUTTON_MISSING")],
  ["cyclic alias", fixture.replace("GLFW_MOUSE_BUTTON_1 0", "GLFW_MOUSE_BUTTON_1 GLFW_MOUSE_BUTTON_LEFT")],
  ["duplicate name", `${fixture}\n#define GLFW_KEY_ZERO 341`],
  ["missing group", fixture.replace(/^#define GLFW_MOD_.*$/gm, "")]
] as const) {
  test(`invalid constants fail: ${name}`, async () => {
    await expect(resolveFixture(header)).rejects.toThrow();
  });
}

test("generation recreates missing/stale output, tracks header changes and leaves unchanged output untouched", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "hostframe GLFW constants "));
  temporary.push(directory);
  const header = resolve(directory, "glfw3.h");
  const output = resolve(directory, "generated/input.ts");
  await Bun.write(header, fixture);
  expect(await generateInputConstants(header, output)).toBe(true);
  const content = await Bun.file(output).text();
  const modified = (await stat(output, { bigint: true })).mtimeNs;
  expect(await generateInputConstants(header, output)).toBe(false);
  expect((await stat(output, { bigint: true })).mtimeNs).toBe(modified);

  // Exercise the generated module in both runtimes, including literal-type syntax.
  const generated = await import(pathToFileURL(output).href);
  expect(generated.Key.W).toBe(87);
  expect(generated.Key.ZERO).toBe(48);
  expect(generated.Key.LEFT_SHIFT).toBe(340);
  expect(generated.Key.KP_ENTER).toBe(335);
  expect(generated.PointerButton.ONE).toBe(generated.PointerButton.LEFT);
  expect(generated.Modifier.SHIFT).toBe(1);
  expect(Object.isFrozen(generated.Key)).toBe(true);
  expect(Object.isFrozen(generated.PointerButton)).toBe(true);
  expect(Object.isFrozen(generated.Modifier)).toBe(true);
  const check = resolve(directory, "check.ts");
  const result = resolve(directory, "node-values.json");
  await Bun.write(check, `import { writeFile } from "node:fs/promises";
const values = await import(process.argv[2]!);
await writeFile(process.argv[3]!, JSON.stringify(values));
`);
  const child = Bun.spawn(["node", check, pathToFileURL(output).href, result], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 5000
  });
  const errors = await new Response(child.stderr).text();
  const code = await child.exited;
  if(code !== 0) throw new Error(`Generated module failed in Node.js (${code}): ${errors}`);
  const values = await Bun.file(result).json();
  expect(errors).toBe("");
  expect(values).toEqual(JSON.parse(JSON.stringify(generated)));

  await Bun.write(output, "stale output");
  expect(await generateInputConstants(header, output)).toBe(true);
  expect(await Bun.file(output).text()).toBe(content);
  await rm(output);
  expect(await generateInputConstants(header, output)).toBe(true);
  expect(await Bun.file(output).text()).toBe(content);
  await Bun.write(header, fixture.replace("GLFW_KEY_W 0x57", "GLFW_KEY_W 0x58"));
  expect(await generateInputConstants(header, output)).toBe(true);
  expect(await Bun.file(output).text()).toContain("W: 88");
  expect(await Bun.file(output).text()).not.toBe(content);
  // This integration test regenerates four compiler fixtures and invokes Node;
  // give the combined work a budget distinct from a single compiler fixture.
}, 20_000);

test("invalid headers leave existing generated output intact", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "hostframe GLFW invalid "));
  temporary.push(directory);
  const header = resolve(directory, "glfw3.h");
  const output = resolve(directory, "input.ts");
  await Bun.write(header, fixture);
  await generateInputConstants(header, output);
  const content = await Bun.file(output).text();
  await Bun.write(header, fixture.replace("GLFW_KEY_W 0x57", "GLFW_KEY_W unknown_expression()"));
  await expect(generateInputConstants(header, output)).rejects.toThrow();
  expect(await Bun.file(output).text()).toBe(content);
});
