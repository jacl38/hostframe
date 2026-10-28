import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { assertDependencies } from "./dependencies";
import { assertGeneratedBindings } from "./generate";
import { buildRoot, dawnRoot, getEngine, headers, root } from "./release";

export function checkPrerequisites(forSetup = false) {
  getEngine();
  const tools = ["git", "cmake", "ninja", process.env.CXX || "c++", process.env.CC || "cc"];
  if(forSetup) tools.push("curl", "tar", "go", "python3", "pkg-config");
  const missing = tools.filter(tool => !Bun.which(tool));
  if(missing.length > 0) {
    throw new Error(`Missing native build prerequisites: ${missing.join(", ")}. Install these tools and retry; setup does not install system packages.`);
  }
  // CMake enforces cmake_minimum_required; Go enforces upstream go.mod.
}

type CompileCommand = { file: string };

export function assertBuildSources(commands: CompileCommand[]) {
  if(commands.length === 0) throw new Error("Empty native compilation database.");
  for(const { file } of commands) {
    const path = resolve(file);
    const own = relative(resolve(root, "packages/native/src"), path);
    const generated = ["src/dawn/node/interop/WebGPU.cpp", "src/dawn/utils/ComboLimits.cpp"]
      .includes(relative(resolve(buildRoot, "generated"), path));
    const bindingPath = relative(resolve(buildRoot, "binding/src/dawn/node"), path);
    const binding = /^binding\/[^/]+\.cpp$/.test(bindingPath) || ["interop/Core.cpp", "ManualConstructors.cpp"].includes(bindingPath);
    const glfw = relative(resolve(dawnRoot, "third_party/glfw3/src"), path);
    const presentationCheck = path === resolve(root, "packages/native/test/presentation.cpp");
    const helper = path === resolve(dawnRoot, "src/dawn/glfw/utils.cpp");
    const inside = [own, glfw].some(part => part !== ".." && !part.startsWith("../") && !part.startsWith("/"));
    if(!inside && !generated && !binding && !helper && !presentationCheck) throw new Error(`Unexpected native source (engine/Tint builds are forbidden): ${path}`);
    if(path.endsWith("/src/dawn/node/Module.cpp")) throw new Error("Upstream proc-table module entry point must not be compiled.");
  }
  return commands.length;
}

export async function checkBuild() {
  const commands: CompileCommand[] = await Bun.file(resolve(buildRoot, "cmake/compile_commands.json")).json();
  console.log(`Verified ${assertBuildSources(commands)} native sources: no Dawn engine or Tint compilation.`);
}

export async function buildNative() {
  const jobs = process.env.TS_DAWN_JOBS || "2";
  if(!/^[1-9]\d*$/.test(jobs)) throw new Error("TS_DAWN_JOBS must be a positive integer.");
  await assertDependencies();
  await assertGeneratedBindings();
  const env = { ...process.env, CCACHE_DIR: resolve(buildRoot, "cache/ccache") };
  await mkdir(env.CCACHE_DIR, { recursive: true });
  const engine = getEngine();
  const launcher = Bun.which("ccache") || "";
  const options = [
    "-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON",
    `-DTS_DAWN_BUILD_ROOT=${buildRoot}`,
    `-DTS_DAWN_ENGINE_LIBRARY=${resolve(engine.destination, engine.sentinel)}`,
    `-DTS_DAWN_HEADERS_INCLUDE=${resolve(headers.destination, headers.includeDirectory)}`,
    `-DCMAKE_C_COMPILER_LAUNCHER=${launcher}`,
    `-DCMAKE_CXX_COMPILER_LAUNCHER=${launcher}`
  ];
  const directory = resolve(buildRoot, "cmake");
  await $`cmake -S ${resolve(root, "packages/native")} -B ${directory} -G Ninja ${options}`.cwd(root).env(env);
  await checkBuild();
  await $`cmake --build ${directory} --parallel ${jobs}`.cwd(root).env(env);
  console.log(`Native addon: ${resolve(directory, "ts_dawn.node")}`);
}
