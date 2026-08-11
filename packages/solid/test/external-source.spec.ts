import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRoot,
  createMemo,
  createSignal,
  untrack,
  enableExternalSource,
  startTransition
} from "../src/index.js";
import { getSuspenseContext } from "../src/reactive/signal.js";

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
          const trackedSources = sources.get(trigger);
          if (!trackedSources) return;
          trackedSources.forEach(x => x.removeListener(trigger));
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

  it("should not throw when rerunning external source in a new transition after disposal", async () => {
    // Initialize SuspenseContext so startTransition creates a real Transition
    getSuspenseContext();

    await createRoot(async dispose => {
      const e = new ExternalSource(0);
      const [signal, setSignal] = createSignal(0);
      const memo = createMemo(() => {
        return e.get() + signal();
      });
      expect(memo()).toBe(0);

      // First transition: triggers inTransition creation and subsequent disposal
      await startTransition(() => {
        setSignal(1);
      });

      // Allow the transition-scoped external source to dispose itself.
      await Promise.resolve();

      // Second transition: should lazily recreate inTransition, not throw on disposed one
      await expect(
        startTransition(() => {
          setSignal(2);
        })
      ).resolves.not.toThrow();

      dispose();
    });
  });

  it("should keep receiving external updates after being created during a transition", async () => {
    // Initialize SuspenseContext so startTransition creates a real Transition
    getSuspenseContext();

    const flush = () => new Promise(resolve => setTimeout(resolve));

    await createRoot(async dispose => {
      const e = new ExternalSource(0);
      let memo: (() => number) | undefined;

      // Create the memo while a transition is running. Its first run tracks
      // dependencies on the transition-scoped external source, never on the
      // ordinary one.
      await startTransition(() => {
        memo = createMemo(() => e.get());
      });
      expect(memo!()).toBe(0);

      // First external update is delivered through the transition-scoped source.
      e.update(1);
      await flush();
      expect(memo!()).toBe(1);

      // Second external update must still be delivered. Before the fix the
      // transition-scoped source had been disposed and the ordinary source was
      // never subscribed, so this update was silently lost.
      e.update(2);
      await flush();
      expect(memo!()).toBe(2);

      dispose();
    });
  });

  afterEach(() => {
    vi.resetModules();
  });
});
