# Window input

Input is implemented for the current Linux x64/X11 target in Node.js and Bun.
Run `bun run example:input` or `node examples/input.ts`. WASD/arrows move the
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
  if(event.action === "press" && event.key === Key.Space) jump();
  if(event.modifiers & Modifier.Shift) { /* shift was active for this event */ }
});
app.on("fixedUpdate", ({ dt }) => {
  if(window.isKeyDown(Key.W)) moveForward(dt);
  if(window.isButtonDown(PointerButton.Left)) fire(dt);
});
// off() removes just this subscription and is safe to repeat.
```

`Key` exports GLFW physical key tokens (`Key.W`, `Key.Escape`, `Key.LeftShift`,
`Key.Digit1`, `Key.KpEnter`, etc.). They identify positions using the US layout,
independently of the active text layout. `Key.Unknown` is -1. Every key event
also carries a platform-specific `scancode`, including unknown keys. Use
`isScancodeDown(scancode)` to distinguish unknown keys; scancodes are not portable
between operating systems. This API provides controls, not characters, IME, or
text composition.

| Subscription | Event fields (in addition to `type`) |
| --- | --- |
| `key` | `key`, `scancode`, `action: "press" \| "release" \| "repeat"`, `modifiers`, `synthetic` |
| `pointerMove` | `x`, `y`, `deltaX`, `deltaY`, `captured` |
| `pointerButton` | `button`, `action: "press" \| "release"`, `modifiers`, `synthetic` |
| `scroll` | `deltaX`, `deltaY` |
| `focus` | `focused` |
| `pointerCapture` | `captured`, `rawMotion` |

`PointerButton.Left` is 0, **Right is 1, Middle is 2** (GLFW numbering, different
from DOM numbering). Extra buttons are 3–7 (`Button4`–`Button8`). Wheel input is
scroll, not held buttons. `modifiers` is a bitmask of `Modifier.Shift`, `Control`,
`Alt`, `Super`, `CapsLock`, and `NumLock`. Synthetic releases have modifiers 0.

`window.input` is an immutable snapshot containing `keys`, `scancodes`, `buttons`,
`focused`, `pointerCaptured`, `rawMotion`, `x`, and `y`. Retaining a snapshot does
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
let capture: boolean | undefined;
window.on("pointerButton", event => {
  if(event.button === PointerButton.Left && event.action === "press") capture = true;
});
window.on("key", event => {
  if(event.key === Key.Escape && event.action === "press") capture = false;
});
window.on("focus", event => { if(!event.focused) capture = undefined; });
app.on("fixedUpdate", () => {
  if(capture !== undefined) {
    if(!capture || window.input.focused) window.setPointerCapture(capture);
    capture = undefined;
  }
});
```

`setPointerCapture(true, rawMotion = false)` uses `GLFW_CURSOR_DISABLED`: it hides
the cursor, locks it to the window, and allows unlimited virtual movement.
This is game-style capture, not DOM pointer capture or visible cursor confinement.
Passing `true` as the second positional argument (`rawMotion`) throws if raw motion
is unavailable; there is no silent raw-mode fallback. `setPointerCapture(false)`
restores the cursor and disables raw motion. Successful commands update
`window.input` immediately; their events arrive at the next poll. Repeating the
same mode is safe and produces no extra capture event. Capture requires a focused,
open window. Releasing it remains valid while unfocused or close-requested.

On focus loss, native held keys and buttons are cleared, marked synthetic release
events are queued for each held control, capture/raw motion are released, then a
`focus: false` event is queued. Later GLFW synthetic releases are suppressed.
Focus gain starts empty and **does not recapture**, even if a physical key remains
down. Close requests also clear held input and release capture immediately, then ignore
new control input while the close-requested window remains alive. Disposal detaches
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

Input dispatch holds the same native application operation guard as drawing.
Reading input snapshots, subscribing/unsubscribing, and `app.stop()` are safe in
listeners. Nested polling, drawing, window creation, capture changes, close
requests, and window/application disposal are rejected. Defer native mutations
to the next fixed update, render callback, or host task, as in the example above.
Native window operations remain restricted to the process main thread.

## Validation

`bun run native:verify --window-interactions` runs presentation, resize, and real
keyboard/pointer checks in both Node.js and Bun. Input checks use XTest through
`xdotool` in an X11 desktop with an EWMH window manager; they require keyboard
repeat enabled. They cover physical key press/release/repeat and modifiers,
held-state snapshots, normal/captured movement, three buttons, both scroll axes,
focus loss with held controls and capture, paused polling, listener failures,
reentrancy, close, disposal, and window recreation. They do not establish behavior
for Wayland, other operating systems, or physical high-DPI/trackpad hardware.

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
