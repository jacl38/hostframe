import assert from "node:assert/strict";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { $ } from "bun";

const directories = process.argv.slice(2).map(directory => resolve(directory));
assert.equal(directories.length, 3, "Pass the cornell-box, kinetic and flow capture directories, in that order");
const output = resolve(import.meta.dir, "../../build/examples/polished/final");
await mkdir(output, { recursive: true });
const summaries = [];
for(const [index, entry] of ["cornell-box", "kinetic", "flow"].entries()) {
  const directory = directories[index]!;
  const capture = await Bun.file(`${directory}/capture.json`).json();
  const timing = await Bun.file(`${directory}/timing.json`).json();
  const target = `${output}/${entry}.mp4`;
  await $`ffmpeg -n -nostdin -v warning -i ${`${directory}/capture.nut`} -t ${capture.duration} -vf fps=60,scale=out_color_matrix=bt709 -c:v libx264 -threads 2 -preset medium -crf 18 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -r 60 -fps_mode cfr -movflags +faststart ${target}`;
  const probe = await $`ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_read_frames:format=duration,size -of json ${target}`.json();
  assert.equal(probe.streams[0].avg_frame_rate, "60/1");
  assert.equal(Number(probe.streams[0].nb_read_frames), capture.duration * 60);
  assert.equal(probe.streams[0].width, 1200);
  assert.equal(probe.streams[0].height, 800);
  await $`ffmpeg -v error -i ${target} -f null -`;
  await copyFile(`${directory}/${entry}.png`, `${output}/${entry}.png`);
  await copyFile(`${directory}/${entry}-after.png`, `${output}/${entry}-after.png`);
  const frames: Array<{ at: number, interval: number, dropped: number }> = timing.timeline.filter((frame: { at: number }) => frame.at >= capture.started && frame.at <= capture.ended);
  const intervals = frames.map(frame => frame.interval).toSorted((a, b) => a - b);
  summaries.push({
    entry, source: directory, adapter: timing.adapter, presentMode: timing.mode, duration: capture.duration,
    nativeRenderCallbacksDuringCapture: frames.length,
    nativeIntervalMedianMs: intervals[Math.floor(intervals.length * 0.5)],
    nativeIntervalP99Ms: intervals[Math.floor(intervals.length * 0.99)],
    droppedSimulationSeconds: frames.reduce((sum, frame) => sum + frame.dropped, 0),
    note: "60 Hz screen sampling and 60 FPS encoding; progressive path tracing has a separate sample rate.",
    probe
  });
  console.log(`Validated ${target}`);
}
await Bun.write(`${output}/clips.txt`, ["cornell-box", "kinetic", "flow"].map(entry => `file '${entry}.mp4'`).join("\n") + "\n");
await $`ffmpeg -n -v error -f concat -safe 0 -i ${`${output}/clips.txt`} -c copy -movflags +faststart ${`${output}/showcase.mp4`}`;
await $`ffmpeg -v error -i ${`${output}/showcase.mp4`} -f null -`;
await $`ffmpeg -n -v error -i ${`${output}/cornell-box.png`} -i ${`${output}/kinetic.png`} -i ${`${output}/flow.png`} -filter_complex hstack=inputs=3,scale=1800:400 -frames:v 1 ${`${output}/gallery.png`}`;
await Bun.write(`${output}/validation.json`, JSON.stringify(summaries, null, 2));
console.log(`Finished screenshots and videos: ${output}`);
