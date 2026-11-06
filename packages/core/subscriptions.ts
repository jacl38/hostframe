/** Internal synchronous listener mechanics; owners choose dispatch boundaries and lifecycle policy. */
export class Subscriptions<Value> {
  #entries = new Set<{ callback: (value: Value) => undefined }>();
  #event: string;
  #owner: string;

  constructor(event: string, owner: string) {
    this.#event = event;
    this.#owner = owner;
  }

  get size() { return this.#entries.size; }

  add(callback: (value: Value) => undefined) {
    if(typeof callback !== "function") throw new TypeError(`Expected ${this.#owner} listener`);
    // Entries, rather than callbacks, make duplicate registrations independent.
    const entry = { callback };
    this.#entries.add(entry);
    return () => { this.#entries.delete(entry); };
  }

  snapshot() {
    const entries = Array.from(this.#entries);
    // The owner can retain this dispatch function for an entire input batch.
    return (value: Value, active?: () => boolean) => {
      for(const entry of entries) {
        if(active && !active()) break;
        if(!this.#entries.has(entry)) continue;
        const result: unknown = entry.callback(value);
        if(result !== undefined) {
          void Promise.resolve(result).catch(() => {});
          throw new TypeError(`${this.#event} listeners must return undefined synchronously`);
        }
      }
    };
  }

  clear() {
    this.#entries.clear();
  }
}
