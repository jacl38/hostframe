# Continuous validation

`.github/workflows/validation.yml` runs on pull requests and master pushes.
A weekly schedule and manual dispatch run the full gallery. The release build
also runs the full gallery and interaction/output checks before preparing assets.

| Gate | Commands and evidence |
| --- | --- |
| Every change, including documentation | Locked install, `bun run lint`, build-independent compiler/tooling, release-tooling, scheduler/timing and validation-runner tests |
| Any non-Markdown/non-LICENSE change | `bun run setup`, `bun run typecheck`, full `bun test scripts packages/core/test`, native interactions, representative examples, composition readback, real packed consumers |
| Weekly/manual/release | Same native checks plus every entry in the example catalog in both runtimes |

The fast job explicitly excludes declaration extraction and input-listener tests:
these depend on the compiled addon/generated event contract. The full suite runs
only after setup creates them. Unknown file paths, including code under `docs/`,
require integration. A missing diff base conservatively runs integration.
There are no path-filtered required workflows left waiting on documentation PRs.

Native setup uses the pinned Dawn inputs and project-owned CMake source audit.
Only checksum-verified downloaded archives are cached for native builds, keyed
by OS, architecture and the Dawn lockfile; CMake output is never restored across
checkouts. Bun's setup action caches its dependency downloads. Dependency caches
contain no credentials. All actions use commit pins, checkout disables persisted
credentials, and validation has `contents: read` with no release/publish step or
secrets. PR code runs under `pull_request`, never `pull_request_target`.
See GitHub's [cache security guidance](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching).

## Local Linux commands

After `bun install --frozen-lockfile` and `bun run setup`:

```sh
bun run lint
bun run typecheck
bun test scripts packages/core/test
# Select a software Vulkan implementation explicitly on headless hosts.
export VK_DRIVER_FILES=/usr/share/vulkan/icd.d/lvp_icd.x86_64.json
bun scripts/validation/desktop-check.ts
bun scripts/validation/desktop.ts bun scripts/native.ts verify --window-interactions
bun scripts/validation/desktop.ts bun scripts/examples.ts --verify --representative
bun scripts/validation/desktop.ts node scripts/validation/renderer-output.ts
bun scripts/validation/desktop.ts bun scripts/validation/renderer-output.ts
bun scripts/validation/desktop.ts bun scripts/package/verify.ts
# Full gallery, including slower scenes:
bun scripts/validation/desktop.ts bun scripts/examples.ts --verify
```

The desktop runner requires Linux, Xvfb with `-displayfd`, xauth,
dbus-run-session, kwin_x11, xdotool, xprop and ImageMagick `import`.
It reports missing tools; it never installs host packages. Use actual Node/Bun
executables on PATH rather than version-manager shims that download a different
version into the isolated cache.

Xvfb atomically allocates the display and gets a private MIT cookie. The runner
never uses the caller's DISPLAY, Wayland connection, or D-Bus session. Runtime,
config and cache directories are private. EWMH readiness is bounded before any
fixture runs. Commands have a 15-minute budget; session startup/teardown has an
additional minute. Process groups receive SIGTERM on cancellation/timeout, then
SIGKILL after two seconds, and remaining ordinary descendants are killed on exit.
Tests exercise failure diagnostics, timeout, and cancellation after a grandchild
has installed a SIGTERM handler. This handles validation processes, not deliberate
daemons that create their own sessions.

Each run prints its `build/validation/desktop-*` diagnostics directory. Command
and session stdout/stderr, WM/server logs, display metadata, resize captures and
failure screenshots are retained. CI uploads only these intended files, excluding
Xauthority, sockets and private config/cache directories. Inspect command.stderr
when a nested failure points to the session log. No automatic rerun masks failures.

## What the evidence establishes

The native interaction suite runs context resize/minimize/restore, real XTest
keys/repeat/modifiers, pointer buttons/scroll/capture and focus lifecycle checks
in Node and Bun. Native context tests include clear/readback assertions.
Representative examples cover vanilla triangle, Three materials, TypeGPU triangle
and webgpu-utils textures in both runtimes, including normal cleanup.

The separate composition fixture uses the current Three adapter: a green plane on
a red background is rendered through its half-float intermediate into the native
surface. Exact background/center pixels are read back at 320×240, 480×280 and
256×320, exercising output allocation, camera sizing and composition after resize.
This deliberately uses primary colors; it does not establish precise color-transfer
or alternate-view correctness. Animated scenes use bounded smoke runs rather than
brittle whole-image equality. Full-gallery completion does not prove every pixel.
Packed verification executes npm's prepack build, checks tarball contents, installs
into clean npm and Bun consumers and runs both runtimes' compute/presentation and
lifecycle checks.

Linux X11/lavapipe/XTest evidence does not establish hardware GPU, high-DPI,
Wayland or other-platform behavior. Local `gh act` checks do not establish GitHub's
hosted permissions, cache isolation or artifact service behavior; hosted CI remains
a separate validation step. See [release workflow local execution](github-releases.md#test-locally-with-the-github-cli-extension).

## Local evidence for this change

On Linux x64 with Node 26.7.0, Bun 1.3.14 and Mesa lavapipe, a fresh local
CMake build passed the source audit. The full suite passed 51 tests (the prior
41 cases remain covered; six invalid compiler inputs now have individual cases).
Full native interactions, all 16 gallery entries, composition readback at all
three sizes, and clean npm/Bun packed consumers passed in both runtimes. Native
resize/restoration captures were inspected. The fast workflow job passed under
`gh act`; the full integration workflow and GitHub-hosted execution remain
unverified as workflows, despite their constituent commands passing locally.

The input investigation used a temporary raw Xlib probe. It received focus but
no XTest keys through the host's `xvfb-run -a` path, on a display with geometry
that did not match the requested server. That wrapper does not check Xvfb startup
success. Direct `Xvfb -displayfd` allocation produced real press/repeat/release
receipt and made the unchanged hostframe input fixtures pass. No native behavior
change or weakened assertion was required. A separate cancellation probe exposed
D-Bus exiting before nested cleanup; the runner now retains the command group PID
for parent cleanup, with a permanent desktop lifecycle regression check.
