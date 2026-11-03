# Linux x64 packaging

Start with [GitHub Releases](github-releases.md) for the release workflow,
local `gh act` verification, draft creation, and installation from release assets.

The initial package is one `hostframe` tarball containing ESM JavaScript,
bundled TypeScript declarations, a Linux x64/glibc native addon, native
third-party notices, and documentation. No install script downloads or builds
native code. CommonJS and other platform binaries are not included.

## Build and pack

Start with the [native build prerequisites](native-build.md), then:

```sh
bun install
bun run setup
bun run build
npm pack
# Alternatively: bun pm pack
```

`bun run build` rebuilds the project-owned native target and extracts its
declarations before tsdown bundles `index.ts`. It copies the freshly built
addon and gathers native dependency licenses into `dist/`. A failed build
removes `dist/` so an older successful output cannot be packed accidentally.
`prepack` runs this build automatically for both npm and Bun. Do not use
`--ignore-scripts` when preparing a release tarball.

`tsdown.config.ts` replaces the internal native loader's development path with
`./hostframe.node`. Source examples continue loading the addon from
`build/native/cmake/`; the installed package has no checkout-relative imports.
Generated GLFW constants, input event names, and native declarations are
bundled into the published JavaScript and types.

The package `files` allowlist includes only `dist/` and `docs/`, plus npm's
automatically included manifest, README, and project license when present.
No examples, setup scripts, downloaded sources, native build trees, or build
dependencies are shipped. Inspect the contents with `npm pack --dry-run`.

## Consumer requirements

- Linux x64 using glibc. Alpine/musl is unsupported.
- An X11 display (including Xwayland), usable Vulkan loader/driver, and the
  X11 runtime libraries used by GLFW. The local addon links to `libX11.so.6`,
  `libXfixes.so.3`, `libstdc++.so.6`, `libgcc_s.so.1`, `libm.so.6`, and libc;
  X11 additionally brings in libxcb and libXau on this system.
- Node.js 22.18+ or Bun. Runtime verification here uses Node.js 26.7.0 and
  Bun 1.3.14; the minimum declared Node version has not been tested.
- TypeScript consumers receive `@webgpu/types` through a normal dependency.
  The bundled declarations reference it automatically. Its browser base types
  require a compatible DOM type library even for native applications. The
  consumer check uses TypeScript 5.9.3 with `lib: ["ES2022", "DOM"]` and no
  Bun or Node ambient types. This supplies types, not browser APIs at runtime.

This build is intentionally scoped to the current Fedora 44 machine. Its ELF
symbol requirements include **glibc 2.43** and **GLIBCXX 3.4.32**. The manifest
restricts installation to Linux/x64/glibc, but does not enforce those library
versions; older systems can fail at addon load. A broadly portable Linux
release needs an older controlled build baseline and distribution testing.
Node-API does not eliminate libc, C++ runtime, GPU driver, or window-system
requirements.

After installing a tarball, import from the package:

```ts
import { Application } from "hostframe";
```

Use the rendering and disposal flow in the [README](../README.md). Installed
consumers do not run `setup` or use Bun's build tooling.

## Verify the distributable

```sh
bun run lint
bun run typecheck
bun test scripts packages/core/test
bun run native:verify
bun run package:verify
```

`package:verify` requires npm, Node, Bun, tar, a display, and Vulkan. It invokes
`npm pack` with the real `prepack` lifecycle and checks the tarball's required
files and allowlist. It then installs that tarball with scripts disabled in
separate temporary npm and Bun projects outside the checkout. Each project
typechecks public declarations with `skipLibCheck: false` and runs both Node
and Bun against the installed package. Runtime checks cover failed display
initialization and retry, input constants, GPU compute/readback, three
presented frames through the application loop, window recreation, repeated
disposal, and rejected operations after disposal. Temporary consumers are
removed; the tarball remains in `build/package/`.

For headless software-driver verification, with the required tools installed:

```sh
VK_DRIVER_FILES=/usr/share/vulkan/icd.d/lvp_icd.x86_64.json \
  xvfb-run -d -s '-screen 0 800x600x24' bun run package:verify
```

That ICD path and Xvfb's `-d` option are specific to this Fedora environment.
The check exercises the X11/software Vulkan path and does not establish
physical GPU presentation or monitor pacing. X11 sockets and dependency
downloads may require running outside a restricted sandbox.

On this system, a package-manager shim intercepts `npm` in Bun projects. Use
the actual Node installation's `bin/` directory first on `PATH` when running
the npm commands and `package:verify`.

Verified on Fedora 44 x64 with Node.js 26.7.0, Bun 1.3.14, TypeScript 5.9.3,
tsdown 0.23.4, Xvfb, and Mesa lavapipe: both clean consumer installations and
all checks described above passed. Lint, repository typechecking (also with
`dist/` absent), all 36 existing tests, and `native:verify --presentation`
passed. An intentionally failed native build also confirmed removal of stale
`dist/` output. These checks do not establish compatibility with older Linux
distributions or untested runtime versions.

## Before registry publication

The manifest uses prerelease version `0.1.0-alpha.0`. No command above publishes
to the registry. Confirm npm name availability and ownership, and verify the
exact tarball before publication. hostframe is licensed under Apache-2.0;
the root `LICENSE` is included in the package. Native notices are assembled from pinned Dawn inputs and binding
packages; recheck the additional license copies under
`scripts/package/licenses/` whenever updating Dawn.

Adding another platform later can move addons into platform-specific optional
dependency packages while retaining the same public `hostframe` API.
