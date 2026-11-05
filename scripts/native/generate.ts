import { $ } from "bun";
import { createHash } from "node:crypto";
import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { buildRoot, dawnRoot, lock, root } from "./release";

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
  // Patch a build-owned copy, leaving vendor/dawn unchanged.
  const binding = resolve(buildRoot, "binding/src/dawn/node");
  await rm(binding, { recursive: true, force: true });
  await mkdir(binding, { recursive: true });
  await cp(resolve(dawnRoot, "src/dawn/node"), binding, { recursive: true });
  const deviceHeader = resolve(binding, "binding/GPUDevice.h");
  const text = await Bun.file(deviceHeader).text();
  const anchor = "    void ForceLoss(wgpu::DeviceLostReason reason, const char* message);";
  if(text.split(anchor).length !== 2) {
    throw new Error("Native-device accessor patch no longer matches Dawn's GPUDevice.h.");
  }
  await Bun.write(deviceHeader, text.replace(anchor, `${anchor}\n\n    wgpu::Device GetNativeDevice() const { return device_; }`));
  // InstanceOf also accepts Object.create(GPU.prototype). Such objects have no
  // native wrapper; upstream Unwrap dereferences it without checking for null.
  const wrapperTemplate = resolve(binding, "interop/WebGPU.cpp.tmpl");
  const templateText = await Bun.file(wrapperTemplate).text();
  const unwrap = "  return Wrappers::W{{$.Name}}::Unwrap(object)->impl.get();";
  if(templateText.split(unwrap).length !== 2) throw new Error("Interface-wrapper guard no longer matches Dawn's template.");
  await Bun.write(wrapperTemplate, templateText.replace(unwrap, `  void* wrapped = nullptr;
  if (napi_unwrap(object.Env(), object, &wrapped) != napi_ok || !wrapped) return nullptr;
  return static_cast<Wrappers::W{{$.Name}}*>(wrapped)->impl.get();`));
  // Keep surface-aware adapter selection on the same path as upstream selection:
  // flags, backend choice, feature level, and power preference remain authoritative.
  const gpuHeader = resolve(binding, "binding/GPU.h");
  const gpuSource = resolve(binding, "binding/GPU.cpp");
  const header = await Bun.file(gpuHeader).text();
  const source = await Bun.file(gpuSource).text();
  const declaration = "    interop::GPUTextureFormat getPreferredCanvasFormat(Napi::Env) override;";
  const definition = "    interop::GPURequestAdapterOptions options) {";
  const selection = "        adapter = &a;";
  if(header.split(declaration).length !== 2 || source.split(definition).length !== 2 || source.split(selection).length !== 2) {
    throw new Error("Surface-aware adapter patch no longer matches Dawn's GPU binding.");
  }
  await Bun.write(gpuHeader, header.replace(declaration, `${declaration}
    wgpu::Instance GetNativeInstance() const { return wgpu::Instance(instance_->Get()); }
    interop::Promise<std::optional<interop::Interface<interop::GPUAdapter>>> requestAdapterForSurface(
        Napi::Env env, interop::GPURequestAdapterOptions options, wgpu::Surface surface);`));
  await Bun.write(gpuSource, source.replace(definition, `${definition}
    return requestAdapterForSurface(env, std::move(options), nullptr);
}

interop::Promise<std::optional<interop::Interface<interop::GPUAdapter>>> GPU::requestAdapterForSurface(
    Napi::Env env, interop::GPURequestAdapterOptions options, wgpu::Surface surface) {`)
    .replace(selection, `        // EnumerateAdapters ignores compatibleSurface; filter explicitly.
        if (surface) {
            wgpu::SurfaceCapabilities capabilities;
            if (surface.GetCapabilities(a, &capabilities) != wgpu::Status::Success ||
                capabilities.formatCount == 0) continue;
        }
${selection}`)
    .replace("    if (!adapter) {", `    if (!adapter && surface) {
        promise.Resolve({});
        return promise;
    }
    if (!adapter) {`));
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

/**
 * nobind17 2.0.1's module initializer unconditionally calls uv_async_init, which
 * Bun 1.3.14 aborts on. This addon only registers synchronous methods and owns
 * its native shared_ptrs itself. Keep the adaptation in a build-owned copy.
 */
export async function prepareNobind() {
  const metadata = await Bun.file(resolve(root, "node_modules/nobind17/package.json")).json();
  if(metadata.version !== "2.0.1") throw new Error("Review the synchronous nobind adaptation before upgrading nobind17.");
  const source = resolve(root, "node_modules/nobind17/include");
  const destination = resolve(buildRoot, "nobind");
  await mkdir(destination, { recursive: true });
  for await (const name of new Bun.Glob("*.h").scan(source)) {
    let content = await Bun.file(resolve(source, name)).text();
    if(name === "nobind.h") {
      const start = content.indexOf("    auto r = napi_add_async_cleanup_hook(");
      const end = content.indexOf("#ifndef NOBIND_NO_TYPESCRIPT_GENERATOR", start);
      if(start < 0 || end < 0) throw new Error("nobind synchronous cleanup patch no longer matches.");
      content = content.slice(0, start) + content.slice(end);
      content = content.replace("    auto instance = env_.GetInstanceData<BaseEnvInstanceData>();", "    [[maybe_unused]] auto instance = env_.GetInstanceData<BaseEnvInstanceData>();");
      const queue = "    Nobind::InitMainThreadQueue<Nobind::EnvInstanceData<INSTANCE_DATA_TYPE>>(env);";
      if(!content.includes(queue)) throw new Error("nobind synchronous initialization patch no longer matches.");
      content = content.replace(queue, "");
    }
    if(name === "nohelpers.h") {
      content = `#pragma once
#include <nonapi.h>
#include <functional>
#include <thread>
namespace Nobind {
template <typename T> void RunOnJSMainThread(Napi::Env env, std::function<void()> &&job) {
  auto instance = env.GetInstanceData<T>();
  if(!instance) return;
  if(instance->_Nobind_js_thread != std::this_thread::get_id()) std::terminate();
  job();
}
}
`;
    }
    if(name === "noobject.h") {
      content = content.replaceAll("sizeof...(ARGS)", "(0 + ... + Nobind::InputCount<ARGS>())");
      content = content.replace("#include <uv.h>", "struct uv_async_s;\nusing uv_async_t = uv_async_s;");
    }
    if(name === "nofunction.h" || name === "noobject.h") {
      // The synchronous wrappers otherwise replace TypeError/RangeError with
      // Error. Preserve JS error identity and category at the typed boundary.
      content = content.replace(/} catch \(const std::exception &e\) \{\n(\s*)throw Napi::Error::New\(env, e.what\(\)\);/g,
        "} catch (const Napi::Error &) {\n$1throw;\n$1} catch (const std::exception &e) {\n$1throw Napi::Error::New(env, e.what());");
    }
    if(name === "notypes.h") {
      // Required typemaps reject undefined themselves; optional typemaps accept
      // it. Extra arguments still fail. Constructors retain their arity table.
      content = content.replace("if (actual != expected)", "if (actual > expected)");
      content += `
namespace Nobind {
template <class T> constexpr size_t InputCount() {
  if constexpr(requires { FromJS_t<T>::Inputs; }) return FromJS_t<T>::Inputs;
  else return 1;
}
}
`;
    }
    if(name === "notypescript.h") {
      const signature = "    types_text += \"arg\"s + std::to_string(i) + \": \"s + types[i];";
      if(!content.includes(signature)) throw new Error("nobind optional declaration patch no longer matches.");
      content = content.replace("  std::vector<std::string> types{FromTSType<ARGS>()...};",
        "  std::vector<std::string> types{FromTSType<ARGS>()...};\n  std::vector<bool> optional{requires { FromJS_t<ARGS>::IsOptional; }...};");
      content = content.replace(signature, "    types_text += \"arg\"s + std::to_string(i) + (optional[i] ? \"?: \"s : \": \"s) + types[i];");
    }
    // napi_set_instance_data is already owned by Dawn's interop constructors.
    content = content.replace(/(\w+)\.GetInstanceData<([^>]+)>\(\)/g, "static_cast<$2*>(hostframe::NobindData($1))");
    content = content.replace("    env.SetInstanceData(instance);", "    hostframe::InstallNobindData(env, instance, [](void* data) { delete static_cast<Nobind::EnvInstanceData<INSTANCE_DATA_TYPE>*>(data); });");
    const output = Bun.file(resolve(destination, name));
    if(!await output.exists() || await output.text() !== content) await Bun.write(output, content);
  }
}
