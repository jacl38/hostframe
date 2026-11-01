export type KeyEvent = Readonly<{
  type: "key",
  key: number,
  scancode: number,
  action: "press" | "release" | "repeat",
  modifiers: number,
  synthetic: boolean
}>;

export type PointerMoveEvent = Readonly<{
  type: "pointerMove",
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
  captured: boolean
}>;

export type PointerButtonEvent = Readonly<{
  type: "pointerButton",
  button: number,
  action: "press" | "release",
  modifiers: number,
  synthetic: boolean
}>;

export type ScrollEvent = Readonly<{ type: "scroll", deltaX: number, deltaY: number }>;
export type FocusEvent = Readonly<{ type: "focus", focused: boolean }>;
export type PointerCaptureEvent = Readonly<{ type: "pointerCapture", captured: boolean, rawMotion: boolean }>;
export type InputEvent = KeyEvent | PointerMoveEvent | PointerButtonEvent | ScrollEvent | FocusEvent | PointerCaptureEvent;

export type WindowEvents = {
  key: KeyEvent,
  pointerMove: PointerMoveEvent,
  pointerButton: PointerButtonEvent,
  scroll: ScrollEvent,
  focus: FocusEvent,
  pointerCapture: PointerCaptureEvent
};

/** Latest native state, updated before any listener in a poll batch. Retained snapshots never change. */
export type InputState = Readonly<{
  keys: readonly number[],
  scancodes: readonly number[],
  buttons: readonly number[],
  focused: boolean,
  pointerCaptured: boolean,
  rawMotion: boolean,
  x: number,
  y: number
}>;

export function freezeInput(state: InputState) {
  Object.freeze(state.keys);
  Object.freeze(state.scancodes);
  Object.freeze(state.buttons);
  return Object.freeze(state);
}

/** Listener policy shared by every window input event. Has no native/GPU dependency. */
export class InputListeners {
  #listeners = new Map<keyof WindowEvents, Set<{ callback: (event: InputEvent) => undefined }>>();

  on<Event extends keyof WindowEvents>(event: Event, callback: (event: WindowEvents[Event]) => undefined) {
    if(!["key", "pointerMove", "pointerButton", "scroll", "focus", "pointerCapture"].includes(event)) {
      throw new TypeError(`Unknown window event: ${String(event)}`);
    }
    if(typeof callback !== "function") throw new TypeError("Expected a window listener");
    let listeners = this.#listeners.get(event);
    if(!listeners) {
      listeners = new Set();
      this.#listeners.set(event, listeners);
    }
    // A distinct entry lets duplicate subscriptions unsubscribe independently.
    const entry = { callback: callback as (event: InputEvent) => undefined };
    listeners.add(entry);
    return () => { listeners.delete(entry); };
  }

  dispatch(events: InputEvent[]) {
    // Additions during dispatch start next batch; removals take effect immediately.
    const snapshot = new Map(Array.from(this.#listeners, ([type, listeners]) => [type, Array.from(listeners)]));
    for(const event of events) {
      Object.freeze(event);
      const listeners = this.#listeners.get(event.type);
      for(const entry of snapshot.get(event.type) ?? []) {
        if(!listeners?.has(entry)) continue;
        const result: unknown = entry.callback(event);
        if(result !== undefined) {
          void Promise.resolve(result).catch(() => {});
          throw new TypeError(`${event.type} listeners must return undefined synchronously`);
        }
      }
    }
  }

  clear() {
    this.#listeners.clear();
  }
}
