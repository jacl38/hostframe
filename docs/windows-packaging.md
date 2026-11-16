# Windows x64 packaging

Windows packages are staged separately from the root Linux package. On Windows
x64, use an x64 Visual Studio developer prompt with the C++ workload, Windows
SDK, Clang, Ninja, Go, Python, Node and Bun available. Set `CC=clang` and
`CXX=clang++` as described in [native build](native-build.md).

```bat
bun install
bun run setup
bun run native:verify --window-interactions
bun run package:verify
bun run release:prepare
```

Packaging downloads Microsoft's DXC v1.9.2609 release and verifies the pinned
archive and individual file hashes before including its x64 compiler, validator,
and license files. This prebuilt release differs from Dawn's source dependency
revision; the combination has been tested on the Windows system described in
[native build](native-build.md). No DXC source compilation is needed.

`package:verify` stages Windows package metadata, packs the addon and DXC,
and exercises fresh npm and Bun consumers with Node and Bun, including window
presentation. The Windows release job runs these checks on a GitHub-hosted
runner using Microsoft Basic Render Driver; physical GPU testing is separate.

`release:prepare` requires a full `package:verify` run for the same tarball;
it writes a Windows-named tarball, checksum and release notes under
`build/release-windows`. On a matching tag push, the release workflow attaches
the verified assets to the draft. The draft still requires manual publication.

The package requires a compatible D3D12 GPU and driver and the Microsoft C++
runtime. Only the systems and runtimes actually tested in the release notes
are verified.
