/** @vitest-environment node */
import { describe, expect, test, vi } from "vitest";
import {
  createRoot,
  createSignal,
  createMemo,
  createEffect,
  createRenderEffect,
  createTrackedEffect,
  createReaction,
  createStore,
  createOptimistic,
  createProjection,
  reconcile,
  deep,
  mapArray,
  repeat,
  createContext,
  useContext,
  children,
  getOwner,
  runWithOwner,
  untrack,
  flush,
  isPending,
  latest,
  isRefreshing,
  refresh,
  action,
  onSettled,
  getObserver,
  onCleanup,
  isEqual,
  flatten,
  NotReadyError
} from "../../src/server/index.js";

import {
  createErrorBoundary,
  createLoadingBoundary,
  NotReadyError as NotReadyErrorClass
} from "../../src/server/signals.js";

// === createSignal ===
describe("Server createSignal", () => {
  test("creates and reads a plain signal", () => {
    const [value] = createSignal(5);
    expect(value()).toBe(5);
  });

  test("creates signal with undefined", () => {
    const [value] = createSignal<number>();
    expect(value()).toBeUndefined();
  });

  test("sets a plain signal", () => {
    const [value, setValue] = createSignal(5);
    expect(value()).toBe(5);
    setValue(10);
    expect(value()).toBe(10);
  });

  test("sets signal with functional updater", () => {
    const [value, setValue] = createSignal(5);
    setValue(prev => prev + 1);
    expect(value()).toBe(6);
  });
});

// === createMemo ===
describe("Server createMemo", () => {
  test("creates and reads a memo", () => {
    createRoot(
      () => {
        const memo = createMemo(() => "Hello");
        expect(memo()).toBe("Hello");
      },
      { id: "test" }
    );
  });

  test("memo is eager by default", () => {
    createRoot(
      () => {
        let calls = 0;
        const memo = createMemo(() => {
          calls++;
          return 42;
        });
        // Should have already computed eagerly
        expect(calls).toBe(1);
        expect(memo()).toBe(42);
        expect(calls).toBe(1); // no recompute on read
      },
      { id: "test" }
    );
  });

  test("memo can be lazy", () => {
    createRoot(
      () => {
        let calls = 0;
        const memo = createMemo(
          () => {
            calls++;
            return 42;
          },
          { lazy: true }
        );
        expect(calls).toBe(0); // not computed yet
        expect(memo()).toBe(42);
        expect(calls).toBe(1); // computed on first read
        expect(memo()).toBe(42);
        expect(calls).toBe(1); // cached
      },
      { id: "test" }
    );
  });

  test("memo with defaulted prev", () => {
    createRoot(
      () => {
        const memo = createMemo((prev?: number) => (prev ?? 10) + 1);
        expect(memo()).toBe(11);
      },
      { id: "test" }
    );
  });

  test("memo throws NotReadyError for unresolved async", async () => {
    let resolve!: (v: string) => void;
    const p = new Promise<string>(r => (resolve = r));
    createRoot(
      () => {
        const memo = createMemo(() => p);
        expect(() => memo()).toThrow(NotReadyError);
      },
      { id: "test" }
    );
  });

  test("memo throws NotReadyError for unresolved async even with a defaulted prev", async () => {
    let resolve!: (v: string[]) => void;
    const p = new Promise<string[]>(r => (resolve = r));
    createRoot(
      () => {
        const memo = createMemo((prev = [] as string[]) => (void prev, p));
        expect(() => memo()).toThrow(NotReadyError);
      },
      { id: "test" }
    );
  });

  test("memo resolves async value", async () => {
    let resolve!: (v: string) => void;
    const p = new Promise<string>(r => (resolve = r));
    let memoFn!: () => string | undefined;
    createRoot(
      () => {
        memoFn = createMemo<string>(() => p);
      },
      { id: "test" }
    );
    resolve("done");
    await p;
    // After promise resolves, the value should be set and error cleared
    expect(memoFn()).toBe("done");
  });
});

// === createEffect ===
describe("Server createEffect", () => {
  test("runs compute but not effectFn on the server", () => {
    const compute = vi.fn(() => 1);
    const effectFn = vi.fn();
    createRoot(
      () => {
        createEffect(compute, effectFn);
      },
      { id: "test" }
    );
    expect(compute).toHaveBeenCalledTimes(1);
    expect(effectFn).not.toHaveBeenCalled();
  });

  test("ssrSource client skips both compute and effectFn", () => {
    const compute = vi.fn(() => 1);
    const effectFn = vi.fn();
    createRoot(
      () => {
        createEffect(compute, effectFn, { ssrSource: "client" });
      },
      { id: "test" }
    );
    expect(compute).not.toHaveBeenCalled();
    expect(effectFn).not.toHaveBeenCalled();
  });

  test("ssrSource server runs compute and skips effectFn", () => {
    const compute = vi.fn(() => 42);
    const effectFn = vi.fn();
    createRoot(
      () => {
        createEffect(compute, effectFn, { ssrSource: "server" });
      },
      { id: "test" }
    );
    expect(compute).toHaveBeenCalledTimes(1);
    expect(effectFn).not.toHaveBeenCalled();
  });
});

// === createRenderEffect ===
describe("Server createRenderEffect", () => {
  test("computes and runs effect once", () => {
    const compute = vi.fn(() => 42);
    const effectFn = vi.fn();
    createRoot(
      () => {
        createRenderEffect(compute, effectFn);
      },
      { id: "test" }
    );
    expect(compute).toHaveBeenCalledTimes(1);
    expect(effectFn).toHaveBeenCalledTimes(1);
    expect(effectFn).toHaveBeenCalledWith(42, undefined);
  });

  test("ssrSource client skips both compute and effectFn", () => {
    const compute = vi.fn(() => 42);
    const effectFn = vi.fn();
    createRoot(
      () => {
        createRenderEffect(compute, effectFn, { ssrSource: "client" });
      },
      { id: "test" }
    );
    expect(compute).not.toHaveBeenCalled();
    expect(effectFn).not.toHaveBeenCalled();
  });

  test("ssrSource server runs both compute and effectFn", () => {
    const compute = vi.fn(() => 42);
    const effectFn = vi.fn();
    createRoot(
      () => {
        createRenderEffect(compute, effectFn, { ssrSource: "server" });
      },
      { id: "test" }
    );
    expect(compute).toHaveBeenCalledTimes(1);
    expect(effectFn).toHaveBeenCalledTimes(1);
    expect(effectFn).toHaveBeenCalledWith(42, undefined);
  });
});

// === createTrackedEffect ===
describe("Server createTrackedEffect", () => {
  test("is a no-op", () => {
    const compute = vi.fn();
    createRoot(
      () => {
        createTrackedEffect(compute);
      },
      { id: "test" }
    );
    expect(compute).not.toHaveBeenCalled();
  });
});

// === createReaction ===
describe("Server createReaction", () => {
  test("calls tracking function once", () => {
    const effectFn = vi.fn();
    const tracking = vi.fn();
    const track = createReaction(effectFn);
    track(tracking);
    expect(tracking).toHaveBeenCalledTimes(1);
    expect(effectFn).not.toHaveBeenCalled();
  });
});

// === createStore ===
describe("Server createStore", () => {
  test("creates and reads a store", () => {
    const [state] = createStore({ count: 0, name: "test" });
    expect(state.count).toBe(0);
    expect(state.name).toBe("test");
  });

  test("sets store values via setter", () => {
    const [state, setState] = createStore({ count: 0 });
    setState(s => {
      s.count = 5;
    });
    expect(state.count).toBe(5);
  });
});

// === reconcile ===
describe("Server reconcile", () => {
  test("reconciles plain objects", () => {
    const target = { a: 1, b: 2 };
    const result = reconcile({ a: 3, c: 4 })(target);
    expect(result.a).toBe(3);
    expect((result as any).c).toBe(4);
    expect((result as any).b).toBeUndefined();
  });
});

// === deep ===
describe("Server deep", () => {
  test("is identity", () => {
    const obj = { a: 1 } as any;
    expect(deep(obj)).toBe(obj);
  });
});

// === mapArray ===
describe("Server mapArray", () => {
  test("maps array items", () => {
    createRoot(
      () => {
        const mapped = mapArray(
          () => [1, 2, 3],
          (item, index) => `${item()}-${index()}`
        );
        expect(mapped()).toEqual(["1-0", "2-1", "3-2"]);
      },
      { id: "test" }
    );
  });

  test("returns fallback for empty array", () => {
    createRoot(
      () => {
        const mapped = mapArray(
          () => [] as number[],
          (item, index) => item(),
          { fallback: () => "empty" }
        );
        expect(mapped()).toEqual(["empty"]);
      },
      { id: "test" }
    );
  });

  test("returns fallback for null/false", () => {
    createRoot(
      () => {
        const mapped = mapArray(
          () => null,
          (item, index) => item(),
          { fallback: () => "empty" }
        );
        expect(mapped()).toEqual(["empty"]);
      },
      { id: "test" }
    );
  });
});

// === repeat ===
describe("Server repeat", () => {
  test("repeats count times", () => {
    const result = repeat(
      () => 3,
      i => `item-${i}`
    );
    expect(result()).toEqual(["item-0", "item-1", "item-2"]);
  });

  test("repeats with from offset", () => {
    const result = repeat(
      () => 2,
      i => `item-${i}`,
      { from: () => 5 }
    );
    expect(result()).toEqual(["item-5", "item-6"]);
  });

  test("returns fallback for zero count", () => {
    const result = repeat(
      () => 0,
      i => i,
      { fallback: () => "none" }
    );
    expect(result()).toEqual(["none"]);
  });
});

// === createErrorBoundary ===
describe("Server createErrorBoundary", () => {
  test("returns fn result when no error", () => {
    createRoot(
      () => {
        const result = createErrorBoundary(
          () => "ok",
          (err, reset) => `error: ${err}`
        );
        expect(result()).toBe("ok");
      },
      { id: "test" }
    );
  });

  test("catches sync errors", () => {
    createRoot(
      () => {
        const result = createErrorBoundary(
          () => {
            throw new Error("boom");
          },
          (err: unknown, reset) => `caught: ${(err as Error).message}`
        );
        expect(result()).toBe("caught: boom");
      },
      { id: "test" }
    );
  });
});

// === createLoadingBoundary ===
describe("Server createLoadingBoundary", () => {
  test("returns fn result when no async", () => {
    const result = createLoadingBoundary(
      () => "content",
      () => "loading"
    );
    expect(result()).toBe("content");
  });

  test("returns fallback when NotReadyError thrown", () => {
    const result = createLoadingBoundary(
      () => {
        throw new NotReadyErrorClass(Promise.resolve());
      },
      () => "loading"
    );
    expect(result()).toBe("loading");
  });
});

// === Utilities ===
describe("Server utilities", () => {
  test("untrack is identity", () => {
    const fn = () => 42;
    expect(untrack(fn)).toBe(42);
  });

  test("flush is no-op", () => {
    expect(() => flush()).not.toThrow();
  });

  test("isPending returns false for sync", () => {
    expect(isPending(() => 42)).toBe(false);
  });

  test("latest passes through", () => {
    expect(latest(() => 42)).toBe(42);
  });

  test("isRefreshing returns false", () => {
    expect(isRefreshing()).toBe(false);
  });

  test("refresh passes through", () => {
    expect(refresh(() => 42)).toBe(42);
  });

  test("action passes through", () => {
    const fn = (x: number) => x + 1;
    expect(action(fn)).toBe(fn);
  });

  test("onSettled is no-op", () => {
    expect(() => onSettled(() => {})).not.toThrow();
  });

  test("getObserver returns null when not in computation", () => {
    expect(getObserver()).toBeNull();
  });

  test("isEqual works", () => {
    expect(isEqual(1, 1)).toBe(true);
    expect(isEqual(1, 2)).toBe(false);
  });
});

// === Context ===
describe("Server context", () => {
  test("createContext and useContext", () => {
    createRoot(
      () => {
        const Ctx = createContext("default");
        expect(useContext(Ctx)).toBe("default");
      },
      { id: "test" }
    );
  });

  test("default-less createContext throws when read outside a Provider", () => {
    createRoot(
      () => {
        const Ctx = createContext<number>();
        expect(() => useContext(Ctx)).toThrow();
      },
      { id: "test-throw" }
    );
  });
});

// === Owner / ID tree ===
describe("Server owner tree", () => {
  test("getOwner returns owner inside createRoot", () => {
    createRoot(
      () => {
        expect(getOwner()).not.toBeNull();
      },
      { id: "test" }
    );
  });

  test("getOwner returns null outside createRoot", () => {
    expect(getOwner()).toBeNull();
  });

  test("onCleanup registers without error", () => {
    createRoot(
      () => {
        expect(() => onCleanup(() => {})).not.toThrow();
      },
      { id: "test" }
    );
  });
});
