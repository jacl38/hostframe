# Intel hardware presentation validation

Validated on 2026-10-31. The C++ presentation check, Node.js, and Bun all rendered
and presented using the integrated Intel GPU. Software Vulkan was excluded.
The example's eight captured windows were visually inspected.

The [2026-11-01 follow-up](presentation-performance.md) revalidates the combined
resize, input and generated-binding implementation on Intel and compares its
performance with software rendering through the same compositor. The original
results below remain a record of the earlier implementation.

## Environment

| Component | Observed value |
| --- | --- |
| Host | Fedora 44 x64, kernel `7.0.12-201.fc44.x86_64` |
| GPU | Intel Alder Lake-N integrated graphics, PCI `8086:46d1` |
| Render node | `/dev/dri/renderD128` |
| Vulkan driver | Intel ANV, Mesa `26.2.5-1.fc44` |
| Vulkan loader | `1.4.341.0-1.fc44` |
| Compositor | KWin `6.6.5`, virtual backend, OpenGL/EGL on Intel |
| X server | Xwayland `24.1.12-1.fc44`, DRI3 and Present available |
| Output | `Virtual-0`, 1280×720, scale 1, nominal 60 Hz |
| Runtimes | Node.js `26.7.0`, Bun `1.3.14` |
| Dawn | Pinned release `v20261026.205545`; unchanged engine and dependency pins |

Execution required access outside the agent's device sandbox, which hides
`/dev/dri`. The render node was accessible to the user; access to the primary DRM
node was unnecessary. No packages, DRM permissions, login-session settings, or
physical outputs were changed. KWin used a private runtime directory, configuration
directory, and D-Bus session. The temporary compositor was stopped after checks.

`glxinfo -B` reported direct rendering, `Accelerated: yes`, and
`Mesa Intel(R) Graphics (ADL-N)`. KWin's `supportInformation` independently reported
active OpenGL compositing on the same Intel renderer. `vulkaninfo --summary`
enumerated exactly one device: the Intel integrated GPU, using the Intel
open-source Mesa driver. Xwayland held the Intel render node open.

Every GPU check ran with:

```sh
VK_DRIVER_FILES=/usr/share/vulkan/icd.d/intel_icd.x86_64.json
DAWNNODE_BACKEND=vulkan
TS_DAWN_EXPECT_VENDOR=intel
```

The ICD path is host-specific. The first setting excludes lavapipe and other
Vulkan ICDs; the second explicitly selects Dawn's Vulkan backend. The verifier
logs each fixture's adapter identity, and `TS_DAWN_EXPECT_VENDOR` additionally
requires the expected vendor and rejects CPU/fallback adapters in the JavaScript
and C++ checks. The example logs vendor/device and fallback status. Captured
example processes loaded `libvulkan_intel.so` and did not load `libvulkan_lvp.so`.

## Results

| Check | Result |
| --- | --- |
| `bun run native:build` | Passed; audit accepted 64 units with no Dawn engine/Tint compilation |
| Compute/readback | Passed in Node.js and Bun on Intel |
| C++ GLFW/X11/Vulkan | 60 frames acquired, rendered, and presented |
| JavaScript window/lifecycle suite | Passed in Node.js and Bun with forced GC |
| Scheduler and GPU/host progress | Passed in Node.js and Bun |
| Presentation settings | FIFO and Immediate, capped and uncapped, passed in both runtimes |
| Shutdown without explicit disposal | Both processes exited normally with a live application/window |
| External close | `xdotool windowquit` stopped the `--external-close` fixture normally in both runtimes |
| Solid-color example | All four settings exited normally in each runtime; eight captures inspected |
| Software negative controls | Node.js, Bun, and C++ rejected lavapipe with expected vendor `intel` |
| Xvfb/lavapipe regression suite | Full presentation suite passed after the fix, without the hardware assertion |
| Lint, typecheck, deterministic/script tests | Passed; 25 tests, zero failures |

The lifecycle suite exercises callback exceptions and recovery, asynchronous
callback rejection, reentrancy guards, expired frame textures, failed creation,
window replacement within a session, application disposal with a live window,
caller-device survival, destroyed devices, and process shutdown. It now also
repeatedly opens new applications while retaining the process GPU.

The example captures cover default FIFO, FIFO with `--max-fps=30`, Immediate with
`--no-vsync`, and Immediate with `--no-vsync --max-fps=144`. All eight client images
were 320×240, uniformly sRGB `(63, 89, 231)`, consistent with the blue clear color
on the selected sRGB surface. The settings fixture separately tests a 30 FPS cap
for both modes and verifies fixed `dt = 1 / 120`.

Evidence is generated under `build/native/hardware-presentation/` and ignored by
Git: `verify.log`, `verify-lavapipe.log`, `build.log`, `tests.log`, `glxinfo.txt`,
`vulkaninfo.txt`, `xdpyinfo.txt`, `kwin-support.txt`, `capture.log`, `pixels.txt`,
per-runtime example/close logs, and software-rejection logs. Individual captures
are `{node,bun}-{fifo,immediate}-{capped,uncapped}.png`; `examples.png` shows all
eight. Temporary diagnostic and capture programs in that directory are evidence,
not project source or build inputs.

## Issue found and fixed

The first hardware run passed C++ presentation but failed the JavaScript lifecycle
fixture after disposing one application and creating another. Xlib terminated
the client on `BadRequest`, XFIXES opcode 138, minor opcode 5 (`CreateRegion`).

A debugger trace showed XFixes version negotiation on the first XCB connection.
After GLFW closed it, a later session reused that connection address. Mesa then
created regions without negotiating XFixes on the new connection. Its Vulkan WSI
connection cache lives with the retained GPU instance and is keyed by connection
address; see the [Mesa WSI implementation](https://chromium.googlesource.com/external/gitlab.freedesktop.org/mesa/mesa/+/e0abbc613dce5df23b245dc3d8486e5d144c0dfa/src/vulkan/wsi/wsi_common_x11.c).

ts-dawn now calls the public
[`XFixesQueryVersion`](https://xorg.freedesktop.org/archive/current/doc/man/man3/Xfixes.3.xhtml)
on every new GLFW session before surface use. This initializes the new connection
even when Mesa reuses its cached entry. Xfixes is now an explicit native build
dependency. No upstream source or engine patch was needed. Both hardware runtimes
and the software regression suite passed with repeated application recreation.

## Reproduce the hardware environment

Use installed KWin/Xwayland, D-Bus, GLX/Vulkan diagnostic tools, and the prepared
native build. Run from the repository root with access to the Intel render node.
Xvfb cannot substitute for this display: its missing DRI3 prevents Intel Vulkan
presentation even though Intel compute and offscreen rendering work.

Create a temporary session application that records the display selected by KWin
and keeps the isolated display alive:

```sh
mkdir -p build/native/hardware-presentation/{runtime,config,cache}
chmod 700 build/native/hardware-presentation/runtime
cat > build/native/hardware-presentation/session.ts <<'EOF'
await Bun.write(`${import.meta.dir}/display.json`, JSON.stringify({
  DISPLAY: process.env.DISPLAY,
  XAUTHORITY: process.env.XAUTHORITY ?? "",
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
  DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS
}, null, 2));
setInterval(() => {}, 60_000);
EOF

env -u DISPLAY -u WAYLAND_DISPLAY \
  XDG_RUNTIME_DIR="$PWD/build/native/hardware-presentation/runtime" \
  XDG_CONFIG_HOME="$PWD/build/native/hardware-presentation/config" \
  XDG_CACHE_HOME="$PWD/build/native/hardware-presentation/cache" \
  KWIN_COMPOSE=O2 \
  dbus-run-session -- kwin_wayland \
    --virtual --width 1280 --height 720 --scale 1 --output-count 1 \
    --xwayland --socket ts-dawn-hardware \
    --no-lockscreen --no-global-shortcuts --no-kactivities \
    --exit-with-session "$(command -v bun) $PWD/build/native/hardware-presentation/session.ts"
```

In another terminal, use the recorded environment rather than assuming `:0` or a
particular X authority path. This run used `:0` with no separate authority file.

```sh
bun run native:build
bun -e '
const display = await Bun.file("build/native/hardware-presentation/display.json").json();
const child = Bun.spawn(["bun", "run", "native:verify", "--presentation"], {
  env: {
    ...process.env,
    ...display,
    VK_DRIVER_FILES: "/usr/share/vulkan/icd.d/intel_icd.x86_64.json",
    DAWNNODE_BACKEND: "vulkan",
    TS_DAWN_EXPECT_VENDOR: "intel"
  },
  stdout: "inherit",
  stderr: "inherit"
});
process.exitCode = await child.exited;
'
```

Under the same display/driver environment, check `xdpyinfo -queryExtensions`,
`glxinfo -B`, and `vulkaninfo --summary` before interpreting a successful suite as
hardware evidence. Run `node examples/vanilla/solid-color.ts` and
`bun examples/vanilla/solid-color.ts` with the flags above; locate each visible client
using `xdotool search --onlyvisible --pid <pid>` and capture it with
`import -window <id> <output.png>` while it is rendering. For external-close checks,
run `packages/native/test/loop.ts --external-close`, then send
`xdotool windowquit <id>`. Global shortcuts are disabled in this session, so
Alt+F4 is not a valid close-test driver. Stop the temporary compositor with Ctrl+C
after all client processes have exited.

Always isolate `XDG_CACHE_HOME` together with `XDG_CONFIG_HOME`. The original
instructions omitted it; the [example performance investigation](example-performance.md#resolved-cause-shared-kde-service-cache)
found that sharing the desktop's KDE service cache causes repeated synchronous
cache rebuilds in the private compositor and severe presentation stalls. The
[hardware display launcher](../scripts/benchmarks/display.ts) applies this isolation
and saves the selected display environment and command logs automatically.

## Remaining limits

This validates Intel GPU rendering and X11 acquire/render/present through DRI3
and Xwayland, including an Intel-accelerated compositor. The output is virtual;
physical scanout, standalone Xorg/modesetting, monitor refresh pacing, tearing,
latency, VRR, and throughput were not measured. A selected Immediate mode does not
prove visible tearing, and the virtual 60 Hz output does not verify a physical
144 Hz presentation rate. Native GLFW Wayland support remains unimplemented in
this build. Mailbox-only surfaces and unsupported hardware present-mode policies
retain deterministic selection coverage, not physical-surface validation.

The existing process GPU root and bounded swapchain cleanup remain in place.
The five-second stalled-device fallback, exhaustive GC/shutdown behavior, resize,
multiple windows, other GPUs, operating systems, and packaged distribution remain
outside these checks.
