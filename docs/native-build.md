# Native build

The initial setup supports **Linux x64 with GLFW/X11 and Vulkan**. Other platforms
fail explicitly before downloading an incompatible engine. This is a source
contributor workflow; distributing prebuilt addons to application developers is
still planned.

## Commands

```sh
bun install
bun run setup
bun run native:verify
# With an X11 display available:
bun run native:verify --presentation
```

- `setup`: check prerequisites, download and verify pinned inputs, generate
  bindings, configure CMake, and build the addon and native presentation check.
- `native:build`: rebuild prepared native sources without downloading or running
  generators. Rerun `setup` after changing the pinned inputs or generation script.
- `native:check-build`: inspect `compile_commands.json` and reject unexpected
  sources, including Dawn's engine, Tint, and upstream's proc-table module entry.
- `native:verify`: load the same addon in Node.js and Bun, dispatch a compute
  shader, and assert the mapped readback values. Each runtime has a 30-second
  timeout. The shared TypeScript fixture is in `packages/native/test/compute.ts`
  so both runtimes execute identical code directly; Node.js uses built-in type
  stripping, and `typecheck` checks it with the standard WebGPU definitions. It also
  exercises invalid GPU flags and ordinary device cleanup.
- `native:verify --presentation`: additionally run a C++ executable that creates
  a GLFW window and acquires, clears, and presents 60 frames through Dawn. This
  checks native window/surface integration separately from the JavaScript binding;
  the proposed JavaScript window/context API is not implemented.
- `lint`, `typecheck`, `test`: check project scripts and setup regression tests.

The addon is `build/native/cmake/ts_dawn.node`. Its `create` and `globals` exports
are internal building blocks for verification, not the proposed public API.

## Script organization

All package commands route through `scripts/native.ts`. Setup and build share one
lock and error handler. Command execution uses Bun Shell's `$`, with arguments
interpolated separately and working directories/environments scoped to each call.
Runtime checks use `Bun.spawn` for their timeouts and signal diagnostics.

```text
scripts/
  native.ts                  # CLI, locking, runtime verification
  native/
    dawn.lock.json           # Exact dependency data, including artifact layouts
    release.ts               # Load data, resolve paths, select the host artifact
    dependencies.ts          # Download, verify, extract, fetch pinned Git commits
    generate.ts              # Copy/patch bindings and run upstream generators
    build.ts                 # Prerequisites, CMake, compilation audit
    native.test.ts           # Regression tests
```

The compilation audit runs directly after CMake configuration and before building.
There is no additional Bun subprocess for the audit. Go and CMake enforce their
minimum versions from upstream `go.mod` and our `CMakeLists.txt`, respectively;
TypeScript does not keep a second copy of those version requirements.

## Prerequisites

Install these through your preferred system/toolchain manager before setup:

- Bun for repository scripts; Node.js with built-in TypeScript stripping for
  runtime verification.
- Git, curl, and tar for pinned dependency retrieval and extraction.
- CMake >= 3.22, Ninja, and a C++20 compiler with a compatible C++ standard library.
- Go >= 1.26, as required by this Dawn revision's `go.mod`.
- Python 3 for Dawn's generator. Jinja2 and MarkupSafe come from Dawn's pinned
  dependencies; no global pip installation is needed.
- Linux X11 development headers/libraries needed by GLFW, including Xrandr,
  Xinerama, Xcursor, Xi, and Xshape, plus `pkg-config`.
- A Vulkan loader and usable driver for runtime checks. Mesa software Vulkan can
  be useful on machines without a physical GPU, but driver capabilities vary.
- An X11 display for presentation. A headless machine can use an existing Xvfb
  installation, for example `xvfb-run -a bun run native:verify --presentation`.

Setup reports missing prerequisites and compiler/configuration failures; it never
installs system packages. CMake's GLFW configuration diagnoses missing X11 headers.
A successful build does not establish GPU driver compatibility.

CMake selects the host compiler. Set `CC` and `CXX` before the first setup to
select another compiler. When changing compilers, remove `build/native/cmake/`
first. The initial configuration builds Release native code with C++20.

`ccache` is optional and used automatically when present. Its cache, and Go's
module/build caches, live under `build/native/cache/`. Set `TS_DAWN_JOBS` to a
positive integer to change build parallelism (default: 2, to limit binding compile
memory use). Formatting and static analysis tooling for C++ are not configured yet.

## Pinned inputs and ownership

[`scripts/native/dawn.lock.json`](../scripts/native/dawn.lock.json) is the authoritative
lock manifest. It pins Dawn release `v20261026.205545`, revision
`5fbd545292cb7a4a9a275e322abec6007ffe2ae8`, and SHA-256 digests for the engine,
headers, source archive, and archive-based dependencies. Engine/header digests
come from the upstream release metadata. Source/dependency archive digests were
recorded from the specified immutable commit URLs. It also records extraction
layout, supported host artifacts, and archive/Git dependency revisions. These are
explicit pins, not automatic latest-version lookups. `release.ts` only adapts that
data to local paths and selects a supported host artifact.

The source archive is extracted to ignored `vendor/dawn/`. It is not a submodule
and must not be treated as ordinary project-owned source. Setup retrieves only
node-api-headers, node-addon-api, GPUWeb IDL, GLFW, Jinja2, and MarkupSafe from the
revisions listed in that Dawn revision's `DEPS`. It checks the manifest against
`DEPS` without executing the Python manifest or Dawn's full dependency fetcher.

Jinja2 and MarkupSafe use shallow Git checkouts verified against exact commit
object IDs: Gitiles archives contain variable metadata, making an archive checksum
unsuitable. Other downloaded archives are checksum-verified before extraction,
including cached downloads on subsequent setup runs. Extraction uses a temporary
directory; incomplete downloads/extractions do not become installed dependencies.
Existing unrecognized source directories are never overwritten.

Go and Python code remains upstream in `vendor/dawn/`. Our scripts are TypeScript.
Go resolves only the generator's needed modules using upstream `go.mod`/`go.sum`,
with readonly module metadata and automatic toolchain downloading disabled.

[`scripts/native/generate.ts`](../scripts/native/generate.ts) copies the binding
into `build/native/binding/`, adds the binding-only
`GPUDevice::GetNativeDevice()` accessor, and runs upstream generators for
`WebGPU.h/.cpp` and `ComboLimits.h/.cpp`. It does not modify the vendored binding.
Generated inputs are stamped so repeat setup runs can reuse them. These directories
are build-owned; edit the scripts or project-owned native sources instead.

The build script passes the locked library and include paths into CMake. The
current target imports **`engine/lib64/libwebgpu_dawn.a`**. The separate headers
archive happens to contain a library too, but we use only its headers. CMake never
adds Dawn's top-level project, builds Tint, or substitutes an engine source build
when an archive is unavailable.

On Linux, the addon hides symbols from linked static archives. This prevents ELF
symbol interposition from mixing Dawn's bundled Abseil with the version embedded
in Node.js. The addon entry point initializes upstream interop and calls the
monolithic engine's C entry points directly, without `dawnProcSetProcs`.

The current upstream binding's child objects do not keep their originating GPU
owner alive. The compute fixture pins that owner globally for the process lifetime,
including queued callbacks and teardown. A module-local variable alone proved
insufficient under Bun's garbage collector. The future application/context layer
must enforce this ownership relationship; the low-level addon is not yet a safe
standalone application API.

## Recovery and updates

Downloads are cached in `build/native/downloads/`. A checksum mismatch fails
explicitly; remove the named archive before retrying. A mismatched or unrecognized
installed dependency also fails explicitly; move the reported directory aside
before rerunning setup. Source archives can change upstream despite an immutable
URL, so investigate checksum changes rather than accepting new digests blindly.

Setup/build share `build/native/.lock` to prevent concurrent mutations. A hard
interruption can leave this directory behind; remove it only after confirming no
setup/build is still running. Normal errors release the lock.

To update Dawn, select a release with a usable engine archive, record its exact
source revision and asset digests in `dawn.lock.json`, update selected dependencies to match `DEPS`,
and verify their archive digests or Git IDs. Recheck the accessor anchor and source
allowlist, regenerate from clean inputs, and rerun build, compute, and presentation
checks. Never combine a newer source checkout with an older engine.

## Verified locally

On Fedora 44 x64 with GCC 16.1.1, CMake 4.3.0, Ninja 1.13.2, Go 1.26.10,
Python 3.14.5, Node.js 26.7.0, and Bun 1.3.14:

- Fresh dependency retrieval, generation, and linking against the release archive.
- Repeat `setup` reused generated sources and Ninja reported no work.
- Build audit accepted 62 selected compilation units and rejected engine/Tint
  sources in regression tests.
- Compute/readback passed in both runtimes, including ordinary process exit.
- The native presentation executable rendered and presented 60 frames under
  Xvfb/X11 using Mesa lavapipe Vulkan. A captured window was inspected.
- Missing-display initialization failed cleanly. Corrupt downloads, reuse of
  installed dependencies, refusal to overwrite existing directories, rejected
  partial downloads, and unsupported hosts were covered by script tests.
- TypeScript lint and type checking passed.
- After consolidating the scripts, archive and Git retrieval were exercised with
  paths containing spaces; tests also covered dirty/stale Git checkouts, cleanup
  after a failed Git fetch, and invalid CLI commands/flags.

This machine has several Vulkan ICDs installed. Default driver enumeration logs
failures for unavailable hardware drivers while compute still succeeds. For the
headless presentation check we selected the installed lavapipe ICD with
`VK_DRIVER_FILES=/usr/share/vulkan/icd.d/lvp_icd.x86_64.json`; that path is
machine-specific and is not forced by the setup scripts.

## Validation limits

The native presentation executable tests the engine/helper directly. It does not
establish JavaScript surface texture wrapping, multi-window scheduling, thread
handoff, complete GC/disposal correctness, or the proposed application API.
macOS, Windows, Linux arm64, Wayland, distribution packaging, and performance
remain unverified.
