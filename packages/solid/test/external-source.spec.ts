import { createRoot, createMemo, enableExternalSource } from "../src";

import "./MessageChannel";

class ExternalSource<T = any> {
  listeners: Set<() => void> = new Set();

  constructor(private value: T) {}

  update(x: T) {
    this.value = x;
    this.listeners.forEach(x => x());
  }

  get() {
    if (listener) {
      this.listeners.add(listener!);
      sources.get(listener!)!.add(this);
    }
    return this.value;
  }

  removeListener(listener: () => void) {
    this.listeners.delete(listener);
  }
}

let listener: (() => void) | null = null;

let sources: Map<() => void, Set<ExternalSource>> = new Map();

describe("external source", () => {
  beforeEach(() => {
    enableExternalSource((fn, trigger) => {
      sources.set(trigger, new Set());
      return {
        track: x => {
          const tmp = listener;
          // trigger could play the role of listener，as it has stable reference
          listener = trigger;
          try {
            return fn(x);
          } finally {
            listener = tmp;
          }
        },
        dispose: () => {
          sources.get(trigger)!.forEach(x => x.removeListener(trigger));
          sources.delete(trigger);
        }
      };
    });

    enableExternalSource(fn => {
      return {
        track: fn,
        dispose: () => {}
      };
    }); // do nothing, make sure multiple factories be piped.
  });
  it("should trigger solid primitive update", () => {
    createRoot(fn => {
      const e = new ExternalSource(0);
      const memo = createMemo(() => {
        return e.get();
      });
      expect(memo()).toBe(0);
      e.update(1);
      expect(memo()).toBe(1);
      fn();
    });
  });

  afterEach(() => {
    vi.resetModules();
  });
});
