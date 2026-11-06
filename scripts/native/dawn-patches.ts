import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { buildRoot, dawnRoot } from "./release";

export async function patchDawnBindings() {
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
  if(header.split(declaration).length !== 2 || source.split(definition).length !== 2 || source.split(selection).length !== 2 || source.split("    if (!adapter) {").length !== 2) {
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
}
