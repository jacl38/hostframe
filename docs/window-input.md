# Window input

Input is implemented for the current Linux x64/X11 target in Node.js and Bun.
Run `bun run example:input` or `node examples/vanilla/input.ts`. WASD/arrows move the
square, left click toggles capture, Escape releases capture, the wheel changes
size, and Q closes the window. Losing focus releases held controls and capture.

`Key`, `PointerButton`, and `Modifier` are generated from the pinned GLFW header
by `bun run setup` and every `bun run native:build`. Their numeric values are not
hand-maintained. See [generated input constants](native-build.md#generated-input-constants).

## Events and held state

```ts
import { Application, Key, PointerButton, Modifier } from "../index.ts";

// After creating app, device, and window:
const off = window.on("key", event => {
  if(event.action === "press" && event.key === Key.SPACE) jump();
  if(event.modifiers & Modifier.SHIFT) { /* shift was active for this event */ }
});
app.on("fixedUpdate", ({ dt }) => {
  if(window.isKeyDown(Key.W)) moveForward(dt);
  if(window.isButtonDown(PointerButton.LEFT)) fire(dt);
});
// off() removes just this subscription and is safe to repeat.
```

`Key` exports GLFW physical key tokens (`Key.W`, `Key.ESCAPE`, `Key.LEFT_SHIFT`,
`Key.ONE`, `Key.KP_ENTER`, etc.). They identify positions using the US layout,
independently of the active text layout. `Key.UNKNOWN` is -1. Every key event
also carries a platform-specific `scancode`, including unknown keys. Use
`isScancodeDown(scancode)` to distinguish unknown keys; scancodes are not portable
between operating systems. This API provides controls, not characters, IME, or
text composition.

Names retain GLFW's suffix after removing `GLFW_KEY_`, `GLFW_MOUSE_BUTTON_`, or
`GLFW_MOD_`. Standalone digits use `ZERO` through `NINE`, so `GLFW_KEY_0` becomes
`Key.ZERO`; embedded digits stay unchanged (`Key.KP_0`, `Key.F1`). The ten overrides
are defined once in the TypeScript generator and shared by all three groups.
`LAST` sentinels are omitted; other aliases are retained. These names replace the
previous PascalCase and `Digit0`/`Button4` naming conventions.

| Subscription | Event fields (in addition to `type`) |
| --- | --- |
| `key` | `key`, `scancode`, `action: "press" \| "release" \| "repeat"`, `modifiers`, `synthetic` |
| `pointerMove` | `x`, `y`, `deltaX`, `deltaY`, `captured` |
| `pointerButton` | `button`, `action: "press" \| "release"`, `modifiers`, `synthetic` |
| `scroll` | `deltaX`, `deltaY` |
| `focus` | `focused` |
| `pointerCapture` | `captured`, `rawMotion` |

`PointerButton.LEFT` is 0, **RIGHT is 1, MIDDLE is 2** (GLFW numbering, different
from DOM numbering). `ONE`, `TWO`, and `THREE` alias these named buttons; extra
buttons are 3–7 (`FOUR`–`EIGHT`). Wheel input is scroll, not held buttons.
`modifiers` is a bitmask of `Modifier.SHIFT`, `CONTROL`, `ALT`, `SUPER`, `CAPS_LOCK`,
and `NUM_LOCK`. Synthetic releases have modifiers 0.

`window.input` is an immutable snapshot containing `keys`, `scancodes`, `buttons`,
`focused`, `pointerCaptured`, `rawMotion`, `x`, `y`, `metrics`, and `status`. Retaining a snapshot does
not retain a live collection. `isKeyDown`, `isScancodeDown`, and `isButtonDown`
query the latest snapshot. Read held state in fixed updates for continuous game
controls. A press and release within one poll are both delivered as events but
leave the control up in the snapshot. OS-generated repeats have action `repeat`;
they do not create additional held entries or additional `press` events. Repeat
frequency depends on system settings and must not drive simulation movement.

## Coordinates

Normal pointer positions are floating-point GLFW screen coordinates relative to
the **top-left of the client area**: +x right, +y down. They are logical screen
units, not framebuffer pixels, and may lie outside the client bounds. Deltas are
successive position differences in the same units. Render sizes come from the
acquired texture in framebuffer pixels; applications must account for their
logical-to-framebuffer scale when mapping positions to rendering.

Captured positions are GLFW's unlimited virtual coordinates, with the same axis
directions. Use deltas for camera motion; do not interpret these positions as a
visible cursor location. With explicit raw mode, captured motion is unaccelerated
and unscaled device motion, so it is not a logical pixel distance. The first
position callback after focus or capture changes establishes a baseline and has
zero deltas. Mode-change cursor restoration callbacks are suppressed; cursor
restoration never becomes a large camera movement.

Scroll offsets are GLFW wheel/trackpad units, **not pixels**: +y up and +x left.
Values may be fractional and depend on the device/platform. They are neither
accumulated in held state nor reset once per fixed update; accumulate them in a
listener if a simulation needs per-update scroll totals.

## Capture and focus

```ts
window.on("pointerButton", event => {
  if(event.button === PointerButton.LEFT && event.action === "press") window.setPointerCapture(true);
});
window.on("key", event => {
  if(event.action !== "press") return;
  if(event.key === Key.ESCAPE) window.setPointerCapture(false);
  if(event.key === Key.Q) window.requestClose();
});
```

`setPointerCapture(true, rawMotion = false)` uses `GLFW_CURSOR_DISABLED`: it hides
the cursor, locks it to the window, and allows unlimited virtual movement.
This is game-style capture, not DOM pointer capture or visible cursor confinement.
Passing `true` as the second positional argument (`rawMotion`) throws if raw motion
is unavailable; there is no silent raw-mode fallback. `setPointerCapture(false)`
restores the cursor and disables raw motion. Outside input dispatch, successful
commands update `window.input` immediately; their events arrive at the next poll.
Repeating the same mode is safe and produces no extra capture event. Capture requires a focused,
open window. Releasing it remains valid while unfocused or closed.

On focus loss, native held keys and buttons are cleared, marked synthetic release
events are queued for each held control, capture/raw motion are released, then a
`focus: false` event is queued. Later GLFW synthetic releases are suppressed.
Focus gain starts empty and **does not recapture**, even if a physical key remains
down. Accepted native closes and explicit force-close commands clear held input
and release capture, then ignore new control input while the closed window
remains alive. A canceled native request keeps input operational; see
[window lifecycle](window-lifecycle.md). Disposal detaches
callbacks, clears queued input and listeners, and restores the cursor before the
native window is destroyed; it does not deliver disposal events. Repeated disposal
is safe. All other window operations, input queries, and subscriptions throw after
disposal, including disposal through the application.

## Dispatch and lifecycle

`app.pollEvents()` pumps native events and delivers input synchronously, even if
it returns false because the window closed. `app.run()` polls before fixed updates
and rendering and continues delivering input while paused. Caller-owned loops
must poll regularly. Native callbacks only record data, including callbacks that
GLFW invokes during other operations; JavaScript never runs on the GLFW callback
stack. There is no input dispatch while drawing.

Before listeners run, the snapshot is updated to the final native state of the
whole poll batch. Every listener in the batch therefore sees that final state,
not an intermediate state for its individual event. Events remain ordered and
immutable. Subscriptions added during a batch start with the next batch; removals
take effect immediately. Duplicate subscriptions are independent. All listeners
must return `undefined` synchronously. A thrown value is preserved and stops the
remaining batch; `pollEvents` throws it, or `run` rejects with it. Non-undefined
results, including promises, throw a TypeError (returned rejected promises are
consumed). Remaining event notifications are discarded but held state has already
been reconciled, and subsequent polls can recover.

### Actions requested from input listeners

Input dispatch holds the native application operation guard. `requestClose()` and
`setPointerCapture(captured, rawMotion?)` are supported in input listeners: they
record typed commands for that window rather than mutating native state there.
No general deferred-callback API is exposed.

- Commands execute in request order after the **whole successful batch** returns
  from native dispatch and releases its operation guard, before `pollEvents()`
  returns or the scheduler starts updates/rendering. All listeners in the batch
  continue to see the same final polled snapshot. Commands do not skip remaining
  listeners. Stop and pause do not cancel the batch or its commands.
- Each successful command refreshes `window.input`. Command-generated capture and
  synthetic-release events are delivered at the next poll, never recursively in
  the current batch. `pollEvents()` reports whether a window is open after applying
  commands, so a close requested by input can return false in that same call.
- Requests are not coalesced: capture/release/capture applies all three transitions
  in order. Repeating the same capture mode is a native no-op with no extra event.
  A successful close releases capture and held controls, ends the command queue,
  and cancels all later requests in that queue, including duplicate closes.
- Capture uses native focus/close state at execution. Capture of an unfocused or
  closed window throws; release remains valid. Focus loss clears held
  state and releases capture before dispatch. A capture request from that batch
  cannot override focus loss. Focus gain does not recapture automatically.
- A thrown listener value, invalid synchronous result, or native dispatch failure
  discards **all commands from that batch**, even those requested by earlier
  listeners. The original failure is preserved. A command failure stops the queue
  and discards its remainder; prior successful commands are not rolled back.
  `pollEvents()` throws the failure, or `run()` rejects with it. Later polls can
  recover; canceled commands never survive into a later batch.
- Commands execute during paused polling without fixed updates or host timers.
  A close request does not dispose resources. Disposal still rejects during input;
  after successful disposal, queued native notifications and listeners are cleared
  and both action methods throw. No command queue survives an input dispatch.

Reading snapshots, subscribing/unsubscribing, and `app.stop()`/`pause()`/`resume()`
remain safe in input listeners (pause/resume require a run). Nested polling,
drawing, window creation, configuration, key-label queries, and window/application
disposal remain guarded. Render callbacks cannot request close/capture and retain
the same acquire → render → present scope. Outside input listeners the two action
methods execute synchronously under their ordinary native guards. Native window
operations remain restricted to the process main thread.

## Validation

`bun run native:verify --window-interactions` runs presentation, resize, and real
keyboard/pointer checks in both Node.js and Bun. Input checks use XTest through
`xdotool` in an X11 desktop with an EWMH window manager; they require keyboard
repeat enabled. They cover physical key press/release/repeat and modifiers,
held-state snapshots, normal/captured movement, three buttons, both scroll axes,
focus loss with held controls and capture, paused polling, listener failures,
reentrancy, close, disposal, and window recreation. The input-action fixture also
checks ordered commands, duplicate requests, next-poll notifications, same-call
close results, cancellation on listener/command failure, and capture/close while
paused without updates or rendering. They do not establish behavior
for Wayland, other operating systems, or physical high-DPI/trackpad hardware.

The 2026-11-06 subscription/action change passed lint, typecheck, all 57
unit/build-script tests, native build/source audit, compute/readback, and the full
`native:verify --window-interactions` suite in Node.js 26.13.0 and Bun 1.3.14 on
Linux x64 with private Xvfb/KWin and Mesa lavapipe 26.2.5. Cross-owner subscription
contracts also passed before the refactor in both runtimes. The full presentation
and forced-cleanup suite passed with Node.js 26.7.0 and Bun after an initial fault
run encountered an X11 `BadDrawable` error that did not recur in a fresh display.
The normal build was restored and smoke-verified afterward. The updated example
was driven in Node.js 26.7.0 and Bun through movement, click capture, pointer
motion, Escape release, wheel sizing, and Q close. Inspected before/after captures
show movement and growth from 40×40 to 45×45 in both runtimes. Diagnostics are in
`build/validation/desktop-*`; the final example captures/logs are in
`build/validation/input-example-6Faj3z/` in this validation checkout. These checks
use injected XTest input and software Vulkan; macOS, Wayland, physical input
hardware, and hardware GPU presentation were not revalidated for this change.

Validated on 2026-11-01 with Linux x64, Xvfb/KWin, Mesa lavapipe 26.2.5,
Node.js 26.7.0, and Bun 1.3.14. `native:build`, typecheck, lint, all 28 deterministic
and build-script tests, and the full `native:verify --window-interactions` suite
passed. Both interactive examples were driven through keyboard movement, pointer
capture/movement, wheel sizing, Escape release, and Q close. Before/after images
were inspected; the square moved about 190 pixels right and grew from 40×40 to
45×45 in both runtimes. The recorded video decoded without errors. Generated
logs, four example screenshots, and the recording are under
`build/native/input-validation/` (ignored by Git). Input was delivered through
XTest, with software Vulkan presentation; physical input hardware and hardware
GPU presentation were not revalidated for this change.

The [2026-11-01 hardware follow-up](presentation-performance.md) subsequently
passed the same interaction suite and exercised both input examples on Intel
through Xwayland. Physical input hardware remains unverified.

Input event and snapshot declarations are generated from the native typed field
registrations, then re-exported by the core API. GLFW constant values are resolved
by compiling the pinned header, including active preprocessor branches and aliases;
there is no handwritten numeric table or C-expression parser. See
[native bindings](native-bindings.md).

### Key symbols and layout labels

`getKeyName(event.key)` returns a canonical symbol such as `LEFT_SHIFT` or `A`.
It derives from the compiler-generated GLFW constants, with no separate key
inventory. `Key.UNKNOWN` maps to `"UNKNOWN"`; unrecognized numbers return
`undefined`. Aliases use the first GLFW macro name in lexical order (excluding
`LAST`), so `Key[getKeyName(token)!]` returns the original recognized token.
`Key` remains a frozen name-to-number object.

Use `app.getKeyLabel(event.key, event.scancode)` for a printable name in the
active keyboard layout using [GLFW key names](https://www.glfw.org/docs/latest/input_guide.html#input_key_name). For example, a physical `Key.Z` can display `y` under a
German layout. Non-printable keys fall back to their canonical symbol (`ESCAPE`);
unrecognized values and unavailable unknown scancodes fall back to `UNKNOWN`.
GLFW may return lowercase or unmodified labels; these are hints, not translated
UI strings. Space may also use its symbolic fallback.

`app.getKeyScancode(Key.W)` returns the platform scancode, or `undefined` for
unsupported/unrecognized tokens and `Key.UNKNOWN`. Scancodes distinguish unknown
physical keys and are platform-specific; do not treat them as portable key tokens.
An unknown token with a valid event scancode can still have a printable label.

```ts
import { Key, getKeyName } from "hostframe";

window.on("key", event => {
  console.log(getKeyName(event.key), event.scancode);
});
// Query outside input/render callbacks, under the application's operation guard.
const forwardHint = app.getKeyLabel(Key.W);
const forwardScancode = app.getKeyScancode(Key.W);
```

Label/scancode queries require a live application on its owning main thread and
cannot run inside native application operations, including input/render listeners.
Returned strings are copied from GLFW, so callers own ordinary JavaScript strings;
query again after layout group changes rather than caching for the entire session.
Replacing the entire X11 server keymap with `setxkbmap` during an existing GLFW
session was observed to retain stale Xlib mappings with the pinned GLFW version;
US and German layouts were verified in separately initialized sessions.
Arguments must be signed 32-bit integers. A token identifies a physical GLFW key,
a scancode identifies a platform key, and a display label describes that key in
the current layout. None is typed text: modifiers, dead keys and IME composition
require a separate text-input API, which is not implemented here.

### Multiple windows

GLFW routes callbacks and held state to their owning window; polling pumps all
windows. Hostframe dispatches window batches in creation order. Each batch keeps
its listener snapshot and deferred capture/close queue independent. Successful
commands apply before the next window batch; a failure drops the failing batch's
remaining events/commands, aborts polling, and leaves later windows' native queues
for the next poll. `stop()`/`pause()` do not interrupt a successful input batch.
Deferred commands apply only to the window currently dispatching input; calls
mutating another window remain subject to the native application operation guard.
Pausing continues polling every window. Closing one window resets only its input
and ends the run only when no open window remains.

### Window metrics and pixel conversion

`window.metrics` is an immutable batch snapshot, available immediately after
creation and before configuring or rendering. `width` and `height` are client
sizes in GLFW screen units (excluding decorations); `framebufferWidth` and
`framebufferHeight` are pixels, available outside rendering. `contentScaleX` and
`contentScaleY` are GLFW platform UI scale factors, not necessarily the ratio
between those sizes. `drawable` is false when iconified or either size is zero.
Minimization can retain nonzero sizes. All metrics access throws after disposal.

Each window samples all fields together on the owning thread after native event
polling, before calling listeners. A changed snapshot produces one `metrics`
event before that window's queued input events, then fixed updates and rendering.
Intermediate resize/scale transitions within one poll are coalesced. All input
and render listeners can read the cached snapshot under the native operation
guard. Event metrics equal the current snapshot by value; subscriptions follow
the same synchronous return, error, addition/removal, and deferred command rules
as other input listeners. There is no initial notification to new subscribers;
read `window.metrics` for initial state. No global ordering across windows is
promised. Capture/close commands preserve metrics until the next batch.

`window.toFramebuffer(x, y)` maps logical pointer coordinates to continuous
framebuffer pixel coordinates using each axis's measured size ratio. It returns
`undefined` while non-drawable and rejects nonfinite inputs. It does not clamp or
round, so captured/outside-window positions remain meaningful. For example:

```ts
window.on("pointerMove", event => {
  const pixel = window.toFramebuffer(event.x, event.y);
  if(pixel) pickAt(pixel.x, pixel.y);
});
```

This maps against the latest completed poll, including for earlier pointer events
in that batch; it is not a historical size for each event. Platform updates can
arrive across polls. A snapshot is atomic to JavaScript, not a promise that the
OS changes client and framebuffer sizes simultaneously. During live resize, if a
render texture's dimensions differ from the snapshot, defer pixel picking until
the next poll (or map explicitly against that texture's dimensions). Zero sizes
never cause division. Use content scale for UI density, not pointer conversion.
The vanilla input example follows the pointer while uncaptured using this API.
