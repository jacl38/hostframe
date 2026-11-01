import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateInputConstants, parseInputConstants } from "./input-constants";

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

test("GLFW constants preserve names, signed/hexadecimal values and forward aliases without exposing sentinels", () => {
  expect(parseInputConstants(fixture)).toEqual({
    Key: { Unknown: -1, Digit0: 48, W: 87, LeftShift: 340, KpEnter: 335 },
    PointerButton: { Left: 0, Right: 1, Middle: 2, Button4: 3 },
    Modifier: { Shift: 1, Control: 2 }
  });
  const changed = fixture.replace("GLFW_MOUSE_BUTTON_1 0", "GLFW_MOUSE_BUTTON_1 10");
  expect(parseInputConstants(changed).PointerButton.Left).toBe(10);
});

test("unsupported or inconsistent GLFW definitions fail instead of silently producing incorrect values", () => {
  for(const [text, message] of [
    [fixture.replace("GLFW_MOD_SHIFT 0x0001", "GLFW_MOD_SHIFT (1 << 0)"), "Unsupported GLFW definition"],
    [fixture.replace("GLFW_MOD_SHIFT 0x0001", "GLFW_MOD_SHIFT 010"), "Unsupported GLFW definition"],
    [fixture.replace("GLFW_MOD_SHIFT 0x0001", "GLFW_MOD_SHIFT 9007199254740992"), "Unsafe GLFW integer"],
    [fixture.replace("GLFW_MOUSE_BUTTON_LEFT GLFW_MOUSE_BUTTON_1", "GLFW_MOUSE_BUTTON_LEFT GLFW_MOUSE_BUTTON_MISSING"), "Missing GLFW definition"],
    [fixture.replace("GLFW_MOUSE_BUTTON_1 0", "GLFW_MOUSE_BUTTON_1 GLFW_MOUSE_BUTTON_LEFT"), "Cyclic GLFW alias"],
    [`${fixture}\n#define GLFW_KEY_W 88`, "Duplicate GLFW definition"],
    [`${fixture}\n#define GLFW_KEY_LEFT__SHIFT 341`, "Duplicate public GLFW name"],
    [fixture.replace(/^#define GLFW_MOD_.*$/gm, ""), "Missing GLFW constants"]
  ] as const) {
    expect(() => parseInputConstants(text)).toThrow(message);
  }
});

test("generation recreates missing/stale output, tracks header changes and leaves unchanged output untouched", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ts-dawn GLFW constants "));
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
});

test("invalid headers leave existing generated output intact", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ts-dawn GLFW invalid "));
  temporary.push(directory);
  const header = resolve(directory, "glfw3.h");
  const output = resolve(directory, "input.ts");
  await Bun.write(header, fixture);
  await generateInputConstants(header, output);
  const content = await Bun.file(output).text();
  await Bun.write(header, fixture.replace("GLFW_KEY_W 0x57", "GLFW_KEY_W unknown_expression()"));
  await expect(generateInputConstants(header, output)).rejects.toThrow("Unsupported GLFW definition");
  expect(await Bun.file(output).text()).toBe(content);
});
