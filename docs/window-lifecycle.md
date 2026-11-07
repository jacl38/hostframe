# Window lifecycle and runtime controls

The implemented API supports native user-close cancellation, minimization/restoration
notifications, and runtime title, size, position and visibility controls. Run
`bun run example vanilla/window-lifecycle` (or Node directly) for an unsaved-work
example. Its title displays the available actions; blue means dirty, orange means
confirmation pending, and green means saved. Closing through the window manager
prompts; S marks the example saved and closes if prompted, C cancels, D marks dirty.
R resizes, P moves, H hides for one second. Q/Escape explicitly force-close.
The example simulates saving; it writes no document.

## Native user close

```ts
window.on("closeRequest", event => {
  if(hasUnsavedWork()) {
    event.preventDefault();
    // Start your own UI/prompt outside this synchronous callback.
    queueMicrotask(() => { void saveAndClose(); });
  }
});
async function saveAndClose() {
  if(await confirmAndSave()) window.requestClose();
}
```

`CloseRequestEvent` is immutable, with `type: "closeRequest"`, a read-only
`defaultPrevented` getter and `preventDefault()`. Cancellation is sticky across
listeners and repeat calls are safe **during synchronous delivery only**. Calling
a retained event's method later throws. Listeners must return `undefined`;
promises and other return values fail the batch. Cancel before starting an async
prompt, and register a synchronous listener rather than an async function.
Caller-owned asynchronous work must handle rejection and window/application disposal.

The GLFW callback clears the close flag immediately and records a request in the
existing per-window event queue. JavaScript never runs on the GLFW callback stack.
Repeated native close callbacks before the window's next dispatch coalesce into
one request. The window remains open with held input and pointer capture intact
unless the platform also delivers focus loss. A failed/canceled request is consumed;
a later native request starts a fresh decision. Requests after accepted closure
cannot reopen the window.

After all listeners for an uncanceled request return successfully, its acceptance
is inserted as a close command at that event's position in the batch. The command
runs only after the **entire window batch** returns successfully and releases the
native operation guard. Later events/listeners in the batch still run. Listener
throws (including arbitrary values), invalid returns, or native dispatch failure
cancel acceptance and discard that batch's queued close/capture commands. There
is no automatic retry after failure. `pollEvents()` throws or `run()` rejects;
the window stays usable and a later native close can be delivered.

Explicit `requestClose()` retains its existing **force-close** behavior: it never
emits `closeRequest`, including when called from such a listener. `preventDefault()`
does not cancel an explicit force command. In input/lifecycle listeners, force-close
and pointer capture commands defer to the successful batch boundary. Commands run
in order; a successful close clears held input/capture and drops later commands.
An earlier command failure drops the remaining queue, including close acceptance;
previous successful commands are not rolled back. Notifications caused by commands
arrive at the next poll, without recursive delivery.

No listeners means native requests are accepted. Accepted closure sets
`shouldClose`, skips subsequent rendering, and ends `run()` only when the final
open window closes. It does not dispose the native window, surface, device retain,
or subscriptions. Dispose windows/application in `finally`, before destroying
caller-owned devices. Closing one window affects only its input and presentation.

## Notifications and state

| API | Contract |
| --- | --- |
| `on("metrics", ({ metrics }) => ...)` | Coalesced resize/framebuffer/content-scale/drawability notification; the existing authoritative resize event |
| `on("minimize", event => ...)` | Native transition into iconification; immutable `{ type: "minimize" }` |
| `on("restore", event => ...)` | Native transition out of iconification; immutable `{ type: "restore" }` |
| `window.status` / `window.input.status` | Immutable polled `WindowStatus`: client origin `x, y` in screen units, `visible`, `minimized` |

Metrics and status are sampled together before dispatch; listeners see the final
state of the batch, not historical state for each event. Metrics changes are
coalesced and delivered before queued lifecycle/input events. Minimize/restore
transitions retain native callback order; several transitions in one poll can
have the same final snapshot. No initial notification is sent to new subscribers.
Read snapshots for initial state. Hidden, iconified, and closed are different states.
Visibility reports GLFW visibility, not occlusion or displayed pixels. Hiding does
not close, pause the scheduler, or guarantee rendering suspension. Iconification
makes `metrics.drawable` false, even if dimensions remain nonzero.

There is deliberately no second `resize` event with a conflicting size payload.
Logical client units, framebuffer pixels, platform content scale and conversion
continue to follow [the metrics contract](window-input.md#window-metrics-and-pixel-conversion).
Content scale is not a measured pixel ratio or physical DPI guarantee.

All lifecycle subscriptions use the existing input listener policy: additions
start next batch, removals take effect immediately, duplicates are independent,
and failures abort the remaining batch. Windows dispatch in creation order;
a successful batch's commands finish before the next window's dispatch. A failure
leaves later windows' notifications queued. Pause keeps polling lifecycle/input,
without rendering or fixed updates; stop/pause do not cancel a successful batch.

## Runtime controls and guards

| Control | Supported contract |
| --- | --- |
| `setTitle(title)` | UTF-8 title; empty string allowed, embedded NUL rejected |
| `setSize(width, height)` | Positive signed 32-bit integer client sizes in GLFW screen units, including non-resizable windows |
| `setPosition(x, y)` | Signed 32-bit integer client origin in virtual desktop screen units; negative values allowed |
| `setVisible(visible)` | Boolean show/hide request; showing may focus the window according to platform policy |
| Fullscreen | Deferred; no `setFullscreen` method is exposed |

These methods issue immediate native requests and report GLFW errors. Window managers
can constrain or asynchronously apply geometry/visibility; a successful call is
not a guarantee of the requested final state. Read `metrics` and `status` after
polling; they are not optimistic setter values. Title has no mirrored cached getter.
The initial creation-time size/resizable/vsync defaults remain unchanged.

Controls require an open window, a live application, and the process main thread.
They reject inside **any** native application operation, including input/lifecycle
and render listeners and cross-window calls. They do not join the close/capture
command queue. Use an explicit host task/microtask after synchronous dispatch for
UI changes, with application-owned lifetime/error handling. `shouldClose` itself
retains its native operation guard; read it outside callbacks. `input`, `metrics`
and `status` remain callback-safe snapshots. Configuration, creation, polling and
disposal retain their existing guards. A listener can cancel a close but cannot
dispose the window reentrantly. Outside dispatch, disposal is idempotent, clears
all queued notifications/listeners, and emits no disposal event. Subsequent
controls, subscriptions and snapshot reads throw. Only repeated disposal is safe.

## Follow-ups and validation limits

Fullscreen needs a separate monitor/mode selection and ownership contract, saved
windowed geometry, monitor-disconnect recovery, and presentation validation on
X11 and Cocoa. Add an API such as `setFullscreen(...)` only with those decisions
and observed enter/exit behavior. Native minimize/restore/maximize commands,
position/visibility change subscriptions and creation-time hidden windows are
also deferred; use the supported subset and window-manager controls for now.

The permanent Linux interaction fixture sends real ICCCM `WM_DELETE_WINDOW`
client messages (never destroys the X client). `native:verify --window-interactions`
runs it in Node and Bun alongside the existing input/metrics/context tests.
It checks cancellation/retry/acceptance, duplicate requests, listener policy,
command ordering/failures, native guards, paused progress, multiwindow isolation,
observed runtime controls, resize and minimize/restore. A narrow C++ check invokes
the installed production callback for a late callback after accepted close, which
cannot reliably be forced through the window manager. Packed consumers exercise
control/state transport and declaration types. The gallery gates include the
consumer example. Physical DPI changes, hardware input, hardware scanout pacing,
macOS behavior for these new controls, and fullscreen remain unverified.

## Verified evidence (2026-11-07)

Linux x64, private Xvfb/KWin, Mesa llvmpipe 26.2.5, Node.js 26.7.0 and Bun
1.3.14 passed the full `native:verify --window-interactions` suite, then the same
suite in the cleanup-fault build, including all eight unconfigure/reconfigure/
window/application timeout cases and the existing descriptor exception checks.
The default addon was rebuilt afterward. Lint, typecheck and all 59 unit/build
script tests passed. Actual npm and Bun tarball installs passed consumer types,
compute, native close cancellation/acceptance, runtime control/state transport,
two-window presentation, disposal and initialization failure checks in both runtimes.

The representative gallery passed in both runtimes. The lifecycle example was
also driven through resize, move, hide/show, native close cancellation, retry and
save/close. Inspected screenshots show the initial blue dirty state and resized
orange confirmation state with readable window-title actions in both runtimes.
Generated evidence is ignored under `build/validation/`: normal native checks in
`desktop-CVzeb7`, fault checks in `desktop-Jgy44r`, packed consumers in
`desktop-AcaeZW`, expanded ordering/example/gallery checks in `desktop-74uBy1`,
the final restored-default native/packed checks in `desktop-HyNMRy`,
and the four inspected example images/logs in `lifecycle-example/`.

Validation setup required allowing the private X server's local sockets, selecting
the lavapipe ICD instead of Intel under Xvfb (no DRI3), and using the installed
Node executable instead of a version-manager shim. The interaction fixture uses
xdotool's `--all` matching and asserts distinct window IDs so PID/title searches
cannot accidentally exercise one window twice. Visibility checks wait for native
mapping because the WM can apply it after GLFW updates its cached visibility.
These are software-X11 results; the platform/hardware limits above still apply.

Hosted PR #40 run [42407541713](https://github.com/jacl38/hostframe/actions/runs/42407541713)
passed the native build and all 59 tests, then exposed a fixture race under
Openbox: show polling aborted on xdotool's transient no-match exit instead of
waiting for mapping. The query now treats only exit 1 with empty stderr as an
empty result for both hide and show; other failures propagate. A real unmapped
window assertion covers this shared retry path. The corrected full interaction
suite and packed consumers passed in Node/Bun with isolated Openbox 3.6.1-30.fc44
as well as KWin (`build/validation/desktop-hqnmtY` and `desktop-9ARXki`). Hosted
fault and consumer steps were skipped after the original failure; a hosted rerun
of the correction is still required. Deferred fullscreen/remaining controls are
tracked in [#39](https://github.com/jacl38/hostframe/issues/39).
