import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { Application, Key } from "../../../index.ts";
import type { InputEvent } from "../../../index.ts";

const execute = promisify(execFile);

async function xdo(...args: string[]) {
  return (await execute("xdotool", args, { timeout: 3000 })).stdout.trim();
}

async function layout(name: string, variant?: string) {
  const args = ["-layout", name];
  if(variant) args.push("-variant", variant);
  await execute("setxkbmap", args, { timeout: 3000 });
}

async function verifyText(name: string, variant: string | undefined, keys: string[], expected: string, physicalKey: number) {
  await layout(name, variant);
  const app = new Application();
  try {
    const window = app.createWindow({ title: "hostframe text input verification", width: 320, height: 180 });
    const id = (await xdo("search", "--onlyvisible", "--pid", String(process.pid), "--name", "^hostframe text input verification$")).split("\n")[0]!;
    const events: InputEvent[] = [];
    window.on("key", event => { events.push(event); });
    window.on("text", event => { events.push(event); });
    async function until(predicate: () => boolean, message: string) {
      const deadline = performance.now() + 4000;
      while(!predicate()) {
        assert.ok(performance.now() < deadline, `${message}; recent events: ${JSON.stringify(events.slice(-8))}`);
        app.pollEvents();
        await setTimeout(10);
      }
    }
    await xdo("windowactivate", "--sync", id);
    await until(() => window.input.focused, `${name}${variant ? ` ${variant}` : ""} window did not focus`);
    for(const key of keys) await xdo("key", key);
    const codepoint = expected.codePointAt(0)!;
    await until(() => events.some(event => event.type === "text" && event.codepoint === codepoint), `${name}${variant ? ` ${variant}` : ""} text input missing ${expected}`);
    assert.ok(events.some(event => event.type === "key" && event.key === physicalKey), "Text input must preserve its physical key event");
  } finally {
    app.dispose();
  }
}

if(process.platform !== "linux") throw new Error("X11 text-input verification requires Linux");
try {
  // A fresh GLFW session observes the new server keymap. Under the German
  // layout, keysym y is at the physical Z position.
  await verifyText("de", undefined, ["y"], "y", Key.Z);
  // US international turns dead acute plus the physical E key into a committed
  // non-ASCII character.
  await verifyText("us", "intl", ["dead_acute", "e"], "é", Key.E);
  console.log(`${process.versions.bun ? "Bun" : "Node.js"}: alternate-layout and dead-key Unicode text input passed.`);
} finally {
  await layout("us");
}
