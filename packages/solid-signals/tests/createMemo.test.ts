import {
  createEffect,
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  onCleanup,
  latest,
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
  it("should not auto-dispose zombie computed when it loses subscribers during transition", async () => {
    const [$route, setRoute] = createSignal("home");
    const zombieCleanup = vi.fn();
    let resolveAsync!: () => void;
    let asyncMemo: (() => string) | undefined;

    createRoot(() => {
      const parent = createMemo(() => {
        const child = createMemo(() => {
          onCleanup(zombieCleanup);
          return "child";
        });
        if ($route() !== "home") {
          asyncMemo = createMemo(
            () => new Promise<string>(res => (resolveAsync = () => res("async")))
          );
        }
        return child;
      });

      // Effect A: reads parent and the async memo — drives the transition.
      // When the async memo is pending, this effect catches NotReadyError and
      // propagates STATUS_PENDING to the GlobalQueue, registering the async node.
      createRenderEffect(
        () => {
          parent();
          if (asyncMemo) asyncMemo();
          return null;
        },
        () => {}
      );

      // Effect B: always subscribes to parent but conditionally reads the child.
      // When $route changes, this effect reads parent's pending value (the new child)
      // but skips calling it — dropping its subscription to the old (zombie) child.
      createRenderEffect(
        () => {
          const component = parent();
          if ($route() === "home") {
            return component();
          }
          return "fallback";
        },
        () => {}
      );
    });

    flush();
    expect(zombieCleanup).not.toHaveBeenCalled();

    setRoute("profile");
    flush();

    // The old child is a zombie that lost its subscriber (Effect B shifted deps).
    // Without the fix, unobserved() fires and the zombie is prematurely disposed.
    expect(zombieCleanup).not.toHaveBeenCalled();

    // Transition still pending — zombie should stay alive.
    await new Promise(r => setTimeout(r, 10));
    expect(zombieCleanup).not.toHaveBeenCalled();

    // Resolve async → transition completes → finalizePureQueue disposes zombie children.
    resolveAsync();
    await new Promise(r => setTimeout(r, 0));
    expect(zombieCleanup).toHaveBeenCalledTimes(1);
  });

  it("should throw when reading uninitialized async computed outside reactive scope", async () => {
    const a = createRoot(() => {
      const a = createMemo(() => Promise.resolve(42));
      createRenderEffect(a, () => {});
      return a;
    });

    expect(() => a()).toThrow();

    await new Promise(r => setTimeout(r, 0));
    expect(a()).toBe(42);
  });

  it("should return stale value when reading re-pending async computed outside reactive scope", async () => {
    const [s, set] = createSignal(1);
    const a = createRoot(() => {
      const a = createMemo(() => Promise.resolve(s()));
      createRenderEffect(a, () => {});
      return a;
    });

    await new Promise(r => setTimeout(r, 0));
    expect(a()).toBe(1);

    set(2);
    flush();
    expect(a()).toBe(1);

    await new Promise(r => setTimeout(r, 0));
    expect(a()).toBe(2);
  });

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
        () => latest(s),
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
    expect(latest(s)).toBe(1);
    await new Promise(r => setTimeout(r, 0));
    expect(latest(s)).toBe(1);
    set(2);
    flush();
    expect(latest(s)).toBe(2);
    await new Promise(r => setTimeout(r, 0));
    expect(latest(s)).toBe(2);
  });

  it("should track pending value changes for loading indicator pattern", async () => {
    const [id, setId] = createSignal(0);
    const data = createMemo(() => Promise.resolve("D" + id()));
    const effectFn = vi.fn();

    createRoot(() => {
      createRenderEffect(data, () => {}); // ensure re-compute
      // Track latest value - should return new value during transition
      createRenderEffect(
        () => latest(id),
        pendingVal => {
          effectFn(pendingVal);
        }
      );
    });

    // Initial: latest returns current value
    await new Promise(r => setTimeout(r, 0));
    expect(effectFn).toHaveBeenLastCalledWith(0);

    // Update triggers transition
    setId(1);
    flush();

    // During transition: latest(id) returns new value (1)
    expect(effectFn).toHaveBeenLastCalledWith(1);

    // After async resolves: latest(id) still returns 1 (now committed)
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

  it("latest() on upstream vs downstream of async", async () => {
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

    // Upstream of async: latest() returns in-flight value
    expect(latest($x)).toBe(2); // signal: in-flight
    expect($x()).toBe(1); // signal: committed
    expect(latest(syncMemo!)).toBe(4); // sync memo: in-flight
    expect(syncMemo!()).toBe(2); // sync memo: committed

    // The async node itself: latest() returns committed (no new value yet)
    expect(latest(asyncMemo!)).toBe(20); // same as committed
    expect(asyncMemo!()).toBe(20);

    // After completion
    await new Promise(r => setTimeout(r, 0));
    expect(asyncMemo!()).toBe(40);
    expect(syncMemo!()).toBe(4);
    expect($x()).toBe(2);
  });

  it("latest() on upstream signal during transition", async () => {
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
    expect(latest($x)).toBe(2); // new value
    expect($x()).toBe(1); // committed value

    // After completion
    await new Promise(r => setTimeout(r, 0));
    expect($x()).toBe(2);
    expect(latest($x)).toBe(2);
  });

  it("isPending and latest on upstream signal that triggers async memo", async () => {
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
    expect(latest($x)).toBe(2); // new value
    expect($x()).toBe(1); // old value

    // Downstream memo is also pending
    expect(isPending(a!)).toBe(true);

    // After completion
    await new Promise(r => setTimeout(r, 0));
    expect(isPending($x)).toBe(false);
    expect(isPending(a!)).toBe(false);
    expect($x()).toBe(2);
    expect(latest($x)).toBe(2);
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

  it("isPending read inside reactive context (memo)", async () => {
    const [$x, setX] = createSignal(1);
    let asyncMemo: () => number;
    let pendingMemo: () => boolean;
    const pendingValues: boolean[] = [];

    createRoot(() => {
      asyncMemo = createMemo(async () => {
        const v = $x();
        await Promise.resolve();
        return v * 10;
      });

      // Memo that tracks isPending state
      pendingMemo = createMemo(() => isPending(asyncMemo));

      createRenderEffect(asyncMemo, () => {});
      createRenderEffect(pendingMemo, v => {
        pendingValues.push(v);
      });
    });

    // Initial load
    flush();
    expect(pendingMemo!()).toBe(false); // not pending initially (no stale data)

    await new Promise(r => setTimeout(r, 0));
    expect(asyncMemo!()).toBe(10);
    expect(pendingMemo!()).toBe(false);

    // Change signal - triggers async
    setX(2);
    flush();

    // Memo should reactively show pending state
    expect(pendingMemo!()).toBe(true);
    expect(pendingValues).toContain(true);

    // After completion
    await new Promise(r => setTimeout(r, 0));
    expect(pendingMemo!()).toBe(false);
    expect(asyncMemo!()).toBe(20);
  });

  it("latest read inside reactive context (memo)", async () => {
    const [$x, setX] = createSignal(1);
    let asyncMemo: () => number;
    let pendingValueMemo: () => number;
    const pendingValues: number[] = [];

    createRoot(() => {
      asyncMemo = createMemo(async () => {
        const v = $x();
        await Promise.resolve();
        return v * 10;
      });

      // Memo that reads latest value
      pendingValueMemo = createMemo(() => latest(asyncMemo));

      createRenderEffect(asyncMemo, () => {});
      createRenderEffect(pendingValueMemo, v => {
        pendingValues.push(v);
      });
    });

    // Initial load
    flush();
    await new Promise(r => setTimeout(r, 0));
    expect(asyncMemo!()).toBe(10);
    expect(pendingValueMemo!()).toBe(10); // same as committed

    // Change signal
    setX(2);
    flush();

    // latest() should return committed value (async hasn't completed yet)
    expect(pendingValueMemo!()).toBe(10);

    // After completion
    await new Promise(r => setTimeout(r, 0));
    expect(asyncMemo!()).toBe(20);
    expect(pendingValueMemo!()).toBe(20);
  });

  it("latest on upstream signal read inside reactive context", async () => {
    const [$x, setX] = createSignal(1);
    let asyncMemo: () => number;
    let pendingXMemo: () => number;

    createRoot(() => {
      asyncMemo = createMemo(async () => {
        const v = $x();
        await Promise.resolve();
        return v * 10;
      });

      // Memo that reads latest value of upstream signal
      pendingXMemo = createMemo(() => latest($x));

      createRenderEffect(asyncMemo, () => {});
    });

    // Initial load
    flush();
    await new Promise(r => setTimeout(r, 0));
    expect($x()).toBe(1);
    expect(pendingXMemo!()).toBe(1);

    // Change signal - starts transition
    setX(2);
    flush();

    // latest($x) should return in-flight value
    expect($x()).toBe(1); // committed (held)
    expect(pendingXMemo!()).toBe(2); // in-flight

    // After completion
    await new Promise(r => setTimeout(r, 0));
    expect($x()).toBe(2);
    expect(pendingXMemo!()).toBe(2);
  });
});

describe("isPending and latest with async upstream and downstream", () => {
  afterEach(() => flush());

  // Diagnostic: latest(x) alone in a render effect - same setup as Test 1
  it("diagnostic: latest(signal) alone in render effect returns in-flight value", async () => {
    const [$x, setX] = createSignal(1);
    let asyncMemo: () => number;
    const pendingValues: number[] = [];

    createRoot(() => {
      asyncMemo = createMemo(() => Promise.resolve($x() * 10));
      createRenderEffect(asyncMemo, () => {});
      createRenderEffect(
        () => latest($x),
        v => {
          pendingValues.push(v);
        }
      );
    });

    // Initial load
    await new Promise(r => setTimeout(r, 0));
    expect(pendingValues.at(-1)).toBe(1);

    // Change signal - starts transition
    setX(2);
    flush();

    // latest(signal) should return the in-flight value (2)
    expect(pendingValues.at(-1)).toBe(2);

    // After async resolves and transition commits
    await new Promise(r => setTimeout(r, 0));
    expect(pendingValues.at(-1)).toBe(2);
  });

  // Diagnostic: latest(x) + isPending(() => latest(x)) in same render effect
  it("diagnostic: latest(x) combined with isPending(() => latest(x)) in same effect", async () => {
    const [$x, setX] = createSignal(1);
    let asyncMemo: () => number;
    const pairs: [boolean, number][] = [];
    const pendOnly: number[] = [];
    const ipOnly: boolean[] = [];

    createRoot(() => {
      asyncMemo = createMemo(() => Promise.resolve($x() * 10));
      createRenderEffect(asyncMemo, () => {});
      // Effect A: combined
      createRenderEffect(
        () => [isPending(() => latest($x)), latest($x)] as [boolean, number],
        ([ip, val]) => {
          pairs.push([ip, val]);
        }
      );
      // Effect B: latest only (same setup)
      createRenderEffect(
        () => latest($x),
        v => {
          pendOnly.push(v);
        }
      );
      // Effect C: isPending only (same setup)
      createRenderEffect(
        () => isPending(() => latest($x)),
        v => {
          ipOnly.push(v);
        }
      );
    });

    // Initial load
    await new Promise(r => setTimeout(r, 0));
    expect(pairs.at(-1)).toEqual([false, 1]);
    expect(pendOnly.at(-1)).toBe(1);
    expect(ipOnly.at(-1)).toBe(false);

    // Change signal - starts transition
    setX(2);
    flush();

    // latest(signal) should return 2 in all contexts
    expect(pendOnly.at(-1)).toBe(2);
    expect(pairs.at(-1)?.[1]).toBe(2);
  });

  // Test 1: latest(signal) with sync consumer - no phase 1
  it("latest(signal) with sync consumer - isPending(() => latest(x)) is false, contrasts with isPending(x)", async () => {
    const [$x, setX] = createSignal(1);
    let asyncMemo: () => number;
    const pendingPairs: [boolean, number][] = [];
    const isPendingSignal: boolean[] = [];

    createRoot(() => {
      asyncMemo = createMemo(() => Promise.resolve($x() * 10));
      createRenderEffect(asyncMemo, () => {});
      createRenderEffect(
        () => [isPending(() => latest($x)), latest($x)] as [boolean, number],
        ([ip, val]) => {
          pendingPairs.push([ip, val]);
        }
      );
      createRenderEffect(
        () => isPending($x),
        v => {
          isPendingSignal.push(v);
        }
      );
    });

    // Initial load
    await new Promise(r => setTimeout(r, 0));
    expect(isPendingSignal.at(-1)).toBe(false);
    expect(pendingPairs.at(-1)).toEqual([false, 1]);

    // Change signal - starts transition
    setX(2);
    flush();

    // isPending(signal) goes true (held in transition)
    expect(isPendingSignal.at(-1)).toBe(true);
    // But isPending(() => latest(signal)) stays false - no phase 1,
    // override present immediately, override lane has no downstream async.
    // latest(signal) returns the in-flight value (2).
    expect(pendingPairs.at(-1)).toEqual([false, 2]);

    // After async resolves and transition commits
    await new Promise(r => setTimeout(r, 0));
    expect(isPendingSignal.at(-1)).toBe(false);
    expect(pendingPairs.at(-1)).toEqual([false, 2]);
    expect($x()).toBe(2);
  });

  // Test 2: latest(signal) consumed by async memo - override lane has downstream async
  // When isPending(() => latest(x)) and latest(x) are in the SAME effect, the effect
  // subscribes to both pendingSignal and pendingComputed, causing lane merging. The merged
  // lane has pending async from the downstream consumer, so the effect is held until that
  // async resolves. To observe isPending independently, use a SEPARATE effect.
  it("latest(signal) consumed by async memo - isPending(() => latest(x)) true until downstream async resolves", async () => {
    const [$id, setId] = createSignal(1);
    let mainAsync: () => number;
    let details: () => string;
    let resolveMain: (() => void) | null = null;
    let resolveDetails: (() => void) | null = null;
    let detailsInput = 0;
    const pendingPairs: [boolean, number][] = [];
    const detailPairs: [boolean, string][] = [];
    // Separate isPending effect (independent lane, not merged with latest's lane)
    const isPendingValues: boolean[] = [];
    // Separate latest effect
    const pendingValues: number[] = [];

    createRoot(() => {
      // Main async that creates the transition
      mainAsync = createMemo(() => {
        const v = $id();
        return new Promise<number>(res => {
          resolveMain = () => res(v * 10);
        });
      });
      // Async memo that consumes latest($id) - fetching details for the pending ID
      details = createMemo(() => {
        const id = latest($id);
        detailsInput = id;
        return new Promise<string>(res => {
          resolveDetails = () => res("details-" + detailsInput);
        });
      });

      createRenderEffect(mainAsync, () => {});
      createRenderEffect(details, () => {});

      // Combined effect: held by lane merging when downstream has async
      createRenderEffect(
        () => [isPending(() => latest($id)), latest($id)] as [boolean, number],
        ([ip, val]) => {
          pendingPairs.push([ip, val]);
        }
      );
      // Separate isPending effect: its own lane, no pending async, fires immediately
      createRenderEffect(
        () => isPending(() => latest($id)),
        ip => {
          isPendingValues.push(ip);
        }
      );
      // Separate latest effect: in pendingComputed's lane (which has details' async)
      createRenderEffect(
        () => latest($id),
        val => {
          pendingValues.push(val);
        }
      );
      createRenderEffect(
        () => [isPending(details), details()] as [boolean, string],
        ([ip, val]) => {
          detailPairs.push([ip, val]);
        }
      );
    });

    flush();
    // Resolve initial loads
    resolveMain!();
    await Promise.resolve();
    flush();
    resolveDetails!();
    await Promise.resolve();
    flush();

    expect(pendingPairs.at(-1)).toEqual([false, 1]);
    expect(isPendingValues.at(-1)).toBe(false);
    expect(pendingValues.at(-1)).toBe(1);
    expect(detailPairs.at(-1)).toEqual([false, "details-1"]);

    // Change signal - starts transition
    setId(2);
    flush();

    // The separate isPending effect observes true immediately (its lane has no async)
    expect(isPendingValues.at(-1)).toBe(true);

    // The combined effect is held (lane merged with pendingComputed's lane which has async)
    // So it still shows the previous value
    expect(pendingPairs.at(-1)).toEqual([true, 1]);

    // Resolve details (the async consuming latest($id))
    resolveDetails!();
    await Promise.resolve();
    flush();

    // Now the merged lane is ready - combined effect fires with resolved state
    expect(pendingPairs.at(-1)).toEqual([false, 2]);
    // Separate isPending effect also updates (no more async in the override lane)
    expect(isPendingValues.at(-1)).toBe(false);

    // Resolve main async to complete transition
    resolveMain!();
    await Promise.resolve();
    flush();
    expect(pendingPairs.at(-1)).toEqual([false, 2]);
    expect($id()).toBe(2);
  });

  // Test 3: Single async - [isPending(x), x()] pairs update atomically
  it("single async - [isPending(x), x()] pairs update atomically", async () => {
    const [$x, setX] = createSignal(1);
    let asyncMemo: () => number;
    let resolveAsync: (() => void) | null = null;
    const pairs: [boolean, number][] = [];

    createRoot(() => {
      asyncMemo = createMemo(() => {
        const v = $x();
        return new Promise<number>(res => {
          resolveAsync = () => res(v * 10);
        });
      });
      createRenderEffect(
        () => [isPending(asyncMemo), asyncMemo()] as [boolean, number],
        ([ip, val]) => {
          pairs.push([ip, val]);
        }
      );
    });

    flush();
    // Initial load
    resolveAsync!();
    await Promise.resolve();
    flush();
    expect(pairs.at(-1)).toEqual([false, 10]);

    // Change signal - async in flight
    setX(2);
    flush();
    // Pending true with stale value
    expect(pairs.at(-1)).toEqual([true, 10]);

    // Resolve async
    resolveAsync!();
    await Promise.resolve();
    flush();
    // Pending false with new value - atomic update
    expect(pairs.at(-1)).toEqual([false, 20]);

    // Verify no inconsistent pairs ever appeared
    for (const [ip, val] of pairs) {
      if (ip) expect(val).toBe(10);
    }
  });

  // Test 4: Single async - [isPending(() => latest(x)), latest(x)] pairs update atomically
  it("single async - [isPending(() => latest(x)), latest(x)] pairs update atomically", async () => {
    const [$x, setX] = createSignal(1);
    let asyncMemo: () => number;
    let resolveAsync: (() => void) | null = null;
    const pairs: [boolean, number][] = [];

    createRoot(() => {
      asyncMemo = createMemo(() => {
        const v = $x();
        return new Promise<number>(res => {
          resolveAsync = () => res(v * 10);
        });
      });
      createRenderEffect(asyncMemo, () => {}); // subscribe to drive transition
      createRenderEffect(
        () => [isPending(() => latest(asyncMemo)), latest(asyncMemo)] as [boolean, number],
        ([ip, val]) => {
          pairs.push([ip, val]);
        }
      );
    });

    flush();
    // Initial load
    resolveAsync!();
    await Promise.resolve();
    flush();
    expect(pairs.at(-1)).toEqual([false, 10]);

    // Change signal - async in flight
    setX(2);
    flush();
    // Phase 1: _pendingValueComputed STATUS_PENDING, latest() falls back to stale
    expect(pairs.at(-1)).toEqual([true, 10]);

    // Resolve async - setSignal gives _pendingValueComputed its override
    resolveAsync!();
    await Promise.resolve();
    flush();
    // Override present, lane has no downstream async → isPending false
    expect(pairs.at(-1)).toEqual([false, 20]);

    // Verify atomicity
    for (const [ip, val] of pairs) {
      if (ip) expect(val).toBe(10);
    }
  });

  // Test 5: Chained async - each [isPending(x), x()] pair tracks its own resolution
  it("chained async - each [isPending(x), x()] pair tracks its own resolution atomically", async () => {
    const [$x, setX] = createSignal(1);
    let asyncA: () => number;
    let asyncB: () => number;
    let resolveA: (() => void) | null = null;
    let resolveB: (() => void) | null = null;
    const pairsA: [boolean, number][] = [];
    const pairsB: [boolean, number][] = [];

    createRoot(() => {
      asyncA = createMemo(() => {
        const v = $x();
        return new Promise<number>(res => {
          resolveA = () => res(v * 10);
        });
      });
      asyncB = createMemo(() => {
        const v = asyncA();
        return new Promise<number>(res => {
          resolveB = () => res(v + 1);
        });
      });
      createRenderEffect(
        () => [isPending(asyncA), asyncA()] as [boolean, number],
        ([ip, val]) => {
          pairsA.push([ip, val]);
        }
      );
      createRenderEffect(
        () => [isPending(asyncB), asyncB()] as [boolean, number],
        ([ip, val]) => {
          pairsB.push([ip, val]);
        }
      );
    });

    flush();
    // Initial load - resolve chain
    resolveA!();
    await Promise.resolve();
    flush();
    resolveB!();
    await Promise.resolve();
    flush();
    expect(pairsA.at(-1)).toEqual([false, 10]);
    expect(pairsB.at(-1)).toEqual([false, 11]);

    // Change signal - both re-fire
    setX(2);
    flush();
    // Both pending with stale values
    expect(pairsA.at(-1)).toEqual([true, 10]);
    expect(pairsB.at(-1)).toEqual([true, 11]);

    // Resolve asyncA - isPending(asyncA) resolves internally but removing the
    // override entangles with the parent transition. No optimistic nodes in the
    // dependency chain, so the effect is deferred until the transition commits.
    resolveA!();
    await Promise.resolve();
    flush();
    expect(pairsA.at(-1)).toEqual([true, 10]); // deferred - transition still active
    expect(pairsB.at(-1)).toEqual([true, 11]);

    // Resolve asyncB - transition commits, all effects fire
    resolveB!();
    await Promise.resolve();
    flush();
    expect(pairsA.at(-1)).toEqual([false, 20]);
    expect(pairsB.at(-1)).toEqual([false, 21]);

    // Verify atomicity per node - no inconsistent pairs ever appeared
    for (const [ip, val] of pairsA) {
      if (ip) expect(val).toBe(10);
    }
    for (const [ip, val] of pairsB) {
      if (ip) expect(val).toBe(11);
    }
  });

  // Test 6: Chained async - [isPending(() => latest(x)), latest(x)] pairs
  it("chained async - [isPending(() => latest(x)), latest(x)] pairs track each node's own resolution", async () => {
    const [$x, setX] = createSignal(1);
    let asyncA: () => number;
    let asyncB: () => number;
    let resolveA: (() => void) | null = null;
    let resolveB: (() => void) | null = null;
    const pairsA: [boolean, number][] = [];
    const pairsB: [boolean, number][] = [];

    createRoot(() => {
      asyncA = createMemo(() => {
        const v = $x();
        return new Promise<number>(res => {
          resolveA = () => res(v * 10);
        });
      });
      asyncB = createMemo(() => {
        const v = asyncA();
        return new Promise<number>(res => {
          resolveB = () => res(v + 1);
        });
      });
      createRenderEffect(asyncB, () => {}); // subscribe to drive transition
      createRenderEffect(
        () => [isPending(() => latest(asyncA)), latest(asyncA)] as [boolean, number],
        ([ip, val]) => {
          pairsA.push([ip, val]);
        }
      );
      createRenderEffect(
        () => [isPending(() => latest(asyncB)), latest(asyncB)] as [boolean, number],
        ([ip, val]) => {
          pairsB.push([ip, val]);
        }
      );
    });

    flush();
    // Initial load - resolve chain
    resolveA!();
    await Promise.resolve();
    flush();
    resolveB!();
    await Promise.resolve();
    flush();
    expect(pairsA.at(-1)).toEqual([false, 10]);
    expect(pairsB.at(-1)).toEqual([false, 11]);

    // Change signal - both re-fire
    setX(2);
    flush();
    // Both _pendingValueComputeds are STATUS_PENDING
    expect(pairsA.at(-1)).toEqual([true, 10]);
    expect(pairsB.at(-1)).toEqual([true, 11]);

    // Resolve asyncA - asyncA's pair goes [false, 20]
    resolveA!();
    await Promise.resolve();
    flush();
    expect(pairsA.at(-1)).toEqual([false, 20]);
    expect(pairsB.at(-1)).toEqual([true, 11]);

    // Resolve asyncB
    resolveB!();
    await Promise.resolve();
    flush();
    expect(pairsB.at(-1)).toEqual([false, 21]);

    // Verify atomicity per node
    for (const [ip, val] of pairsA) {
      if (ip) expect(val).toBe(10);
    }
    for (const [ip, val] of pairsB) {
      if (ip) expect(val).toBe(11);
    }
  });

  // Test 7: Multiple independent async sources - one resolves first
  it("multiple independent async - [isPending(x), x()] pairs with progressive resolution", async () => {
    const [$x, setX] = createSignal(1);
    let asyncA: () => number;
    let asyncB: () => number;
    let resolveA: (() => void) | null = null;
    let resolveB: (() => void) | null = null;
    const pairsA: [boolean, number][] = [];
    const pairsB: [boolean, number][] = [];

    createRoot(() => {
      asyncA = createMemo(() => {
        const v = $x();
        return new Promise<number>(res => {
          resolveA = () => res(v * 10);
        });
      });
      asyncB = createMemo(() => {
        const v = $x();
        return new Promise<number>(res => {
          resolveB = () => res(v * 100);
        });
      });
      createRenderEffect(
        () => [isPending(asyncA), asyncA()] as [boolean, number],
        ([ip, val]) => {
          pairsA.push([ip, val]);
        }
      );
      createRenderEffect(
        () => [isPending(asyncB), asyncB()] as [boolean, number],
        ([ip, val]) => {
          pairsB.push([ip, val]);
        }
      );
    });

    flush();
    // Initial load
    resolveA!();
    await Promise.resolve();
    flush();
    resolveB!();
    await Promise.resolve();
    flush();
    expect(pairsA.at(-1)).toEqual([false, 10]);
    expect(pairsB.at(-1)).toEqual([false, 100]);

    // Change signal - both re-fire
    setX(2);
    flush();
    expect(pairsA.at(-1)).toEqual([true, 10]);
    expect(pairsB.at(-1)).toEqual([true, 100]);

    // Resolve asyncB first - isPending(asyncB) resolves internally but removing
    // the override entangles with the parent transition. No optimistic nodes in
    // the dependency chain, so the effect is deferred until the transition commits.
    resolveB!();
    await Promise.resolve();
    flush();
    expect(pairsB.at(-1)).toEqual([true, 100]); // deferred - transition still active
    expect(pairsA.at(-1)).toEqual([true, 10]);

    // Resolve asyncA - transition commits, all effects fire
    resolveA!();
    await Promise.resolve();
    flush();
    expect(pairsA.at(-1)).toEqual([false, 20]);
    expect(pairsB.at(-1)).toEqual([false, 200]);

    // Verify atomicity per node - no inconsistent pairs ever appeared
    for (const [ip, val] of pairsA) {
      if (ip) expect(val).toBe(10);
    }
    for (const [ip, val] of pairsB) {
      if (ip) expect(val).toBe(100);
    }
  });

  // Test 8: Multiple independent async sources - isPending(() => latest(x)) pairs
  it("multiple independent async - [isPending(() => latest(x)), latest(x)] pairs with progressive resolution", async () => {
    const [$x, setX] = createSignal(1);
    let asyncA: () => number;
    let asyncB: () => number;
    let asyncC: () => number;
    let resolveA: (() => void) | null = null;
    let resolveB: (() => void) | null = null;
    let resolveC: (() => void) | null = null;
    const pairsA: [boolean, number][] = [];
    const pairsB: [boolean, number][] = [];
    const pairsC: [boolean, number][] = [];

    createRoot(() => {
      asyncA = createMemo(() => {
        const v = $x();
        return new Promise<number>(res => {
          resolveA = () => res(v * 10);
        });
      });
      asyncB = createMemo(() => {
        const v = $x();
        return new Promise<number>(res => {
          resolveB = () => res(v * 100);
        });
      });
      asyncC = createMemo(() => {
        const v = $x();
        return new Promise<number>(res => {
          resolveC = () => res(v * 1000);
        });
      });
      createRenderEffect(asyncA, () => {});
      createRenderEffect(asyncB, () => {});
      createRenderEffect(asyncC, () => {});
      createRenderEffect(
        () => [isPending(() => latest(asyncA)), latest(asyncA)] as [boolean, number],
        ([ip, val]) => {
          pairsA.push([ip, val]);
        }
      );
      createRenderEffect(
        () => [isPending(() => latest(asyncB)), latest(asyncB)] as [boolean, number],
        ([ip, val]) => {
          pairsB.push([ip, val]);
        }
      );
      createRenderEffect(
        () => [isPending(() => latest(asyncC)), latest(asyncC)] as [boolean, number],
        ([ip, val]) => {
          pairsC.push([ip, val]);
        }
      );
    });

    flush();
    // Initial load
    resolveA!();
    await Promise.resolve();
    flush();
    resolveB!();
    await Promise.resolve();
    flush();
    resolveC!();
    await Promise.resolve();
    flush();
    expect(pairsA.at(-1)).toEqual([false, 10]);
    expect(pairsB.at(-1)).toEqual([false, 100]);
    expect(pairsC.at(-1)).toEqual([false, 1000]);

    // Change signal - all three re-fire
    setX(2);
    flush();
    expect(pairsA.at(-1)).toEqual([true, 10]);
    expect(pairsB.at(-1)).toEqual([true, 100]);
    expect(pairsC.at(-1)).toEqual([true, 1000]);

    // Resolve asyncC first
    resolveC!();
    await Promise.resolve();
    flush();
    expect(pairsC.at(-1)).toEqual([false, 2000]);
    expect(pairsA.at(-1)).toEqual([true, 10]);
    expect(pairsB.at(-1)).toEqual([true, 100]);

    // Resolve asyncA
    resolveA!();
    await Promise.resolve();
    flush();
    expect(pairsA.at(-1)).toEqual([false, 20]);
    expect(pairsB.at(-1)).toEqual([true, 100]);

    // Resolve asyncB - all resolved, transition complete
    resolveB!();
    await Promise.resolve();
    flush();
    expect(pairsB.at(-1)).toEqual([false, 200]);

    // Verify atomicity per node
    for (const [ip, val] of pairsA) {
      if (ip) expect(val).toBe(10);
    }
    for (const [ip, val] of pairsB) {
      if (ip) expect(val).toBe(100);
    }
    for (const [ip, val] of pairsC) {
      if (ip) expect(val).toBe(1000);
    }
  });
});

it("should compute lazy memo when first read inside another computation", () => {
  const [$x, setX] = createSignal(0);
  let innerRuns = 0;

  createRoot(() => {
    const lazy = createMemo(
      () => {
        innerRuns++;
        return $x() + 1;
      },
      undefined,
      { lazy: true }
    );

    expect(innerRuns).toBe(0);

    const outer = createMemo(() => lazy() * 2);

    expect(innerRuns).toBe(1);
    expect(outer()).toBe(2);

    setX(5);
    flush();
    expect(innerRuns).toBe(2);
    expect(outer()).toBe(12);
  });
});

it("should compute nested lazy memos when first read inside another computation", () => {
  const [$x, setX] = createSignal(0);

  createRoot(() => {
    const lazyOuter = createMemo(() => $x() + 1, undefined, { lazy: true });
    const lazyInner = createMemo(() => lazyOuter() * 10, undefined, { lazy: true });

    const eager = createMemo(() => lazyInner() + 100);

    expect(eager()).toBe(110);

    setX(5);
    flush();
    expect(eager()).toBe(160);
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
