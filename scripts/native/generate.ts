import { $ } from "bun";
import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { buildRoot, dawnRoot, lock, root } from "./release";
import { patchDawnBindings } from "./dawn-patches";

const outputs = [
  "binding/src/dawn/node/binding/GPUDevice.h",
  "binding/src/dawn/node/binding/GPU.h",
  "generated/src/dawn/node/interop/WebGPU.h",
  "generated/src/dawn/node/interop/WebGPU.cpp",
  "generated/src/dawn/utils/ComboLimits.h",
  "generated/src/dawn/utils/ComboLimits.cpp"
];

async function generationKey() {
  return createHash("sha256")
    .update(JSON.stringify(lock))
    .update(await Bun.file(import.meta.path).text())
    .update(await Bun.file(resolve(import.meta.dir, "dawn-patches.ts")).text())
    .digest("hex");
}

export async function assertGeneratedBindings() {
  const marker = Bun.file(resolve(buildRoot, ".generated-inputs"));
  if(!await marker.exists() || (await marker.text()).trim() !== await generationKey()) {
    throw new Error("Missing or stale generated bindings. Run bun run setup.");
  }
  for(const output of outputs) {
    if(!await Bun.file(resolve(buildRoot, output)).exists()) {
      throw new Error(`Missing ${output}. Run bun run setup.`);
    }
  }
}

export async function generateBindings() {
  try {
    await assertGeneratedBindings();
    console.log("Generated bindings already match the pinned inputs.");
    return;
  } catch {
    // Regenerate incomplete output or output from another pinned input set.
  }
  await rm(resolve(buildRoot, ".generated-inputs"), { force: true });
  await patchDawnBindings();
  const binding = resolve(buildRoot, "binding/src/dawn/node");
  await mkdir(resolve(buildRoot, "generated"), { recursive: true });
  // Generate with upstream tools only; these are build dependencies, not project scripts.
  const env = {
    ...process.env,
    GOCACHE: resolve(buildRoot, "cache/go-build"),
    GOMODCACHE: resolve(buildRoot, "cache/go-mod"),
    GOTOOLCHAIN: "local",
    GOFLAGS: "-mod=readonly"
  };
  for(const extension of ["h", "cpp"]) {
    const template = resolve(binding, `interop/WebGPU.${extension}.tmpl`);
    const output = resolve(buildRoot, `generated/src/dawn/node/interop/WebGPU.${extension}`);
    const idls = [resolve(binding, "interop/Browser.idl"), resolve(dawnRoot, "third_party/gpuweb/webgpu.idl"), resolve(binding, "interop/DawnExtensions.idl")];
    await $`go run ./tools/src/cmd/idlgen/main.go --template ${template} --output ${output} ${idls}`.cwd(dawnRoot).env(env);
  }
  const generatorArguments = [
    resolve(dawnRoot, "generator/dawn_json_generator.py"),
    "--dawn-json", resolve(dawnRoot, "src/dawn/dawn.json"),
    "--targets", "dawn_utils",
    "--template-dir", resolve(dawnRoot, "generator/templates"),
    "--root-dir", dawnRoot,
    "--output-dir", resolve(buildRoot, "generated"),
    "--jinja2-path", resolve(dawnRoot, "third_party/jinja2"),
    "--markupsafe-path", resolve(dawnRoot, "third_party/markupsafe")
  ];
  await $`python3 ${generatorArguments}`.cwd(root).env({ ...process.env, PYTHONDONTWRITEBYTECODE: "1" });
  await Bun.write(resolve(buildRoot, ".generated-inputs"), `${await generationKey()}\n`);
}
