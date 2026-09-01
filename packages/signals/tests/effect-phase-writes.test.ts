import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  createStore,
  createTrackedEffect,
  flush,
  onSettled
} from "../src/index.js";

afterEach(() => flush());

// Effect-phase scopes (the effect half of createEffect, onSettled,
// createTrackedEffect) share one contract (#3006): reads return the settled
// graph, writes are queued into the same flush's continuation, and a callback
// never observes its own unsettled write.

it("onSettled write-then-read returns the settled value; dependents update in the same flush", () => {
  const reads: number[] = [];
  const effectValues: number[] = [];

  createRoot(() => {
    const [count, setCount] = createSignal(0);

    createEffect(
      () => count(),
      v => {
        effectValues.push(v);
      }
    );

    onSettled(() => {
      reads.push(count());
      setCount(1);
      reads.push(count());
    });
  });

  flush();
  expect(reads).toEqual([0, 0]);
  // The write still lands in the same flush's continuation.
  expect(effectValues).toEqual([0, 1]);
});

it("onSettled functional setters compose against the staged value", () => {
  const effectValues: number[] = [];
  let readBack = -1;

  createRoot(() => {
    const [count, setCount] = createSignal(0);

    createEffect(
      () => count(),
      v => {
        effectValues.push(v);
      }
    );

    onSettled(() => {
      setCount(v => v + 1);
      setCount(v => v + 1);
      readBack = count();
    });
  });

  flush();
  // Reads stay settled, but the second functional update composes on the first.
  expect(readBack).toBe(0);
  expect(effectValues).toEqual([0, 2]);
});

it("onSettled reads memos derived from its own write at their settled value", () => {
  const reads: number[] = [];
  const memoValues: number[] = [];

  createRoot(() => {
    const [count, setCount] = createSignal(0);
    const doubled = createMemo(() => count() * 2);

    createEffect(
      () => doubled(),
      v => {
        memoValues.push(v);
      }
    );

    onSettled(() => {
      setCount(1);
      reads.push(doubled());
    });
  });

  flush();
  expect(reads).toEqual([0]);
  expect(memoValues).toEqual([0, 2]);
});

it("createTrackedEffect write-then-read returns the settled value", () => {
  const reads: number[] = [];
  let ran = false;

  createRoot(() => {
    const [trigger] = createSignal(0);
    const [other, setOther] = createSignal(0);

    createTrackedEffect(() => {
      trigger();
      if (!ran) {
        ran = true;
        setOther(1);
        reads.push(other());
      }
    });
  });

  flush();
  expect(reads).toEqual([0]);
});

it("createEffect's effect half write-then-read returns the settled value (regression pin)", () => {
  const reads: number[] = [];

  createRoot(() => {
    const [a] = createSignal(0);
    const [b, setB] = createSignal(0);

    createEffect(
      () => a(),
      () => {
        setB(1);
        reads.push(b());
      }
    );
  });

  flush();
  expect(reads).toEqual([0]);
});

it("onSettled does not observe unsettled writes from earlier effects in the same phase", () => {
  const reads: number[] = [];

  createRoot(() => {
    const [a] = createSignal(0);
    const [x, setX] = createSignal(0);

    // Registered first, so it runs first in the user-effect phase.
    createEffect(
      () => a(),
      () => {
        setX(1);
      }
    );

    onSettled(() => {
      reads.push(x());
    });
  });

  flush();
  expect(reads).toEqual([0]);
});

it("onSettled store write-then-read returns the settled value", () => {
  const reads: number[] = [];
  const effectValues: number[] = [];

  createRoot(() => {
    const [store, setStore] = createStore({ count: 0 });

    createEffect(
      () => store.count,
      v => {
        effectValues.push(v);
      }
    );

    onSettled(() => {
      reads.push(store.count);
      setStore(s => {
        s.count = 1;
      });
      reads.push(store.count);
    });
  });

  flush();
  expect(reads).toEqual([0, 0]);
  expect(effectValues).toEqual([0, 1]);
});

it("onSettled projection-store write-then-read returns the settled value (#3082)", () => {
  // Derived (projection) stores park writes in a pending backing that is
  // authoritative-elect for context-free readers — but CHILDREN_FORBIDDEN
  // scopes must still get committed visibility, same as plain stores and
  // signals: a callback never observes its own unsettled write.
  const reads: [number, number][] = [];
  const effectValues: number[] = [];

  createRoot(() => {
    const [store, setStore] = createStore(() => ({ count: 0 }), { count: 0 });
    const [sig, setSig] = createSignal(0);

    createEffect(
      () => store.count,
      v => {
        effectValues.push(v);
      }
    );

    onSettled(() => {
      reads.push([store.count, sig()]);
      setStore(s => {
        s.count = 1;
      });
      setSig(1);
      // Store and signal must agree: both committed until the next flush.
      reads.push([store.count, sig()]);
    });
  });

  flush();
  expect(reads).toEqual([
    [0, 0],
    [0, 0]
  ]);
  expect(effectValues).toEqual([0, 1]);
});

it("createTrackedEffect projection-store reads are committed-visibility (#3082)", () => {
  const reads: number[] = [];

  createRoot(() => {
    const [store, setStore] = createStore(() => ({ count: 0 }), { count: 0 });
    const [tick, setTick] = createSignal(0);

    createTrackedEffect(() => {
      tick();
      reads.push(store.count);
    });

    onSettled(() => {
      if (reads.length === 1) {
        setStore(s => {
          s.count = 5;
        });
        setTick(1);
      }
    });
  });

  flush();
  // First run sees 0; the onSettled write lands in the continuation, so the
  // tick-triggered re-run sees the settled 5 — never the staged draft early.
  expect(reads).toEqual([0, 5]);
});

it("warns in dev when flush() is called from a createEffect callback", () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const effectValues: number[] = [];

  try {
    createRoot(() => {
      const [count, setCount] = createSignal(0);

      createEffect(
        () => count(),
        v => {
          effectValues.push(v);
          if (v === 0) {
            setCount(1);
            flush();
          }
        }
      );
    });

    flush();
    const flushWarnings = warnSpy.mock.calls.filter(args =>
      String(args[0]).includes("FLUSH_IN_EFFECT_CALLBACK")
    );
    expect(flushWarnings.length).toBe(1);
    // The no-op flush neither drains early nor loses the write.
    expect(effectValues).toEqual([0, 1]);
  } finally {
    warnSpy.mockRestore();
  }
});
