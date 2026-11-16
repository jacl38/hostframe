# Windows x64 packaging

Windows packages are staged separately from the root Linux package. On Windows
x64, use an x64 Visual Studio 2026 developer command prompt with the C++ and
ATL components, Windows SDK, Clang, Ninja, Go, Python, Node and Bun available.
Set `CC=clang` and `CXX=clang++` as described in [native build](native-build.md).

```bat
bun install
bun run setup
bun scripts/native.ts dxc
bun run native:verify --window-interactions
bun run package:verify
bun run release:prepare
```

The DXC command checks out the exact revision required by Dawn's DEPS,
initializes the source's pinned submodules, and builds the compiler separately
from Dawn with the optional SPIR-V backend disabled. It records the DLL hash
and revision in generated build output.
Packaging checks that record and the source checkout before copying the DLL and
upstream licenses. The DXC build may take several minutes. The source build and
package are not guaranteed to be bit-for-bit reproducible across toolchains.

`package:verify` stages win32/x64 package metadata, packs the addon and
compiler, and exercises fresh npm and Bun consumers with Node and Bun.
`release:prepare` checks the package and writes a Windows-named tarball,
checksum and release notes under `build/release-windows`. To attach these to
an existing draft, copy them to `build/release/windows` and run
`bun scripts/release/assets.ts attach-windows` in the tagged release
environment. This does not publish the draft.

Release preparation requires a full (non-headless) `package:verify` run for
the same tarball; a headless run does not establish presentation behavior.

The Windows validation job caches only the DXC DLL, its license files, and its
build record. Its exact cache key includes the pinned inputs, build recipe,
Windows architecture, MSVC version, Visual Studio version, and SDK version.
An exact hit is checked against Dawn's pinned revisions and recorded hashes;
otherwise CI builds DXC and saves the result after the job succeeds. The hosted
job runs the headless package checks, not interactive presentation verification.

The package requires a compatible D3D12 GPU and driver and the Microsoft C++
runtime. Only the systems and runtimes actually tested in the release notes
are verified.
