import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

// Run inside the isolated hardware display supplied by scripts/benchmarks/display.ts.
const [entry, runtime = "bun", purpose = "record"] = process.argv.slice(2);
assert.ok(entry && ["cornell-box", "kinetic", "flow"].includes(entry), "Choose cornell-box, kinetic or flow");
assert.ok(["bun", "node"].includes(runtime), "Runtime must be bun or node");
assert.ok(["record", "verify"].includes(purpose), "Purpose must be record or verify");
assert.ok(process.env.DISPLAY, "Run through scripts/benchmarks/display.ts");
const root = resolve(import.meta.dir, "../..");
const directory = resolve(root, `build/examples/polished/${purpose}-${runtime}-${entry}-${Date.now()}`);
await mkdir(directory, { recursive: true });
console.log(`Capture artifacts: ${directory}`);

async function command(args: string[]) {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", timeout: 15_000 });
  const [code, output, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  assert.equal(code, 0, `${args[0]}: ${errors}`);
  return output.trim();
}

const app = Bun.spawn([runtime, "scripts/examples/capture-app.ts", entry, directory, runtime], {
  cwd: root, stdout: Bun.file(`${directory}/app.log`), stderr: Bun.file(`${directory}/app.stderr`), timeout: 165_000
});
let recorder: ReturnType<typeof Bun.spawn> | undefined;
try {
  const deadline = performance.now() + 65_000;
  while(!(await Bun.file(`${directory}/ready.json`).exists())) {
    assert.equal(app.exitCode, null, await Bun.file(`${directory}/app.stderr`).text());
    assert.ok(performance.now() < deadline, "Example did not become ready");
    await setTimeout(100);
  }
  const id = (await command(["xdotool", "search", "--onlyvisible", "--pid", String(app.pid)])).split("\n")[0]!;
  await command(["xdotool", "windowmove", "--sync", id, "20", "40", "windowactivate", "--sync", id]);
  if(entry === "cornell-box") {
    while(!(await Bun.file(`${directory}/app.log`).text()).includes("Cornell box converged")) {
      assert.equal(app.exitCode, null, await Bun.file(`${directory}/app.stderr`).text());
      assert.ok(performance.now() < deadline, "Cornell box did not finish denoising");
      await setTimeout(200);
    }
  } else await setTimeout(1000);
  await command(["import", "-window", id, `${directory}/${entry}.png`]);

  if(purpose === "record") {
    const duration = entry === "cornell-box" ? 60 : 16;
    const started = Date.now();
    recorder = Bun.spawn([
      "ffmpeg", "-n", "-nostdin", "-hide_banner", "-loglevel", "warning", "-f", "x11grab",
      "-framerate", "60", "-video_size", "1200x800", "-window_id", id, "-draw_mouse", "0", "-i", process.env.DISPLAY!,
      "-t", String(duration), "-c:v", "libx264rgb", "-preset", "ultrafast", "-crf", "0", "-threads", "2",
      "-pix_fmt", "bgr24", "-enc_time_base", "1:1000000", "-fps_mode", "passthrough", `${directory}/capture.nut`
    ], { stdout: "ignore", stderr: Bun.file(`${directory}/capture.log`), timeout: (duration + 10) * 1000 });
    await setTimeout(2000);
    if(entry === "cornell-box") await command(["xdotool", "key", "--window", id, "p"]);
    await command(["xdotool", "mousemove", "--window", id, "580", "400", "mousedown", "1"]);
    const actions = ["xdotool"];
    for(let i = 1; i <= 180; i++) actions.push("mousemove", "--window", id, String(Math.round(580 + i / 4)), String(Math.round(400 - i / 18)), "sleep", "0.016");
    actions.push("mouseup", "1");
    await command(actions);
    if(entry === "cornell-box") {
      await command(["xdotool", "key", "--window", id, "p"]);
    } else {
      await setTimeout(2000);
      await command(["xdotool", "key", "--window", id, "m"]);
      if(entry === "flow") {
        await setTimeout(2000);
        await command(["xdotool", "key", "--window", id, "c"]);
      }
    }
    assert.equal(await recorder.exited, 0, "Video capture failed");
    await Bun.write(`${directory}/capture.json`, JSON.stringify({ started, ended: Date.now(), duration, fps: 60, width: 1200, height: 800 }));
    await command(["import", "-window", id, `${directory}/${entry}-after.png`]);
  } else {
    // Exercise pause/resume, material/palette changes, resize, orbit, minimize and restore.
    if(entry === "cornell-box") await command(["xdotool", "key", "--window", id, "b", "p", "2"]);
    else await command(["xdotool", "key", "--window", id, "space", "m"]);
    if(entry === "flow") await command(["xdotool", "key", "--window", id, "c"]);
    await command(["xdotool", "windowsize", "--sync", id, "1000", "700"]);
    await command(["xdotool", "mousemove", "--window", id, "500", "350", "mousedown", "1", "mousemove", "--window", id, "540", "360", "mouseup", "1"]);
    await setTimeout(1000);
    await command(["import", "-window", id, `${directory}/${entry}-resized.png`]);
    await command(["xdotool", "windowminimize", "--sync", id]);
    await setTimeout(500);
    await command(["xdotool", "windowmap", "--sync", id, "windowactivate", "--sync", id]);
    await command(["xdotool", "windowsize", "--sync", id, "1200", "800"]);
    if(entry === "cornell-box") {
      await command(["xdotool", "key", "--window", id, "p", "3", "d"]);
      await setTimeout(750);
      await command(["import", "-window", id, `${directory}/${entry}-raw.png`]);
      await command(["xdotool", "key", "--window", id, "b", "r", "d"]);
    } else await command(["xdotool", "key", "--window", id, "space"]);
    await setTimeout(1500);
    await command(["import", "-window", id, `${directory}/${entry}-restored.png`]);
  }
  await command(["xdotool", "key", "--window", id, "q"]);
  assert.equal(await app.exited, 0, await Bun.file(`${directory}/app.stderr`).text());
  const errors = await Bun.file(`${directory}/app.stderr`).text();
  assert.ok(!/validation:|error:/i.test(errors), errors);
  const timing = await Bun.file(`${directory}/timing.json`).json();
  assert.ok(timing.moves > 0, "Native pointer input did not arrive");
  if(purpose === "verify") assert.ok(timing.resizes >= 2, "Resize/restore did not render");
  console.log(`PASS ${runtime} ${entry} ${purpose}`);
} finally {
  if(recorder && recorder.exitCode === null) { recorder.kill("SIGINT"); await recorder.exited; }
  if(app.exitCode === null) { app.kill(); await app.exited; }
}
