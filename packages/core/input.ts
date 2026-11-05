import type { InputEvent, InputState } from "../../build/native/generated/native";
import { inputEventTypes } from "../../build/native/generated/input-events.ts";
export type { InputEvent, InputState, KeyEvent, PointerMoveEvent, PointerButtonEvent, ScrollEvent, FocusEvent, PointerCaptureEvent } from "../../build/native/generated/native";

export type WindowInputEvents = {
  [Event in InputEvent as Event["type"]]: Event
};

export function freezeInput(state: InputState) {
  Object.freeze(state.keys);
  Object.freeze(state.scancodes);
  Object.freeze(state.buttons);
  return Object.freeze(state);
}

/** Listener policy shared by every window input event. Loads no native addon or GPU. */
export class InputListeners {
  #listeners = new Map<keyof WindowInputEvents, Set<{ callback: (event: InputEvent) => undefined }>>();

  on<Event extends keyof WindowInputEvents>(event: Event, callback: (event: WindowInputEvents[Event]) => undefined) {
    if(!inputEventTypes.includes(event)) {
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
