import {
  createEffect,
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  pending,
  refresh,
  resolve,
  untrack
  // hasUpdated
} from "../src/index.js";

afterEach(() => flush());

it("should store and return value on read", () => {
  const [$x] = createSignal(1);
  const [$y] = createSignal(1);

  const $a = createMemo(() => $x() + $y());

  expect($a()).toBe(2);
  flush();

  // Try again to ensure state is maintained.
  expect($a()).toBe(2);
});

it("should update when dependency is updated", () => {
  const [$x, setX] = createSignal(1);
  const [$y, setY] = createSignal(1);

  const $a = createMemo(() => $x() + $y());

  setX(2);
  flush();
  expect($a()).toBe(3);

  setY(2);
  flush();
  expect($a()).toBe(4);
});

it("should update when deep dependency is updated", () => {
  const [$x, setX] = createSignal(1);
  const [$y] = createSignal(1);

  const $a = createMemo(() => $x() + $y());
  const $b = createMemo(() => $a());

  setX(2);
  flush();
  expect($b()).toBe(3);
});

it("should update when deep computed dependency is updated", () => {
  const [$x, setX] = createSignal(10);
  const [$y] = createSignal(10);

  const $a = createMemo(() => $x() + $y());
  const $b = createMemo(() => $a());
  const $c = createMemo(() => $b());

  setX(20);
  flush();
  expect($c()).toBe(30);
});

it("should only re-compute when needed", () => {
  const computed = vi.fn();

  const [$x, setX] = createSignal(10);
  const [$y, setY] = createSignal(10);

  const $a = createMemo(() => computed($x() + $y()));
  expect(computed).toHaveBeenCalledTimes(1);
  expect(computed).toHaveBeenCalledWith(20);

  $a();
  expect(computed).toHaveBeenCalledTimes(1);

  setX(20);
  expect(computed).toHaveBeenCalledTimes(1);
  flush();
  expect(computed).toHaveBeenCalledTimes(2);

  setY(20);
  flush();
  expect(computed).toHaveBeenCalledTimes(3);

  $a();
  expect(computed).toHaveBeenCalledTimes(3);
});

it("should only re-compute whats needed", () => {
  const memoA = vi.fn(n => n);
  const memoB = vi.fn(n => n);

  const [$x, setX] = createSignal(10);
  const [$y, setY] = createSignal(10);

  const $a = createMemo(() => memoA($x()));
  const $b = createMemo(() => memoB($y()));
  const $c = createMemo(() => $a() + $b());

  expect(memoA).toHaveBeenCalledTimes(1);
  expect(memoB).toHaveBeenCalledTimes(1);
  expect($c()).toBe(20);

  setX(20);
  flush();

  expect(memoA).toHaveBeenCalledTimes(2);
  expect(memoB).toHaveBeenCalledTimes(1);
  expect($c()).toBe(30);

  setY(20);
  flush();

  expect(memoA).toHaveBeenCalledTimes(2);
  expect(memoB).toHaveBeenCalledTimes(2);
  expect($c()).toBe(40);
});

it("should discover new dependencies", () => {
  const [$x, setX] = createSignal(1);
  const [$y, setY] = createSignal(0);

  const $c = createMemo(() => {
    if ($x()) {
      return $x();
    } else {
      return $y();
    }
  });

  expect($c()).toBe(1);

  setX(0);
  flush();
  expect($c()).toBe(0);

  setY(10);
  flush();
  expect($c()).toBe(10);
});

it("should accept equals option", () => {
  const [$x, setX] = createSignal(0);

  const $a = createMemo(() => $x(), 0, {
    // Skip even numbers.
    equals: (prev, next) => prev + 1 === next
  });

  const effectA = vi.fn();
  createRoot(() => createEffect($a, effectA));
  flush();

  expect($a()).toBe(0);
  expect(effectA).toHaveBeenCalledTimes(1);

  setX(2);
  flush();
  expect($a()).toBe(2);
  expect(effectA).toHaveBeenCalledTimes(2);

  // no-change
  setX(3);
  flush();
  expect($a()).toBe(2);
  expect(effectA).toHaveBeenCalledTimes(2);
});

it("should use fallback if error is thrown during init", () => {
  createRoot(() => {
    createErrorBoundary(
      () => {
        const $a = createMemo(() => {
          if (1) throw Error();
          return "";
        }, "foo");

        expect($a()).toBe("foo");
      },
      () => {}
    )();
  });
});

describe("async compute", () => {
  it("diamond should not cause waterfalls on read", async () => {
    //
    //     s
    //    / \
    //   /   \
    //  b     c
    //   \   /
    //    \ /
    //     e
    //
    const [s, set] = createSignal(1);
    const effect = vi.fn();
    const async1 = vi.fn(() => Promise.resolve(s()));
    const async2 = vi.fn(() => Promise.resolve(s()));

    createRoot(() => {
      const b = createMemo(async1);
      const c = createMemo(async2);
      createEffect(
        () => [b(), c()],
        v => effect(...v)
      );
    });

    expect(async1).toHaveBeenCalledTimes(1);
    expect(async2).toHaveBeenCalledTimes(1);
    expect(effect).toHaveBeenCalledTimes(0);
    await new Promise(r => setTimeout(r, 0));
    expect(async1).toHaveBeenCalledTimes(1);
    expect(async2).toHaveBeenCalledTimes(1);
    expect(effect).toHaveBeenCalledTimes(1);
    expect(effect).toHaveBeenCalledWith(1, 1);
    set(2);
    expect(async1).toHaveBeenCalledTimes(1);
    expect(async2).toHaveBeenCalledTimes(1);
    expect(effect).toHaveBeenCalledTimes(1);
    flush();
    expect(async1).toHaveBeenCalledTimes(2);
    expect(async2).toHaveBeenCalledTimes(2);
    expect(effect).toHaveBeenCalledTimes(1);
    await new Promise(r => setTimeout(r, 0));
    expect(async1).toHaveBeenCalledTimes(2);
    expect(async2).toHaveBeenCalledTimes(2);
    expect(effect).toHaveBeenCalledTimes(2);
    expect(effect).toHaveBeenCalledWith(2, 2);
  });

  it("should waterfall when dependent on another async with shared source", async () => {
    //
    //    s
    //   /|
    //  a |
    //   \|
    //    b
    //    |
    //    e
    //
    let a;
    const [s, set] = createSignal(1);
    const effect = vi.fn();
    const async1 = vi.fn(() => Promise.resolve(s()));
    const async2 = vi.fn(() => Promise.resolve(s() + a()));

    createRoot(() => {
      a = createMemo(async1);
      const b = createMemo(async2);

      createEffect(
        () => b(),
        v => effect(v)
      );
    });

    expect(async1).toHaveBeenCalledTimes(1);
    expect(async2).toHaveBeenCalledTimes(1);
    expect(effect).toHaveBeenCalledTimes(0);
    await new Promise(r => setTimeout(r, 0));
    expect(async1).toHaveBeenCalledTimes(1);
    expect(async2).toHaveBeenCalledTimes(2);
    expect(effect).toHaveBeenCalledTimes(1);
    expect(effect).toHaveBeenCalledWith(2);
    set(2);
    expect(async1).toHaveBeenCalledTimes(1);
    expect(async2).toHaveBeenCalledTimes(2);
    expect(effect).toHaveBeenCalledTimes(1);
    flush();
    expect(async1).toHaveBeenCalledTimes(2);
    expect(async2).toHaveBeenCalledTimes(3);
    expect(effect).toHaveBeenCalledTimes(1);
    await new Promise(r => setTimeout(r, 0));
    expect(async1).toHaveBeenCalledTimes(2);
    expect(async2).toHaveBeenCalledTimes(4);
    expect(effect).toHaveBeenCalledTimes(2);
    expect(effect).toHaveBeenCalledWith(4);
  });

  it("should should show stale state with `isPending` in graph", async () => {
    const [s, set] = createSignal(1);
    const async1 = vi.fn(() => Promise.resolve(s()));
    const a = createRoot(() => {
      const a = createMemo(async1);
      createRenderEffect(a, () => {}); // ensure re-compute
      return a;
    });
    const b = createMemo(() => (isPending(a) ? "stale" : "not stale"));
    expect(b()).toBe("not stale");
    await new Promise(r => setTimeout(r, 0));
    expect(b()).toBe("not stale");
    set(2);
    flush();
    expect(b()).toBe("stale");
    await new Promise(r => setTimeout(r, 0));
    expect(b()).toBe("not stale");
  });

  it("should should show stale state with `isPending` out of graph", async () => {
    const [s, set] = createSignal(1);
    const async1 = vi.fn(() => Promise.resolve(s()));
    const a = createRoot(() => {
      const a = createMemo(async1);
      createRenderEffect(a, () => {}); // ensure re-compute
      return a;
    });

    expect(isPending(a)).toBe(false);
    await new Promise(r => setTimeout(r, 0));
    expect(isPending(a)).toBe(false);
    set(2);
    flush();
    expect(isPending(a)).toBe(true);
    await new Promise(r => setTimeout(r, 0));
    expect(isPending(a)).toBe(false);
  });

  it("should handle refreshes", async () => {
    let n = 1;
    let value;
    const a = createRoot(() => {
      const a = createMemo(() => Promise.resolve(n++));
      createRenderEffect(a, () => {}); // ensure re-compute
      createRenderEffect(
        () => (isPending(a) ? "stale" : a()),
        v => {
          value = v;
        }
      );
      return a;
    });
    expect(value).toBe(undefined);
    await new Promise(r => setTimeout(r, 0));
    expect(value).toBe(1);
    refresh(a);
    flush(); // trigger recompute synchronously to see pending state
    expect(value).toBe("stale");
    await new Promise(r => setTimeout(r, 0));
    expect(value).toBe(2);
    refresh(a);
    flush(); // trigger recompute synchronously to see pending state
    expect(value).toBe("stale");
    await new Promise(r => setTimeout(r, 0));
    expect(value).toBe(3);
  });

  it("should should show pending state in graph", async () => {
    const [s, set] = createSignal(1);
    let res: number | null = null;
    const async1 = vi.fn(() => Promise.resolve(s()));
    createRoot(() => {
      const a = createMemo(async1);
      createRenderEffect(
        () => pending(s),
        v => {
          res = v;
        }
      );
      createRenderEffect(a, () => {}); // ensure re-compute
    });
    await new Promise(r => setTimeout(r, 0));
    expect(res).toBe(1);
    set(2);
    flush();
    expect(res).toBe(2);
    await new Promise(r => setTimeout(r, 0));
    expect(res).toBe(2);
  });

  it("should should show pending state outside of graph", async () => {
    const [s, set] = createSignal(1);
    const async1 = vi.fn(() => Promise.resolve(s()));
    createRoot(() => {
      const a = createMemo(async1);
      createRenderEffect(a, () => {}); // ensure re-compute
    });
    expect(pending(s)).toBe(1);
    await new Promise(r => setTimeout(r, 0));
    expect(pending(s)).toBe(1);
    set(2);
    flush();
    expect(pending(s)).toBe(2);
    await new Promise(r => setTimeout(r, 0));
    expect(pending(s)).toBe(2);
  });

  it("should track pending value changes for loading indicator pattern", async () => {
    const [id, setId] = createSignal(0);
    const data = createMemo(() => Promise.resolve("D" + id()));
    const effectFn = vi.fn();

    createRoot(() => {
      createRenderEffect(data, () => {}); // ensure re-compute
      // Track pending value - should return new value during transition
      createRenderEffect(
        () => pending(id),
        (pendingVal) => {
          effectFn(pendingVal);
        }
      );
    });

    // Initial: pending returns current value
    await new Promise(r => setTimeout(r, 0));
    expect(effectFn).toHaveBeenLastCalledWith(0);

    // Update triggers transition
    setId(1);
    flush();

    // During transition: pending(id) returns new value (1)
    expect(effectFn).toHaveBeenLastCalledWith(1);

    // After async resolves: pending(id) still returns 1 (now committed)
    await new Promise(r => setTimeout(r, 0));
    expect(effectFn).toHaveBeenLastCalledWith(1);
  });

  it("should resolve to a value with resolveAsync", async () => {
    const [s, set] = createSignal(1);
    const async1 = vi.fn(() => Promise.resolve(s()));
    let value: number | undefined;
    createRoot(() => {
      const a = createMemo(async1);
      createEffect(
        () => {},
        () => {
          (async () => {
            value = await resolve(a);
          })();
        }
      );
    });
    expect(value).toBe(undefined);
    await new Promise(r => setTimeout(r, 0));
    expect(value).toBe(1);
    set(2);
    expect(value).toBe(1);
    flush();
    expect(value).toBe(1);
    await new Promise(r => setTimeout(r, 0));
    // doesn't update because not tracked
    expect(value).toBe(1);
  });

  it("should handle streams", async () => {
    const effect = vi.fn();
    createRoot(() => {
      const v = createMemo(async function* () {
        yield await Promise.resolve(1);
        yield await Promise.resolve(2);
        yield await Promise.resolve(3);
      });
      createEffect(v, v => effect(v));
    });
    flush();
    expect(effect).toHaveBeenCalledTimes(0);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(effect).toHaveBeenCalledTimes(1);
    expect(effect).toHaveBeenCalledWith(1);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(effect).toHaveBeenCalledTimes(2);
    expect(effect).toHaveBeenCalledWith(2);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(effect).toHaveBeenCalledTimes(3);
    expect(effect).toHaveBeenCalledWith(3);
  });

  it("should show isPending=false for initial generator load", async () => {
    const a = createRoot(() => {
      const a = createMemo(async function* () {
        yield await Promise.resolve(1);
        yield await Promise.resolve(2);
      });
      createRenderEffect(a, () => {}); // ensure re-compute
      return a;
    });

    // Initial load: isPending should be false (no stale data)
    expect(isPending(a)).toBe(false);
    flush();
    expect(isPending(a)).toBe(false);

    // After first yield: still not pending
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(isPending(a)).toBe(false);
    expect(a()).toBe(1);

    // After second yield: still not pending (same sequence)
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(isPending(a)).toBe(false);
    expect(a()).toBe(2);
  });

  it("should show isPending=true after refresh triggers new generator sequence", async () => {
    let runCount = 0;
    const a = createRoot(() => {
      const a = createMemo(async function* () {
        const run = ++runCount;
        yield await Promise.resolve(run * 10 + 1);
        yield await Promise.resolve(run * 10 + 2);
      });
      createRenderEffect(a, () => {}); // ensure re-compute
      return a;
    });

    // Initial load completes
    flush();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(a()).toBe(11); // run 1, yield 1
    expect(isPending(a)).toBe(false);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(a()).toBe(12); // run 1, yield 2
    expect(isPending(a)).toBe(false);

    // Refresh triggers new sequence - now we have stale data
    refresh(a);
    flush();
    expect(isPending(a)).toBe(true); // has old value 12, loading new
    expect(a()).toBe(12); // still shows old value

    // After new sequence's first yield: no longer pending
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(isPending(a)).toBe(false);
    expect(a()).toBe(21); // run 2, yield 1
  });

  it("should not be pending between yields in same sequence", async () => {
    const pendingStates: boolean[] = [];
    const values: number[] = [];

    createRoot(() => {
      const a = createMemo(async function* () {
        yield await Promise.resolve(1);
        yield await Promise.resolve(2);
        yield await Promise.resolve(3);
      });

      createRenderEffect(a, v => {
        values.push(v);
        pendingStates.push(isPending(a));
      });
    });

    flush();
    // Wait for all yields (3 awaits per yield * 3 yields)
    for (let i = 0; i < 9; i++) {
      await Promise.resolve();
    }

    expect(values).toEqual([1, 2, 3]);
    // isPending should be false for all yields (initial sequence has no stale data)
    expect(pendingStates).toEqual([false, false, false]);
  });

  it("should still resolve in untracked scopes", async () => {
    const [s, set] = createSignal(1);
    const async1 = vi.fn(() => Promise.resolve(s()));
    const effect = vi.fn();
    createRoot(() => {
      const a = createMemo(async1);
      createEffect(
        () => untrack(a),
        v => effect(v)
      );
    });
    expect(effect).toHaveBeenCalledTimes(0);
    flush();
    expect(effect).toHaveBeenCalledTimes(0);
    await Promise.resolve();
    expect(effect).toHaveBeenCalledTimes(1);
    expect(effect).toHaveBeenCalledWith(1);
    set(2);
    flush();
    expect(effect).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(effect).toHaveBeenCalledTimes(1);
    set(3);
    flush();
    expect(effect).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(effect).toHaveBeenCalledTimes(1);
  });

  // it("should still resolve in deferred untracked scopes", async () => {
  //   const [s, set] = createSignal(1);
  //   const async1 = vi.fn(() => Promise.resolve(s()));
  //   const effect = vi.fn();
  //   createRoot(() => {
  //     const a = createMemo(async1);
  //     createTrackedEffect(() => untrack(() => effect(a())));
  //   });
  //   expect(effect).toHaveBeenCalledTimes(0);
  //   flush();
  //   expect(effect).toHaveBeenCalledTimes(0);
  //   await Promise.resolve();
  //   expect(effect).toHaveBeenCalledTimes(1);
  //   expect(effect).toHaveBeenCalledWith(1);
  //   set(2);
  //   flush();
  //   expect(effect).toHaveBeenCalledTimes(1);
  //   await Promise.resolve();
  //   expect(effect).toHaveBeenCalledTimes(1);
  //   set(3);
  //   flush();
  //   expect(effect).toHaveBeenCalledTimes(1);
  //   await Promise.resolve();
  //   expect(effect).toHaveBeenCalledTimes(1);
  // });

  it("pending() on upstream vs downstream of async", async () => {
    const [$x, setX] = createSignal(1);
    let syncMemo: () => number;
    let asyncMemo: () => number;

    createRoot(() => {
      // Sync memo upstream of async
      syncMemo = createMemo(() => $x() * 2);
      
      // Async memo (the async boundary)
      asyncMemo = createMemo(async () => {
        const v = syncMemo();
        await Promise.resolve();
        return v * 10;
      });

      // Effect creates the transition
      createRenderEffect(asyncMemo, () => {});
    });

    // Initial load
    await new Promise(r => setTimeout(r, 0));
    expect(syncMemo!()).toBe(2);
    expect(asyncMemo!()).toBe(20);

    // Change signal - starts new async
    setX(2);
    flush();

    // Upstream of async: pending() returns in-flight value
    expect(pending($x)).toBe(2);    // signal: in-flight
    expect($x()).toBe(1);           // signal: committed
    expect(pending(syncMemo!)).toBe(4);  // sync memo: in-flight
    expect(syncMemo!()).toBe(2);         // sync memo: committed

    // The async node itself: pending() returns committed (no new value yet)
    expect(pending(asyncMemo!)).toBe(20); // same as committed
    expect(asyncMemo!()).toBe(20);

    // After completion
    await new Promise(r => setTimeout(r, 0));
    expect(asyncMemo!()).toBe(40);
    expect(syncMemo!()).toBe(4);
    expect($x()).toBe(2);
  });

  it("pending() on upstream signal during transition", async () => {
    const [$x, setX] = createSignal(1);
    let a: () => number;

    createRoot(() => {
      a = createMemo(async () => {
        const v = $x();
        await Promise.resolve();
        return v * 10;
      });

      createRenderEffect(a, () => {});
    });

    // Initial load
    await new Promise(r => setTimeout(r, 0));
    expect(a!()).toBe(10);

    // Change signal - starts transition
    setX(2);
    flush();

    // Upstream signal is also held in transition
    expect(pending($x)).toBe(2); // new value
    expect($x()).toBe(1); // committed value

    // After completion
    await new Promise(r => setTimeout(r, 0));
    expect($x()).toBe(2);
    expect(pending($x)).toBe(2);
  });

  it("isPending and pending on upstream signal that triggers async memo", async () => {
    const [$x, setX] = createSignal(1);
    let a: () => number;

    createRoot(() => {
      a = createMemo(async () => {
        const v = $x();
        await Promise.resolve();
        return v * 10;
      });

      createRenderEffect(a, () => {});
    });

    // Initial load
    flush();
    expect(isPending($x)).toBe(false); // no stale data initially
    await new Promise(r => setTimeout(r, 0));

    // Change signal
    setX(2);
    flush();

    // Upstream signal is pending (value held in transition)
    expect(isPending($x)).toBe(true);
    expect(pending($x)).toBe(2); // new value
    expect($x()).toBe(1); // old value

    // Downstream memo is also pending
    expect(isPending(a!)).toBe(true);

    // After completion
    await new Promise(r => setTimeout(r, 0));
    expect(isPending($x)).toBe(false);
    expect(isPending(a!)).toBe(false);
    expect($x()).toBe(2);
    expect(pending($x)).toBe(2);
  });

  it("isPending with chained async memos", async () => {
    const [$x, setX] = createSignal(1);
    let a: () => number;
    let b: () => number;

    createRoot(() => {
      a = createMemo(async () => {
        const v = $x();
        await Promise.resolve();
        return v * 10;
      });

      b = createMemo(async () => {
        const v = a();
        await Promise.resolve();
        return v + 1;
      });

      createRenderEffect(b, () => {});
    });

    // Initial load - wait for both to complete
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(a!()).toBe(10);
    expect(b!()).toBe(11);

    // Change signal - triggers chain
    setX(2);
    flush();

    // Both should be pending
    expect(isPending(a!)).toBe(true);
    expect(isPending(b!)).toBe(true);

    // After all async completes
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(a!()).toBe(20);
    expect(b!()).toBe(21);
    expect(isPending(a!)).toBe(false);
    expect(isPending(b!)).toBe(false);
  });

  it("isPending with sync memo depending on async memo", async () => {
    const [$x, setX] = createSignal(1);
    let asyncMemo: () => number;
    let syncMemo: () => number;

    createRoot(() => {
      asyncMemo = createMemo(async () => {
        const v = $x();
        await Promise.resolve();
        return v * 10;
      });

      syncMemo = createMemo(() => asyncMemo() + 1);

      createRenderEffect(syncMemo, () => {});
    });

    // Initial load
    await new Promise(r => setTimeout(r, 0));
    expect(asyncMemo!()).toBe(10);
    expect(syncMemo!()).toBe(11);

    // Change signal
    setX(2);
    flush();

    // Both pending - sync memo has stale data from async memo
    expect(isPending(asyncMemo!)).toBe(true);
    expect(isPending(syncMemo!)).toBe(true);

    // After completion
    await new Promise(r => setTimeout(r, 0));
    expect(asyncMemo!()).toBe(20);
    expect(syncMemo!()).toBe(21);
    expect(isPending(asyncMemo!)).toBe(false);
    expect(isPending(syncMemo!)).toBe(false);
  });

  it("isPending full lifecycle - false to true to false", async () => {
    const [$x, setX] = createSignal(1);
    let a: () => number;

    createRoot(() => {
      a = createMemo(async () => {
        const v = $x();
        await Promise.resolve();
        return v * 10;
      });

      createRenderEffect(a, () => {});
    });

    // Initial load - not pending (no stale data)
    flush();
    expect(isPending(a!)).toBe(false);
    await new Promise(r => setTimeout(r, 0));
    expect(isPending(a!)).toBe(false);
    expect(a!()).toBe(10);

    // Change signal
    setX(2);
    flush();

    // Should be pending (has stale data while loading)
    expect(isPending(a!)).toBe(true);
    expect(a!()).toBe(10); // still old value

    // After completion
    await new Promise(r => setTimeout(r, 0));

    // Should be not pending, new value
    expect(isPending(a!)).toBe(false);
    expect(a!()).toBe(20);
  });
});

// it("should detect which signal triggered it", () => {
//   const [$x, setX] = createSignal(0);
//   const [$y, setY] = createSignal(0);

//   const $a = createMemo(() => {
//     const uX = hasUpdated($x);
//     const uY = hasUpdated($y);
//     return uX && uY ? "both" : uX ? "x" : uY ? "y" : "neither";
//   });
//   createRoot(() => createEffect($a, () => {}));
//   expect($a()).toBe("neither");
//   flush();
//   expect($a()).toBe("neither");

//   setY(1);
//   flush();
//   expect($a()).toBe("y");

//   setX(1);
//   flush();
//   expect($a()).toBe("x");

//   setY(2);
//   flush();
//   expect($a()).toBe("y");

//   setX(2);
//   setY(3);
//   flush();
//   expect($a()).toBe("both");
// });
