import { _resetExternalSourceConfig } from "../src/core/index.js";
import {
  createEffect,
  createMemo,
  createRoot,
  createRenderEffect,
  createSignal,
  enableExternalSource,
  flush,
  untrack
} from "../src/index.js";

afterEach(() => {
  flush();
  _resetExternalSourceConfig();
});

class ExternalSource<T = any> {
  listeners: Set<() => void> = new Set();

  constructor(private value: T) {}

  update(x: T) {
    this.value = x;
    this.listeners.forEach(l => l());
  }

  get() {
    if (activeListener) {
      this.listeners.add(activeListener);
      trackedSources.get(activeListener)!.add(this);
    }
    return this.value;
  }

  removeListener(listener: () => void) {
    this.listeners.delete(listener);
  }
}

let activeListener: (() => void) | null = null;
let trackedSources: Map<() => void, Set<ExternalSource>> = new Map();

function untrackExternal<T>(fn: () => T): T {
  const prev = activeListener;
  activeListener = null;
  try {
    return fn();
  } finally {
    activeListener = prev;
  }
}

function setupExternalSource() {
  enableExternalSource({
    factory: (fn, trigger) => {
      trackedSources.set(trigger, new Set());
      return {
        track: x => {
          const prev = activeListener;
          activeListener = trigger;
          try {
            return fn(x);
          } finally {
            activeListener = prev;
          }
        },
        dispose: () => {
          trackedSources.get(trigger)!.forEach(s => s.removeListener(trigger));
          trackedSources.delete(trigger);
        }
      };
    },
    untrack: untrackExternal
  });
}

it("should trigger memo update on external source change", () => {
  setupExternalSource();

  createRoot(() => {
    const e = new ExternalSource(0);
    const $memo = createMemo(() => e.get());

    expect($memo()).toBe(0);

    e.update(1);
    flush();
    expect($memo()).toBe(1);

    e.update(2);
    flush();
    expect($memo()).toBe(2);
  });
});

it("should not track external reads inside untrack", () => {
  setupExternalSource();

  createRoot(() => {
    const e = new ExternalSource(0);
    const $memo = createMemo(() => untrack(() => e.get()));

    expect($memo()).toBe(0);

    e.update(1);
    flush();
    expect($memo()).toBe(0);
  });
});

it("should work with mixed Solid and external dependencies", () => {
  setupExternalSource();

  const e = new ExternalSource(1);
  const [$x, setX] = createSignal(10);
  let $memo: () => number;

  createRoot(() => {
    $memo = createMemo(() => $x() + e.get());
  });

  expect($memo!()).toBe(11);

  setX(20);
  flush();
  expect($memo!()).toBe(21);

  e.update(5);
  flush();
  expect($memo!()).toBe(25);

  setX(100);
  e.update(50);
  flush();
  expect($memo!()).toBe(150);
});

it("should trigger effect on external source change", () => {
  setupExternalSource();

  const values: number[] = [];

  createRoot(() => {
    const e = new ExternalSource(5);
    createEffect(
      () => e.get(),
      val => {
        values.push(val);
      }
    );
  });
  flush();
  expect(values).toEqual([5]);

  // Can't update e here since it's scoped inside createRoot.
  // Test the pattern through the memo instead.
});

it("should trigger effect with external + Solid deps", () => {
  setupExternalSource();

  const values: number[] = [];
  const e = new ExternalSource(1);
  const [$x, setX] = createSignal(10);

  createRoot(() => {
    createEffect(
      () => $x() + e.get(),
      val => {
        values.push(val);
      }
    );
  });
  flush();
  expect(values).toEqual([11]);

  e.update(2);
  flush();
  expect(values).toEqual([11, 12]);

  setX(20);
  flush();
  expect(values).toEqual([11, 12, 22]);
});

it("should dispose external source on root disposal", () => {
  const disposed = vi.fn();
  enableExternalSource({
    factory: (fn, trigger) => ({
      track: prev => fn(prev),
      dispose: disposed
    })
  });

  let disposeFn!: () => void;
  createRoot(dispose => {
    disposeFn = dispose;
    createMemo(() => 1);
  });
  flush();

  expect(disposed).not.toHaveBeenCalled();
  disposeFn();
  flush();
  expect(disposed).toHaveBeenCalledTimes(1);
});

it("should pipe multiple enableExternalSource calls", () => {
  setupExternalSource();

  // Second registration that does nothing — verify piping doesn't break
  enableExternalSource({
    factory: fn => ({
      track: fn,
      dispose: () => {}
    })
  });

  createRoot(() => {
    const e = new ExternalSource(0);
    const $memo = createMemo(() => e.get());

    expect($memo()).toBe(0);

    e.update(1);
    flush();
    expect($memo()).toBe(1);
  });
});

it("should re-track external dependencies on recompute", () => {
  setupExternalSource();

  const a = new ExternalSource(1);
  const b = new ExternalSource(100);
  const [$useB, setUseB] = createSignal(false);
  let $memo: () => number;

  createRoot(() => {
    $memo = createMemo(() => ($useB() ? b.get() : a.get()));
  });

  expect($memo!()).toBe(1);

  setUseB(true);
  flush();
  expect($memo!()).toBe(100);

  // Source A changes should not trigger (not tracked anymore)
  a.update(999);
  flush();
  expect($memo!()).toBe(100);

  // Source B changes should trigger
  b.update(200);
  flush();
  expect($memo!()).toBe(200);
});

it("should not affect computeds when not enabled", () => {
  // No enableExternalSource — normal Solid behavior
  const [$x, setX] = createSignal(1);
  const $memo = createMemo(() => $x() * 3);

  expect($memo()).toBe(3);

  setX(5);
  flush();
  expect($memo()).toBe(15);
});

it("should keep external source tracking across multiple async transitions", async () => {
  setupExternalSource();

  const e = new ExternalSource(1);
  let $async: () => number;
  let resolveAsync: (() => void) | null = null;

  createRoot(() => {
    const $memo = createMemo(() => e.get());
    $async = createMemo(() => {
      const value = $memo();
      return new Promise<number>(resolve => {
        resolveAsync = () => resolve(value * 10);
      });
    });

    // Subscribe so async recomputes create real transitions.
    createRenderEffect($async, () => {});
  });

  flush();
  resolveAsync!();
  await Promise.resolve();
  flush();
  expect($async!()).toBe(10);

  expect(() => {
    e.update(2);
    flush();
  }).not.toThrow();
  resolveAsync!();
  await Promise.resolve();
  flush();
  expect($async!()).toBe(20);

  expect(() => {
    e.update(3);
    flush();
  }).not.toThrow();
  resolveAsync!();
  await Promise.resolve();
  flush();
  expect($async!()).toBe(30);
});
