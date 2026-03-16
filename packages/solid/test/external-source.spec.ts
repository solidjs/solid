import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, createMemo, untrack, enableExternalSource, createSignal } from "../src/index.js";

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

function untrackSource<T>(fn: () => T) {
  const tmp = listener;
  listener = null;
  try {
    return fn();
  } finally {
    listener = tmp;
  }
}

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
    }, untrackSource);

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
      const memo2 = createMemo(() => {
        return untrack(() => e.get());
      });
      expect(memo()).toBe(0);
      expect(memo2()).toBe(0);
      e.update(1);
      expect(memo()).toBe(1);
      expect(memo2()).toBe(0);
      fn();
    });
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("should handle multiple transitions with external sources without errors", () => {
    // This test verifies the fix for issue #2275
    // https://github.com/solidjs/solid/issues/2275
    createRoot(fn => {
      const e = new ExternalSource(0);
      const [signal, setSignal] = createSignal(0);

      let memoRuns = 0;
      const memo = createMemo(() => {
        memoRuns++;
        // Access both external source and signal to trigger tracking
        return e.get() + signal();
      });

      expect(memo()).toBe(0);
      expect(memoRuns).toBe(1);

      // Trigger external source update
      e.update(1);
      expect(memo()).toBe(1);
      expect(memoRuns).toBe(2);

      // Update signal
      setSignal(1);
      expect(memo()).toBe(2);
      expect(memoRuns).toBe(3);

      // This should not throw an error
      e.update(2);
      expect(memo()).toBe(3);

      fn();
    });
  });
});
