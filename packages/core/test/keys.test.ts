import { expect, test } from "bun:test";
import { Key, getKeyName } from "../keys.ts";

test("all generated key tokens round trip through a canonical name", () => {
  for(const value of Object.values(Key)) {
    const name = getKeyName(value);
    expect(name).toBeDefined();
    expect(Key[name!]).toBe(value);
  }
  expect(getKeyName(Key.UNKNOWN)).toBe("UNKNOWN");
  for(const value of [NaN, Infinity, 1.5, 987654]) expect(getKeyName(value)).toBeUndefined();
});
