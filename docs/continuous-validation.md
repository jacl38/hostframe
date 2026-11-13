# Continuous validation

`.github/workflows/validation.yml` runs on pull requests and master pushes.
A weekly schedule and manual dispatch run the full gallery. The release build
also runs the full gallery and interaction/output checks before preparing assets.

| Gate | Commands and evidence |
| --- | --- |
| Every change, including documentation | Locked install, `bun run lint`, build-independent compiler/tooling, release-tooling, scheduler/timing and validation-runner tests |
| Any non-Markdown/non-LICENSE change | `bun run setup`, `bun run typecheck`, full `bun test scripts packages/core/test`, Hostframe system contracts and adapters, real packed consumers |
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
export HOSTFRAME_X11_WM=openbox
bun scripts/validation/desktop-check.ts
bun run test:system
bun scripts/validation/desktop.ts bun scripts/package/verify.ts
# Full gallery, including slower scenes:
bun scripts/validation/desktop.ts bun scripts/examples.ts --verify
```

The desktop runner requires Linux, Xvfb with `-displayfd`, xauth,
dbus-run-session, the selected window manager, xdotool, xprop and ImageMagick `import`.
CI explicitly selects Openbox (`HOSTFRAME_X11_WM=openbox`); local installations
with KWin/X11 can use `HOSTFRAME_X11_WM=kwin_x11` (the default). The selection
is explicit: a missing selected manager fails rather than falling back to another.
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

Each run prints its `build/validation/desktop-*` diagnostics directory before
checking prerequisites. `startup.stderr` records the startup phase and original
error even if no display could be created. The lifecycle check also reports its
`build/validation/lifecycle-*` directory and includes child startup errors in
its failure message. Both directories' intended logs are uploaded by CI. Command
and session stdout/stderr, WM/server logs, display metadata, resize captures and
failure screenshots are retained. CI uploads only these intended files, excluding
Xauthority, sockets and private config/cache directories. Inspect command.stderr
when a nested failure points to the session log. No automatic rerun masks failures.

## Coverage policy

Dawn and GLFW are trusted dependencies. This suite protects Hostframe's ownership,
execution and transport boundaries, not WebGPU conformance. Do not add CTS cases,
feature-by-feature GPU checks, or snapshots of arbitrary library scenes. Add a
case when it protects a distinct Hostframe contract or reproduces a glue defect.
The full gallery is an example-maintenance check, separate from system coverage.

`bun run test:system` runs native contracts and library integrations in a private
X11 session. `scripts/validation/system.ts --adapters-only` runs just the library
portion on an existing display. Packed-consumer verification remains a separate
distribution gate. Forced cleanup requires its special native build as below.

| Failure mode | Fixture / assertion |
| --- | --- |
| Public GPU access requires GLFW/display or mutates globals | `headless.ts`: display variables cleared, shared GPU owner, explicit imports, clear/readback; `globals.ts`: opt-in installation and conflicts |
| Creation/teardown leaves stale ownership | `window.ts`, `configuration-exceptions.ts`: thread/lifecycle guards, failed configuration, disposal and GC |
| Frame escapes its scope or a callback corrupts execution | `context.ts`, `manual-frame.ts`: texture/view expiration, async/reentrant rejection, callback failure and recovery |
| Scheduling starves host/GPU callbacks or misorders application work | core timing/loop tests; native `loop.ts`, `subscriptions.ts`: actual host timer and readback progress, pause/resume/stop, listener ordering |
| Resize/minimize leaves stale presentation state | `context.ts --interactions`, `resize.ts`: actual native resize/minimize/restore, framebuffer state and output |
| Native input is mistranslated or routed incorrectly | `input.ts`, `text-input.ts`, `input-actions.ts`, `multiple-window-input.ts`: real XTest input, focus/capture, batch failures and per-window state |
| Closing or disposing one window invalidates another | `multiple-windows.ts`, `lifecycle.ts`: close cancellation/acceptance, shared-device survival, independent windows |
| Cleanup stalls and retains contexts | `cleanup-timeout.ts` under the forced-timeout build: release references, report failure, sibling device loss |
| Library adapter no longer connects to native frames | Three composition/resize output; TypeGPU triangle and webgpu-utils textures bounded runs with completion markers |
| Built exports/addon differ from source execution | packed npm/Bun consumers: explicit globals, no-display failure, native close, two-window presentation and cleanup |

Fixture paths in this table are under `packages/native/test/` unless qualified.
Library smoke completion establishes initialization, submission and teardown;
it does not establish image correctness. Three's targeted pixels establish our
composition wiring, not Three's rendering correctness. New library scenes should
only enter this gate when they exercise an additional Hostframe boundary.

## What the evidence establishes

The native interaction suite runs context resize/minimize/restore, real XTest
keys/repeat/modifiers, pointer buttons/scroll/capture and focus lifecycle checks
in Node and Bun. Native context tests include clear/readback assertions.
Library checks cover TypeGPU's borrowed-device integration and webgpu-utils'
native typed-pixel texture path in Node and Bun, including normal cleanup.
Three is covered by the composition fixture rather than a duplicate gallery smoke.

The Three adapter composition fixture uses the current Three adapter: a green plane on
a red background is rendered through its half-float intermediate into the native
surface. Exact background/center pixels are read back at 320×240, 480×280 and
256×320, exercising output allocation, camera sizing and composition after resize.
This deliberately uses primary colors; it does not establish precise color-transfer
or alternate-view correctness. Animated scenes use bounded smoke runs rather than
brittle whole-image equality. Full-gallery completion does not prove every pixel.
Packed verification executes npm's prepack build, checks tarball contents, installs
into clean npm and Bun consumers and runs both runtimes' presentation and
lifecycle checks.

Linux X11/lavapipe/XTest evidence does not establish hardware GPU, high-DPI,
Wayland or other-platform behavior. Local `gh act` checks do not establish GitHub's
hosted permissions, cache isolation or artifact service behavior; hosted CI remains
a separate validation step. See [release workflow local execution](github-releases.md#test-locally-with-the-github-cli-extension).

## Validation of the contract-focused gate

On Linux x64/X11 with Mesa lavapipe and Bun 1.3.14, `bun run test:system`
passed all native contracts and the Three, TypeGPU and webgpu-utils checks in
both runtimes (the local Node shim selected Node 26.13.1). Lint, typecheck,
all 59 script/core tests and the audited native build passed. A restored-window
capture was inspected. Clean npm and Bun packed consumers passed using installed
Node 26.7.0 and Bun 1.3.14, bypassing the local npm shim.

The initial sandboxed Xvfb startup could not allocate a display. Outside the
sandbox, the hardware driver lacked DRI3 presentation under Xvfb; explicitly
selecting lavapipe passed. One concurrent private KWin startup failed readiness;
the packed-consumer check passed when run separately with installed npm.
No assertions were weakened. Hardware presentation, macOS and hosted workflow
execution were not verified by this change. The existing forced-cleanup build
gate is retained, but was not rerun for this orchestration/fixture change.

## Historical validation evidence

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

## Hosted startup failure on PR #29

Hosted run 42162580843 passed native build/typechecking/tests, then failed before
creating a display. The Fedora 44 transaction installed KWin 6.8.2 instead of
`kwin-x11`; [the Fedora package obsoletes kwin-x11](https://packages.fedoraproject.org/pkgs/kwin/kwin/fedora-44-updates.html).
The matching container provided `kwin_wayland` but no `kwin_x11`. The prerequisite
assertion occurred before the evidence-directory message, and the lifecycle
assertion hid the child stderr. Artifact globs also omitted `lifecycle-*` logs.
CI now installs/selects Openbox for its isolated X11/EWMH session. Checks remain
unchanged, including real key/repeat/focus and lifecycle assertions. Early errors
are retained and reported, and both workflows upload lifecycle stdout/stderr.

The fix was checked in a disposable Fedora 44 container: the old package set
reproduced missing `kwin_x11`; selecting installed Openbox passed lifecycle
failure/cancellation checks, full native interactions, representative renderers,
and exact composition/resize readback in Node 26.7.0 and Bun 1.3.14. The unchanged
previously verified tarball also passed clean npm/Bun consumers under Openbox.
These runtime checks reused the existing native build; no native source changed.
Local lint/typecheck and all 52 tests passed. Fixed GitHub-hosted execution still
requires pushing the follow-up commit and rerunning PR #29.

Multiple-window coverage runs in the regular presentation and interaction gates:
`multiple-windows.ts` covers configuration/ordering, cross-window operation guards,
failed creation/rendering, fixed-update create/dispose, first/final closure, and
shared-device readback after cleanup. `multiple-window-input.ts` drives two
separately identified native windows with XTest, checking focus/capture loss,
per-window keys, failed-batch isolation, resize/minimize/restore, paused commands,
and independent disposal. Its screenshots are included in desktop diagnostics.
The eight forced-cleanup cases also configure a sibling on the stalled device,
assert its subsequent device-loss failure (or application disposal), and verify
release of both contexts' references. Packed npm/Bun consumers render two windows
and keep the second running after closing the first. The two-window example remains in the full gallery; native fixtures cover its
contracts in the regular system gate.

The lifecycle fixture in `native:verify --window-interactions` sends actual
`WM_DELETE_WINDOW` messages and checks cancellation, retry, acceptance, native
control/state transport, subscription failure/ordering, pause and multiwindow
isolation in both runtimes. The `vanilla/window-lifecycle` example remains in the full gallery; its contracts
are exercised by the native lifecycle fixture in the regular system gate. See [the lifecycle contract](window-lifecycle.md).
