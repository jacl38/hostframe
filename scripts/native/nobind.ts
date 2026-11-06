import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { buildRoot, root } from "./release";

function expectCount(content: string, anchor: string | RegExp, count: number, file: string) {
  const matches = typeof anchor === "string" ? content.split(anchor).length - 1 : [...content.matchAll(anchor)].length;
  if(matches !== count) throw new Error(`nobind patch mismatch in ${file}: expected ${count} matches for ${anchor}, found ${matches}.`);
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
  const seen = new Set<string>();
  for await (const name of new Bun.Glob("*.h").scan(source)) {
    let content = await Bun.file(resolve(source, name)).text();
    seen.add(name);
    const expected: Record<string, Array<[string | RegExp, number]>> = {
      "nobind.h": [["    auto r = napi_add_async_cleanup_hook(", 1], ["    auto instance = env_.GetInstanceData<BaseEnvInstanceData>();", 1], ["    Nobind::InitMainThreadQueue<Nobind::EnvInstanceData<INSTANCE_DATA_TYPE>>(env);", 1], ["    env.SetInstanceData(instance);", 1]],
      "nohelpers.h": [["template <typename T> void RunOnJSMainThread(Napi::BasicEnv env, std::function<void()> &&job) {", 1]],
      "noobject.h": [["sizeof...(ARGS)", 3], ["#include <uv.h>", 1]],
      "notypes.h": [["if (actual != expected)", 1]],
      "notypescript.h": [["  std::vector<std::string> types{FromTSType<ARGS>()...};", 1], ["    types_text += \"arg\"s + std::to_string(i) + \": \"s + types[i];", 1]]
    };
    for(const [anchor, count] of expected[name] ?? []) expectCount(content, anchor, count, name);
    if(name === "nofunction.h" || name === "noobject.h") {
      expectCount(content, /} catch \(const std::exception &e\) \{\n(\s*)throw Napi::Error::New\(env, e.what\(\)\);/g, name === "nofunction.h" ? 1 : 2, name);
    }
    expectCount(content, /(\w+)\.GetInstanceData<([^>]+)>\(\)/g, name === "nobind.h" ? 1 : name === "noobject.h" ? 7 : name === "nohelpers.h" ? 2 : 0, name);
    if(name !== "nobind.h") expectCount(content, "    env.SetInstanceData(instance);", 0, name);
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
  for(const name of ["nobind.h", "nohelpers.h", "noobject.h", "nofunction.h", "notypes.h", "notypescript.h"]) {
    if(!seen.has(name)) throw new Error(`Missing nobind header ${name}.`);
  }
}
