import type { InputEvent as NativeInputEvent, InputState } from "../../build/native/generated/native";
import { Subscriptions } from "./subscriptions.ts";
import { inputEventTypes } from "../../build/native/generated/input-events.ts";
export type { InputState, KeyEvent, PointerMoveEvent, PointerButtonEvent, ScrollEvent, FocusEvent, PointerCaptureEvent } from "../../build/native/generated/native";

/** Cancel only during synchronous delivery. For asynchronous prompts, cancel first, then force-close after saving. */
export type CloseRequestEvent = Readonly<Extract<NativeInputEvent, { type: "closeRequest" }> & {
  defaultPrevented: boolean,
  preventDefault: () => void
}>;

export type InputEvent = Exclude<NativeInputEvent, { type: "closeRequest" }> | CloseRequestEvent;

export type WindowInputEvents = {
  [Event in InputEvent as Event["type"]]: Event
};

export function freezeInput(state: InputState) {
  Object.freeze(state.metrics);
  Object.freeze(state.status);
  Object.freeze(state.keys);
  Object.freeze(state.scancodes);
  Object.freeze(state.buttons);
  return Object.freeze(state);
}

/** Listener policy shared by every window input event. Loads no native addon or GPU. */
export class InputListeners {
  #listeners = new Map<keyof WindowInputEvents, Subscriptions<InputEvent>>();

  on<Event extends keyof WindowInputEvents>(event: Event, callback: (event: WindowInputEvents[Event]) => undefined) {
    if(!inputEventTypes.includes(event)) {
      throw new TypeError(`Unknown window event: ${String(event)}`);
    }
    let listeners = this.#listeners.get(event);
    if(!listeners) {
      listeners = new Subscriptions(event, "a window");
      this.#listeners.set(event, listeners);
    }
    return listeners.add(callback as (event: InputEvent) => undefined);
  }

  dispatch(events: NativeInputEvent[], acceptClose: () => void = () => {}) {
    // Additions during dispatch start next batch; removals take effect immediately.
    const snapshot = new Map(Array.from(this.#listeners, ([type, listeners]) => [type, listeners.snapshot()]));
    for(const event of events) {
      if(event.type === "closeRequest") {
        let active = true;
        let canceled = false;
        const request: CloseRequestEvent = Object.freeze({
          type: "closeRequest",
          get defaultPrevented() { return canceled; },
          preventDefault() {
            if(!active) throw new Error("Close cancellation is only valid during synchronous closeRequest delivery");
            canceled = true;
          }
        });
        try {
          snapshot.get(event.type)?.(request);
        } finally {
          active = false;
        }
        if(!canceled) acceptClose();
      } else {
        if(event.type === "metrics") Object.freeze(event.metrics);
        Object.freeze(event);
        snapshot.get(event.type)?.(event);
      }
    }
  }

  clear() {
    for(const listeners of this.#listeners.values()) listeners.clear();
    this.#listeners.clear();
  }
}
