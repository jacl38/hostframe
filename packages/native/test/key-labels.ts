import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Application, Key, getKeyName } from "../../../index.ts";

const app = new Application();
try {
  assert.equal(getKeyName(Key.UNKNOWN), "UNKNOWN");
  const scan = app.getKeyScancode(Key.A);
  assert.ok(scan !== undefined && scan >= 0);
  assert.equal(app.getKeyLabel(Key.A), "a");
  assert.equal(app.getKeyLabel(Key.UNKNOWN, scan), "a");
  assert.equal(app.getKeyLabel(Key.ESCAPE), "ESCAPE");
  assert.equal(app.getKeyLabel(Key.UNKNOWN), "UNKNOWN");
  assert.equal(app.getKeyLabel(Key.UNKNOWN, app.getKeyScancode(Key.ESCAPE)), "UNKNOWN");
  assert.equal(app.getKeyLabel(987654), "UNKNOWN");
  assert.equal(app.getKeyScancode(Key.UNKNOWN), undefined);
  assert.equal(app.getKeyScancode(987654), undefined);
  assert.throws(() => app.getKeyLabel(NaN), /32-bit/);
  assert.throws(() => app.getKeyScancode(1.5), /32-bit/);
  assert.throws(() => app.getKeyLabel(Key.UNKNOWN, Infinity), /32-bit/);
  if(process.platform === "linux") {
    // Each verifier has a private X server. Restore the initial US test layout.
    try {
      app.dispose();
      execFileSync("setxkbmap", ["-layout", "de"]);
      const german = new Application();
      try {
        assert.equal(german.getKeyLabel(Key.Z), "y");
        assert.equal(german.getKeyScancode(Key.A), scan);
      } finally {
        german.dispose();
      }
      console.log("German layout label verified: Key.Z -> y");
    } finally {
      execFileSync("setxkbmap", ["-layout", "us"]);
    }
  }
} finally {
  app.dispose();
}
assert.throws(() => app.getKeyLabel(Key.A), /disposed/);
assert.throws(() => app.getKeyScancode(Key.A), /disposed/);
console.log("Native key labels passed");
