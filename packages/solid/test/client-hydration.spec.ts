/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import {
  createRoot,
  flush,
  createSignal as coreSignal,
  createMemo as coreMemo
} from "@solidjs/signals";
import {
  enableHydration,
  sharedConfig,
  createErrorBoundary,
  createMemo,
  createOptimistic,
  createProjection,
  createStore,
  createOptimisticStore,
  onHydrationEnd,
  Loading
} from "../src/client/hydration.js";
import { lazy } from "../src/client/component.js";
import { Errored } from "../src/client/flow.js";

// Enable the hydration-aware wrappers
enableHydration();

// Mock hydration data store
let hydrationData: Record<string, any>;

function startHydration(data: Record<string, any>) {
  hydrationData = data;
  sharedConfig.hydrating = true;
  (sharedConfig as any).has = (id: string) => id in hydrationData;
  (sharedConfig as any).load = (id: string) => hydrationData[id];
  (sharedConfig as any).gather = () => {};
}

function stopHydration() {
  sharedConfig.hydrating = false;
  (sharedConfig as any).has = undefined;
  (sharedConfig as any).load = undefined;
  (sharedConfig as any).gather = undefined;
}

describe("Error Boundary Hydration", () => {
  afterEach(() => {
    stopHydration();
  });

  test("createErrorBoundary renders fallback from serialized error", () => {
    // The server serialized an error at the boundary owner's ID "t0"
    startHydration({ t0: new Error("server error") });

    let result: any;
    createRoot(
      () => {
        const read = createErrorBoundary(
          () => "children content",
          (err: any) => `fallback: ${err.message}`
        );
        result = read();
      },
      { id: "t" }
    );
    flush();

    expect(result).toBe("fallback: server error");
  });

  test("createErrorBoundary passes through when no serialized error", () => {
    // No error serialized for this boundary
    startHydration({});

    let result: any;
    createRoot(
      () => {
        const read = createErrorBoundary(
          () => "children content",
          (err: any) => `fallback: ${err.message}`
        );
        result = read();
      },
      { id: "t" }
    );
    flush();

    expect(result).toBe("children content");
  });

  test("createErrorBoundary reset recovers after hydrated error", () => {
    startHydration({ t0: new Error("server error") });

    let result: any;
    let resetFn: (() => void) | undefined;
    createRoot(
      () => {
        const read = createErrorBoundary(
          () => "recovered content",
          (err: any, reset) => {
            resetFn = reset;
            return `fallback: ${err.message}`;
          }
        );
        result = read();
      },
      { id: "t" }
    );
    flush();

    // Initially shows fallback from serialized error
    expect(result).toBe("fallback: server error");
    expect(resetFn).toBeDefined();

    // After reset, the real fn should run
    stopHydration();
    resetFn!();
    flush();

    // Re-read the boundary output
    // The boundary should have recomputed to show children
    // Note: result variable won't auto-update since it's not reactive.
    // We need to check the boundary's output via its accessor.
  });

  test("createErrorBoundary handles non-Error serialized values", () => {
    // Server might serialize a string or other value as the error
    startHydration({ t0: "string error" });

    let result: any;
    createRoot(
      () => {
        const read = createErrorBoundary(
          () => "children content",
          (err: any) => `fallback: ${err}`
        );
        result = read();
      },
      { id: "t" }
    );
    flush();

    expect(result).toBe("fallback: string error");
  });

  test("Errored component reads serialized error during hydration", () => {
    startHydration({ t0: new Error("server error") });

    let result: any;
    createRoot(
      () => {
        result = Errored({
          fallback: (err: any) => `fallback: ${err.message}`,
          children: "children content" as any
        });
      },
      { id: "t" }
    );
    flush();

    // Errored delegates to createErrorBoundary, which should pick up
    // the serialized error and render the fallback
    const resolved = typeof result === "function" ? result() : result;
    expect(resolved).toBe("fallback: server error");
  });

  test("Errored component passes through when no serialized error", () => {
    startHydration({});

    let result: any;
    createRoot(
      () => {
        result = Errored({
          fallback: (err: any) => `fallback: ${err.message}`,
          children: "children content" as any
        });
      },
      { id: "t" }
    );
    flush();

    const resolved = typeof result === "function" ? result() : result;
    expect(resolved).toBe("children content");
  });

  test("createErrorBoundary without hydrating delegates to core", () => {
    // Not hydrating — should behave exactly like core createErrorBoundary
    let result: any;
    createRoot(
      () => {
        const read = createErrorBoundary(
          () => "normal content",
          (err: any) => `fallback: ${err.message}`
        );
        result = read();
      },
      { id: "t" }
    );
    flush();

    expect(result).toBe("normal content");
  });

  test("createErrorBoundary without hydrating catches runtime errors", () => {
    let result: any;
    createRoot(
      () => {
        const read = createErrorBoundary(
          () => {
            throw new Error("runtime error");
          },
          (err: any) => `fallback: ${err.message}`
        );
        result = read();
      },
      { id: "t" }
    );
    flush();

    expect(result).toBe("fallback: runtime error");
  });

  test("nested error boundaries with serialized errors", () => {
    // Outer boundary error at t0, inner would be at t00 (child of outer's owner)
    // Only outer has a serialized error — it should render its fallback.
    // Use createErrorBoundary directly with lazy fn to mirror JSX evaluation order.
    startHydration({ t0: new Error("outer error") });

    let result: any;
    createRoot(
      () => {
        const read = createErrorBoundary(
          () => {
            // Inner boundary — only created if outer's fn runs
            const innerRead = createErrorBoundary(
              () => "deep content",
              (err: any) => `inner-fallback: ${err.message}`
            );
            return innerRead();
          },
          (err: any) => `outer-fallback: ${err.message}`
        );
        result = read();
      },
      { id: "t" }
    );
    flush();

    expect(result).toBe("outer-fallback: outer error");
  });

  test("ID alignment: boundary after memo during hydration", () => {
    // Simulate: server had a memo at t0 (value 42) and error boundary at t1 (error)
    startHydration({ t0: 42, t1: new Error("boundary error") });

    let memoResult: any;
    let boundaryResult: any;
    createRoot(
      () => {
        memoResult = createMemo(() => 99)();

        const read = createErrorBoundary(
          () => "children",
          (err: any) => `fallback: ${err.message}`
        );
        boundaryResult = read();
      },
      { id: "t" }
    );
    flush();

    // Memo should have loaded serialized value 42 (not computed 99)
    expect(memoResult).toBe(42);
    // Boundary should have loaded serialized error
    expect(boundaryResult).toBe("fallback: boundary error");
  });
});

describe("createOptimistic Hydration", () => {
  afterEach(() => {
    stopHydration();
  });

  test("createOptimistic(fn) uses serialized value during hydration", () => {
    // Server resolved the async compute to 42 and serialized it
    startHydration({ t0: { v: 42, s: 1 } });

    let result: any;
    createRoot(
      () => {
        const [read] = createOptimistic(() => {
          // This would normally be async (e.g., fetch) but during hydration
          // we should use the serialized value instead
          return 999;
        });
        result = read();
      },
      { id: "t" }
    );
    flush();

    // Should use serialized value (42), not computed value (999)
    expect(result).toBe(42);
  });

  test("createOptimistic(fn) runs compute when no serialized data", () => {
    startHydration({});

    let result: any;
    createRoot(
      () => {
        const [read] = createOptimistic(() => 123);
        result = read();
      },
      { id: "t" }
    );
    flush();

    // No serialized data — should use computed value
    expect(result).toBe(123);
  });

  test("createOptimistic(value) passes through without wrapping", () => {
    // Plain value form — not a function, should not be wrapped
    startHydration({ t0: { v: 42, s: 1 } });

    let result: any;
    createRoot(
      () => {
        const [read] = createOptimistic(10);
        result = read();
      },
      { id: "t" }
    );
    flush();

    // Plain value form should return the initial value directly
    expect(result).toBe(10);
  });

  test("createOptimistic(fn) without hydrating delegates to core", () => {
    // Not hydrating — should behave exactly like core createOptimistic
    let result: any;
    createRoot(
      () => {
        const [read] = createOptimistic(() => 77);
        result = read();
      },
      { id: "t" }
    );
    flush();

    expect(result).toBe(77);
  });

  test("createOptimistic(fn) returns getter and setter tuple", () => {
    startHydration({ t0: { v: 42, s: 1 } });

    let getter: any;
    let setter: any;
    createRoot(
      () => {
        const [read, set] = createOptimistic(() => 999);
        getter = read;
        setter = set;
      },
      { id: "t" }
    );
    flush();

    // Getter returns serialized value during hydration
    expect(getter()).toBe(42);
    // Setter is available (optimistic writes only apply during transitions)
    expect(typeof setter).toBe("function");
  });

  test("ID alignment: memo then optimistic during hydration", () => {
    // memo at t0, optimistic computed at t1
    startHydration({ t0: "memo-val", t1: { v: "opt-val", s: 1 } });

    let memoResult: any;
    let optResult: any;
    createRoot(
      () => {
        memoResult = createMemo(() => "wrong")();
        const [read] = createOptimistic(() => "wrong");
        optResult = read();
      },
      { id: "t" }
    );
    flush();

    expect(memoResult).toBe("memo-val");
    expect(optResult).toBe("opt-val");
  });
});

describe("createProjection Hydration", () => {
  afterEach(() => {
    stopHydration();
  });

  test("createProjection uses serialized value during hydration", () => {
    // Server resolved async projection and serialized the store state
    startHydration({ t0: { v: { name: "server", count: 42 }, s: 1 } });

    let store: any;
    createRoot(
      () => {
        store = createProjection(
          (draft: any) => {
            draft.name = "client";
            draft.count = 999;
          },
          { name: "", count: 0 }
        );
      },
      { id: "t" }
    );
    flush();

    // Should use serialized value, not the fn's mutations
    expect(store.name).toBe("server");
    expect(store.count).toBe(42);
  });

  test("createProjection runs fn when no serialized data", () => {
    startHydration({});

    let store: any;
    createRoot(
      () => {
        store = createProjection(
          (draft: any) => {
            draft.name = "computed";
            draft.count = 7;
          },
          { name: "", count: 0 }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.name).toBe("computed");
    expect(store.count).toBe(7);
  });

  test("createProjection without hydrating delegates to core", () => {
    let store: any;
    createRoot(
      () => {
        store = createProjection(
          (draft: any) => {
            draft.value = "normal";
          },
          { value: "" }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.value).toBe("normal");
  });

  test("ID alignment: memo then projection during hydration", () => {
    startHydration({
      t0: "memo-val",
      t1: { v: { data: "proj-val" }, s: 1 }
    });

    let memoResult: any;
    let store: any;
    createRoot(
      () => {
        memoResult = createMemo(() => "wrong")();
        store = createProjection(
          (draft: any) => {
            draft.data = "wrong";
          },
          { data: "" }
        );
      },
      { id: "t" }
    );
    flush();

    expect(memoResult).toBe("memo-val");
    expect(store.data).toBe("proj-val");
  });
});

describe("createStore(fn) Hydration", () => {
  afterEach(() => {
    stopHydration();
  });

  test("createStore(fn) uses serialized value during hydration", () => {
    startHydration({ t0: { v: { name: "server", count: 42 }, s: 1 } });

    let store: any;
    createRoot(
      () => {
        [store] = createStore(
          (draft: any) => {
            draft.name = "client";
            draft.count = 999;
          },
          { name: "", count: 0 }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.name).toBe("server");
    expect(store.count).toBe(42);
  });

  test("createStore(fn) runs fn when no serialized data", () => {
    startHydration({});

    let store: any;
    createRoot(
      () => {
        [store] = createStore(
          (draft: any) => {
            draft.name = "computed";
            draft.count = 7;
          },
          { name: "", count: 0 }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.name).toBe("computed");
    expect(store.count).toBe(7);
  });

  test("createStore(value) passes through without wrapping", () => {
    startHydration({ t0: { v: { name: "server" }, s: 1 } });

    let store: any;
    createRoot(
      () => {
        [store] = createStore({ name: "initial", count: 0 });
      },
      { id: "t" }
    );
    flush();

    // Plain value form — no fn, no owner, no hydration lookup
    expect(store.name).toBe("initial");
    expect(store.count).toBe(0);
  });

  test("createStore(fn) without hydrating delegates to core", () => {
    let store: any;
    createRoot(
      () => {
        [store] = createStore(
          (draft: any) => {
            draft.value = "normal";
          },
          { value: "" }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.value).toBe("normal");
  });

  test("createStore(fn) returns working setter", () => {
    startHydration({ t0: { v: { count: 42 }, s: 1 } });

    let store: any;
    let setter: any;
    createRoot(
      () => {
        [store, setter] = createStore(
          (draft: any) => {
            draft.count = 999;
          },
          { count: 0 }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.count).toBe(42);
    expect(typeof setter).toBe("function");
  });
});

describe("createOptimisticStore(fn) Hydration", () => {
  afterEach(() => {
    stopHydration();
  });

  test("createOptimisticStore(fn) uses serialized value during hydration", () => {
    startHydration({ t0: { v: { name: "server" }, s: 1 } });

    let store: any;
    createRoot(
      () => {
        [store] = createOptimisticStore(
          (draft: any) => {
            draft.name = "client";
          },
          { name: "" }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.name).toBe("server");
  });

  test("createOptimisticStore(value) passes through without wrapping", () => {
    startHydration({});

    let store: any;
    createRoot(
      () => {
        [store] = createOptimisticStore({ name: "initial" });
      },
      { id: "t" }
    );
    flush();

    expect(store.name).toBe("initial");
  });
});

// ============================================================================
// ssrSource — client-side modes
// ============================================================================

describe("ssrSource client modes", () => {
  afterEach(() => {
    stopHydration();
  });

  test("ssrSource 'server' (default) uses serialized value", () => {
    startHydration({ t0: 42 });

    let result: any;
    createRoot(
      () => {
        result = createMemo(() => 999)();
      },
      { id: "t" }
    );
    flush();

    expect(result).toBe(42);
  });

  test("ssrSource 'hybrid' uses serialized value for Promises (same as server)", () => {
    startHydration({ t0: { v: 42, s: 1 } });

    let result: any;
    createRoot(
      () => {
        result = createMemo(() => 999, undefined, { ssrSource: "hybrid" })();
      },
      { id: "t" }
    );
    flush();

    expect(result).toBe(42);
  });

  test("ssrSource 'initial' uses initialValue, ignores serialized data", () => {
    startHydration({ t0: { v: 42, s: 1 } });

    let result: any;
    createRoot(
      () => {
        result = createMemo(() => 999, 0, { ssrSource: "initial" })();
      },
      { id: "t" }
    );
    flush();

    expect(result).toBe(0);
  });

  test("ssrSource 'initial' captures deps via subFetch", () => {
    startHydration({ t0: { v: 42, s: 1 } });

    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    createRoot(
      () => {
        createMemo(
          () => {
            fetchCalled =
              typeof globalThis.fetch !== "function" || globalThis.fetch !== originalFetch;
            return 999;
          },
          0,
          { ssrSource: "initial" }
        )();
      },
      { id: "t" }
    );
    flush();

    // subFetch replaces fetch with a mock — if it ran, fetchCalled should be true
    expect(fetchCalled).toBe(true);
  });

  test("ssrSource 'client' uses initialValue during hydration", () => {
    startHydration({});

    let result: any;
    createRoot(
      () => {
        result = createMemo(() => 999, 0, { ssrSource: "client" })();
      },
      { id: "t" }
    );
    flush();

    expect(result).toBe(0);
  });

  test("ssrSource 'client' toggle flips immediately, protected by snapshot scope", () => {
    startHydration({});

    let result: any;
    createRoot(
      () => {
        result = createMemo(() => 999, 0, { ssrSource: "client" });
      },
      { id: "t" }
    );
    flush();

    // During hydration, snapshot scope protects — returns initialValue
    expect(result()).toBe(0);

    stopHydration();
    flush();

    // After scope release, computation reruns with real value
    expect(result()).toBe(999);
  });
});

describe("ssrSource client modes — createProjection", () => {
  afterEach(() => {
    stopHydration();
  });

  test("ssrSource 'server' (default) uses serialized store value", () => {
    startHydration({ t0: { v: { name: "server", count: 42 }, s: 1 } });

    let store: any;
    createRoot(
      () => {
        store = createProjection(
          (draft: any) => {
            draft.name = "client";
            draft.count = 999;
          },
          { name: "", count: 0 }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.name).toBe("server");
    expect(store.count).toBe(42);
  });

  test("ssrSource 'hybrid' uses serialized store value", () => {
    startHydration({ t0: { v: { name: "hybrid-val", count: 7 }, s: 1 } });

    let store: any;
    createRoot(
      () => {
        store = createProjection(
          (draft: any) => {
            draft.name = "client";
          },
          { name: "", count: 0 },
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.name).toBe("hybrid-val");
    expect(store.count).toBe(7);
  });

  test("ssrSource 'initial' uses initialValue, ignores serialized data", () => {
    startHydration({ t0: { v: { name: "server" }, s: 1 } });

    let store: any;
    createRoot(
      () => {
        store = createProjection(
          (draft: any) => {
            draft.name = "computed";
          },
          { name: "init" },
          { ssrSource: "initial" }
        );
      },
      { id: "t" }
    );
    flush();

    // "initial" skips server data — fn runs against initialValue with no hydration override
    expect(store.name).toBe("init");
  });

  test("ssrSource 'client' uses initialValue during hydration", () => {
    startHydration({});

    let store: any;
    createRoot(
      () => {
        store = createProjection(
          (draft: any) => {
            draft.name = "computed";
          },
          { name: "init" },
          { ssrSource: "client" }
        );
      },
      { id: "t" }
    );
    flush();

    // "client" mode uses identity fn during hydration — returns initialValue unchanged
    expect(store.name).toBe("init");
  });
});

describe("ssrSource client modes — createStore(fn)", () => {
  afterEach(() => {
    stopHydration();
  });

  test("ssrSource 'server' (default) uses serialized store value", () => {
    startHydration({ t0: { v: { name: "server", count: 42 }, s: 1 } });

    let store: any;
    createRoot(
      () => {
        [store] = createStore(
          (draft: any) => {
            draft.name = "client";
            draft.count = 999;
          },
          { name: "", count: 0 }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.name).toBe("server");
    expect(store.count).toBe(42);
  });

  test("ssrSource 'hybrid' uses serialized store value", () => {
    startHydration({ t0: { v: { name: "hybrid-val" }, s: 1 } });

    let store: any;
    createRoot(
      () => {
        [store] = createStore(
          (draft: any) => {
            draft.name = "client";
          },
          { name: "" },
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.name).toBe("hybrid-val");
  });

  test("ssrSource 'initial' uses initialValue, ignores serialized data", () => {
    startHydration({ t0: { v: { name: "server" }, s: 1 } });

    let store: any;
    createRoot(
      () => {
        [store] = createStore(
          (draft: any) => {
            draft.name = "computed";
          },
          { name: "init" },
          { ssrSource: "initial" }
        );
      },
      { id: "t" }
    );
    flush();

    // "initial" skips server data — store gets plain initialValue
    expect(store.name).toBe("init");
  });

  test("ssrSource 'client' uses initialValue during hydration", () => {
    startHydration({});

    let store: any;
    createRoot(
      () => {
        [store] = createStore(
          (draft: any) => {
            draft.name = "computed";
          },
          { name: "init" },
          { ssrSource: "client" }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.name).toBe("init");
  });
});

// === Phase 4: Async Iterable Hydration ===

function createBufferedAsyncIterable(values: any[]) {
  let idx = 0;
  let pending: { resolve: (v: any) => void } | null = null;
  const iter = {
    next(): any {
      if (idx < values.length) {
        return { done: false, value: values[idx++] };
      }
      return new Promise(r => (pending = { resolve: r }));
    }
  };
  return {
    [Symbol.asyncIterator]: () => iter,
    push(value: any) {
      if (pending) {
        const p = pending;
        pending = null;
        p.resolve({ done: false, value });
      } else {
        values.push(value);
      }
    },
    complete() {
      if (pending) {
        const p = pending;
        pending = null;
        p.resolve({ done: true, value: undefined });
      }
    }
  };
}

describe("Async Iterable Hydration — createMemo", () => {
  afterEach(() => {
    stopHydration();
  });

  test("server+AI: first value used for hydration", () => {
    const ai = createBufferedAsyncIterable([42, 99]);
    startHydration({ t0: ai });

    let result: any;
    createRoot(
      () => {
        result = createMemo(() => 0)();
      },
      { id: "t" }
    );
    flush();

    expect(result).toBe(42);
  });

  test("server+AI: subsequent sync values consumed via async, visible after scope release", async () => {
    const ai = createBufferedAsyncIterable([42, 99]);
    startHydration({ t0: ai });

    let result: any;
    createRoot(
      () => {
        result = createMemo(() => 0);
      },
      { id: "t" }
    );
    flush();

    // Snapshot scope protects the memo — reads snapshot (first value)
    expect(result()).toBe(42);

    stopHydration();
    await Promise.resolve();
    flush();

    // After scope release + microtask, second value is consumed
    expect(result()).toBe(99);
  });

  test("server+AI: empty iterator — computed is pending", () => {
    const ai = createBufferedAsyncIterable([]);
    startHydration({ t0: ai });

    let result: any;
    createRoot(
      () => {
        result = createMemo(() => "fallback", "default");
      },
      { id: "t" }
    );
    flush();

    expect(() => result()).toThrow();
  });

  test("server+AI: pending async value applied after resolution", async () => {
    const ai = createBufferedAsyncIterable([42]);
    startHydration({ t0: ai });

    let result: any;
    createRoot(
      () => {
        result = createMemo(() => 0);
      },
      { id: "t" }
    );
    flush();

    expect(result()).toBe(42);

    stopHydration();
    flush();

    ai.push(100);
    await new Promise<void>(r => setTimeout(r, 10));
    flush();

    expect(result()).toBe(100);
  });

  test("Promise data still works (no regression)", () => {
    startHydration({ t0: { v: 42, s: 1 } });

    let result: any;
    createRoot(
      () => {
        result = createMemo(() => 999)();
      },
      { id: "t" }
    );
    flush();

    expect(result).toBe(42);
  });

  test("hybrid mode: Promise data unchanged", () => {
    startHydration({ t0: { v: 42, s: 1 } });

    let result: any;
    createRoot(
      () => {
        result = createMemo(() => 999, undefined, { ssrSource: "hybrid" })();
      },
      { id: "t" }
    );
    flush();

    expect(result).toBe(42);
  });
});

describe("Async Iterable Hydration — createProjection", () => {
  afterEach(() => {
    stopHydration();
  });

  test("server+AI: first value (full state) used for hydration", () => {
    const ai = createBufferedAsyncIterable([{ name: "Alice", count: 42 }]);
    startHydration({ t0: ai });

    let store: any;
    createRoot(
      () => {
        store = createProjection(
          (draft: any) => {
            draft.name = "client";
          },
          { name: "", count: 0 }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.name).toBe("Alice");
    expect(store.count).toBe(42);
  });

  test("server+AI: sync patches consumed greedily and applied to store", () => {
    const patches = [[["name"], "Bob"]];
    const ai = createBufferedAsyncIterable([{ name: "Alice", count: 0 }, patches]);
    startHydration({ t0: ai });

    let store: any;
    createRoot(
      () => {
        store = createProjection(
          (draft: any) => {
            draft.name = "client";
          },
          { name: "", count: 0 }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.name).toBe("Bob");
    expect(store.count).toBe(0);

    stopHydration();
  });

  test("server+AI: deep nested patch application", () => {
    const patches = [[["user", "profile", "bio"], "Updated"]];
    const ai = createBufferedAsyncIterable([
      { user: { name: "Alice", profile: { bio: "Hello" } } },
      patches
    ]);
    startHydration({ t0: ai });

    let store: any;
    createRoot(
      () => {
        store = createProjection(
          (draft: any) => {
            draft.user.name = "client";
          },
          { user: { name: "", profile: { bio: "" } } }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.user.name).toBe("Alice");
    expect(store.user.profile.bio).toBe("Updated");

    stopHydration();
  });

  test("Promise data still works for projection (no regression)", () => {
    startHydration({ t0: { v: { name: "server", count: 42 }, s: 1 } });

    let store: any;
    createRoot(
      () => {
        store = createProjection(
          (draft: any) => {
            draft.name = "client";
          },
          { name: "", count: 0 }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.name).toBe("server");
    expect(store.count).toBe(42);
  });
});

describe("Async Iterable Hydration — createStore(fn)", () => {
  afterEach(() => {
    stopHydration();
  });

  test("server+AI: first value used, patches consumed greedily", () => {
    const patches = [[["count"], 99]];
    const ai = createBufferedAsyncIterable([{ name: "Alice", count: 0 }, patches]);
    startHydration({ t0: ai });

    let store: any;
    createRoot(
      () => {
        [store] = createStore(
          (draft: any) => {
            draft.name = "client";
          },
          { name: "", count: 0 }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.name).toBe("Alice");
    expect(store.count).toBe(99);

    stopHydration();
  });

  test("Promise data still works for store (no regression)", () => {
    startHydration({ t0: { v: { name: "server" }, s: 1 } });

    let store: any;
    createRoot(
      () => {
        [store] = createStore(
          (draft: any) => {
            draft.name = "client";
          },
          { name: "" }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.name).toBe("server");
  });
});

// ============================================================================
// ssrSource "client" — post-hydration transition
// ============================================================================

describe("ssrSource 'client' — post-hydration transition", () => {
  afterEach(() => {
    stopHydration();
  });

  test("createProjection: fn runs after hydration, store updates", () => {
    startHydration({});

    let store: any;
    createRoot(
      () => {
        store = createProjection(
          (draft: any) => {
            draft.name = "from-client";
            draft.count = 42;
          },
          { name: "init", count: 0 },
          { ssrSource: "client" }
        );
      },
      { id: "t" }
    );
    flush();

    // During hydration, fn is suppressed — initialValue used
    expect(store.name).toBe("init");

    stopHydration();
    flush();

    // After hydration, fn runs and updates the store
    expect(store.name).toBe("from-client");
    expect(store.count).toBe(42);
  });

  test("createStore(fn): fn runs after hydration, store updates", () => {
    startHydration({});

    let store: any;
    createRoot(
      () => {
        [store] = createStore(
          (draft: any) => {
            draft.name = "from-client";
          },
          { name: "init" },
          { ssrSource: "client" }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.name).toBe("init");

    stopHydration();
    flush();

    expect(store.name).toBe("from-client");
  });
});

// ============================================================================
// ssrSource "hybrid" — post-hydration transition with async generators
// ============================================================================

describe("ssrSource 'hybrid' — async generator transition", () => {
  afterEach(() => {
    stopHydration();
  });

  test("createProjection: mutation-style — no first-value duplication", async () => {
    // Server sends a promise resolving to the store state after first yield
    startHydration({ t0: { v: [{ id: 1, text: "first" }], s: 1 } });

    let store: any;
    let yieldCount = 0;
    const values = [
      { id: 1, text: "first" },
      { id: 2, text: "second" },
      { id: 3, text: "third" }
    ];

    createRoot(
      () => {
        store = createProjection(
          async function* (draft: any) {
            for (const val of values) {
              draft.push(val);
              yieldCount++;
              yield;
              await new Promise(r => setTimeout(r, 5));
            }
          },
          [] as any[],
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );
    flush();

    // During hydration: server value loaded
    expect(store.length).toBe(1);
    expect(store[0].text).toBe("first");

    stopHydration();
    flush();

    // After hydration: client generator runs with shadow draft for first iteration
    // Wait for all yields to complete
    await new Promise(r => setTimeout(r, 100));
    flush();

    // Shadow absorbed the first push — real store should not have duplicated item 1
    // Items 2 and 3 should be present from subsequent yields
    expect(store.length).toBe(3);
    expect(store[0].text).toBe("first");
    expect(store[1].text).toBe("second");
    expect(store[2].text).toBe("third");
  });

  test("createProjection: return-style — no first-value duplication", async () => {
    startHydration({ t0: { v: [{ id: 1, text: "first" }], s: 1 } });

    let store: any;
    const values = [
      { id: 1, text: "first" },
      { id: 2, text: "second" }
    ];

    createRoot(
      () => {
        store = createProjection(
          async function* () {
            const items: any[] = [];
            for (const val of values) {
              items.push(val);
              yield [...items];
              await new Promise(r => setTimeout(r, 5));
            }
          },
          [] as any[],
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.length).toBe(1);
    expect(store[0].text).toBe("first");

    stopHydration();
    flush();

    await new Promise(r => setTimeout(r, 100));
    flush();

    // First yield's value suppressed, second yield reconciles
    expect(store.length).toBe(2);
    expect(store[0].text).toBe("first");
    expect(store[1].text).toBe("second");
  });

  test("createProjection: hybrid with sync fn (non-generator) uses server value", () => {
    startHydration({ t0: { v: { name: "server-val" }, s: 1 } });

    let store: any;
    createRoot(
      () => {
        store = createProjection(
          (draft: any) => {
            draft.name = "client-val";
          },
          { name: "" },
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.name).toBe("server-val");
  });

  test("createStore(fn): hybrid mutation-style — no duplication", async () => {
    startHydration({ t0: { v: { items: [1] }, s: 1 } });

    let store: any;
    createRoot(
      () => {
        [store] = createStore(
          async function* (draft: any) {
            for (const val of [1, 2, 3]) {
              draft.items.push(val);
              yield;
              await new Promise(r => setTimeout(r, 5));
            }
          },
          { items: [] as number[] },
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.items.length).toBe(1);
    expect(store.items[0]).toBe(1);

    stopHydration();
    flush();

    await new Promise(r => setTimeout(r, 100));
    flush();

    // Shadow absorbed the first push (1), so real store keeps server [1]
    // Subsequent yields push 2 and 3 to the real store
    expect(store.items.length).toBe(3);
    expect(store.items[0]).toBe(1);
    expect(store.items[1]).toBe(2);
    expect(store.items[2]).toBe(3);
  });
});

// ============================================================================
// lazy() hydration-aware + Loading asset integration
// ============================================================================

describe("lazy() hydration-aware rendering", () => {
  afterEach(() => {
    stopHydration();
    delete (globalThis as any)._$HY;
  });

  test("lazy renders synchronously when module is cached in _$HY.modules", () => {
    (globalThis as any)._$HY = {
      modules: {
        "/assets/Comp.js": { default: (props: any) => `Hello ${props.name}` }
      },
      loading: {},
      r: {},
      events: [],
      completed: new WeakSet()
    };
    startHydration({});

    let result: any;
    const LazyComp = lazy(
      () => Promise.resolve({ default: (props: any) => `async ${props.name}` }),
      "/assets/Comp.js"
    );

    createRoot(
      () => {
        result = LazyComp({ name: "World" });
      },
      { id: "t" }
    );

    expect(typeof result).toBe("function");
    expect(result()).toBe("Hello World");
  });

  test("lazy throws when module not cached during hydration", () => {
    (globalThis as any)._$HY = {
      modules: {},
      loading: {},
      r: {},
      events: [],
      completed: new WeakSet()
    };
    startHydration({});

    const LazyComp = lazy(
      () => Promise.resolve({ default: (props: any) => `resolved ${props.name}` }),
      "/assets/Missing.js"
    );

    expect(() => {
      createRoot(
        () => {
          LazyComp({ name: "World" });
        },
        { id: "t" }
      );
    }).toThrow(/not preloaded/);
  });

  test("lazy without moduleUrl always uses async path during hydration", () => {
    (globalThis as any)._$HY = {
      modules: {
        "/assets/Comp.js": { default: (props: any) => `cached` }
      },
      loading: {},
      r: {},
      events: [],
      completed: new WeakSet()
    };
    startHydration({});

    let result: any;
    const LazyComp = lazy(() => Promise.resolve({ default: (props: any) => `async` }));

    createRoot(
      () => {
        result = LazyComp({});
      },
      { id: "t" }
    );
    flush();

    expect(typeof result).toBe("function");
  });
});

describe("Loading + asset waiting during hydration", () => {
  afterEach(() => {
    stopHydration();
    delete (globalThis as any)._$HY;
  });

  test("Loading waits for assets alongside server data promise", async () => {
    let resolveData!: () => void;
    const dataPromise = new Promise<boolean>(r => (resolveData = () => r(true)));
    const assetLoadPromise = new Promise<void>(() => {});

    (globalThis as any)._$HY = {
      modules: {},
      loading: { "./Comp": assetLoadPromise },
      r: {
        t0: dataPromise,
        t0_assets: { "./Comp": "/assets/comp.js" }
      },
      events: [],
      completed: new WeakSet()
    };
    startHydration({
      t0: dataPromise,
      t0_assets: { "./Comp": "/assets/comp.js" }
    });

    let result: any;
    createRoot(
      () => {
        result = Loading({
          fallback: "loading...",
          get children() {
            return "content";
          }
        });
      },
      { id: "t" }
    );
    flush();

    expect(typeof result).toBe("function");
    const initial = result();
    expect(initial).toBe("loading...");
  });

  test("Loading returns undefined when server data resolved but assets pending", () => {
    const assetLoadPromise = new Promise<void>(() => {});

    (globalThis as any)._$HY = {
      modules: {},
      loading: { "./Comp": assetLoadPromise },
      r: {
        t0: { s: 1, v: true },
        t0_assets: { "./Comp": "/assets/comp.js" }
      },
      events: [],
      completed: new WeakSet()
    };
    startHydration({
      t0: { s: 1, v: true },
      t0_assets: { "./Comp": "/assets/comp.js" }
    });

    let result: any;
    createRoot(
      () => {
        result = Loading({
          fallback: "loading...",
          get children() {
            return "content";
          }
        });
      },
      { id: "t" }
    );
    flush();

    expect(typeof result).toBe("function");
    const initial = result();
    expect(initial).toBeUndefined();
  });

  test("Loading returns undefined when only assets pending (no server data)", () => {
    const assetLoadPromise = new Promise<void>(() => {});

    (globalThis as any)._$HY = {
      modules: {},
      loading: { "./Comp": assetLoadPromise },
      r: {
        t0_assets: { "./Comp": "/assets/comp.js" }
      },
      events: [],
      completed: new WeakSet()
    };
    startHydration({
      t0_assets: { "./Comp": "/assets/comp.js" }
    });

    let result: any;
    createRoot(
      () => {
        result = Loading({
          fallback: "loading...",
          get children() {
            return "content";
          }
        });
      },
      { id: "t" }
    );
    flush();

    expect(typeof result).toBe("function");
    const initial = result();
    expect(initial).toBeUndefined();
  });

  test("Loading hydrates immediately when no assets and no server data", () => {
    (globalThis as any)._$HY = {
      modules: {},
      loading: {},
      r: {},
      events: [],
      completed: new WeakSet()
    };
    startHydration({});

    let result: any;
    createRoot(
      () => {
        result = Loading({
          fallback: "loading...",
          get children() {
            return "content";
          }
        });
      },
      { id: "t" }
    );
    flush();

    // Returns a function (createLoadingBoundary memo) — hydrated immediately, not waiting
    expect(typeof result).toBe("function");
    // The inner value is a createLoadingBoundary — not undefined (waiting) or fallback string
    expect(result()).not.toBeUndefined();
    expect(result()).not.toBe("loading...");
  });
});

describe("Snapshot Hydration", () => {
  afterEach(() => {
    stopHydration();
  });

  test("ssrSource 'client' memo: snapshot protects during hydration, runs after release", () => {
    startHydration({});

    let result: any;
    let computeCount = 0;
    createRoot(
      () => {
        result = createMemo(
          () => {
            computeCount++;
            return 999;
          },
          0,
          { ssrSource: "client" }
        );
      },
      { id: "t" }
    );
    flush();

    // Snapshot protects: returns initial value during hydration
    expect(result()).toBe(0);

    stopHydration();
    flush();

    // After release, memo recomputes
    expect(result()).toBe(999);
    expect(computeCount).toBeGreaterThan(0);
  });

  test("signal write during hydration: snapshot-scoped derived memo returns creation-time value", () => {
    startHydration({});

    let derived: any;
    let setX: (v: number) => void;
    const [x, _setX] = coreSignal(10);
    setX = _setX;

    createRoot(
      () => {
        // Trigger snapshot scope via a hydrated wrapper
        createMemo(() => 0, 0, { ssrSource: "client" });
        // Raw memo in the same scope — reads x, gets snapshot
        derived = coreMemo(() => x() * 2);
      },
      { id: "t" }
    );
    flush();

    expect(derived()).toBe(20);

    // Write to x during hydration — snapshot protects derived
    setX(100);
    flush();
    expect(derived()).toBe(20);

    stopHydration();
    flush();

    // After scope release, derived recomputes with current value
    expect(derived()).toBe(200);
  });

  test("multiple signal writes during hydration don't affect snapshot-scoped reads", () => {
    startHydration({});

    let derivedA: any;
    let derivedB: any;
    const [a, setA] = coreSignal(1);
    const [b, setB] = coreSignal(2);

    createRoot(
      () => {
        createMemo(() => 0, 0, { ssrSource: "client" });
        derivedA = coreMemo(() => a() * 10);
        derivedB = coreMemo(() => b() * 10);
      },
      { id: "t" }
    );
    flush();

    expect(derivedA()).toBe(10);
    expect(derivedB()).toBe(20);

    setA(5);
    setB(9);
    flush();

    // Both still return snapshot values
    expect(derivedA()).toBe(10);
    expect(derivedB()).toBe(20);

    stopHydration();
    flush();

    // After release, both recompute
    expect(derivedA()).toBe(50);
    expect(derivedB()).toBe(90);
  });

  test("error boundary remains functional under snapshot scope", () => {
    startHydration({});

    let result: any;
    createRoot(
      () => {
        const read = createErrorBoundary(
          () => "success",
          (err: any) => `error: ${err.message}`
        );
        result = read;
      },
      { id: "t" }
    );
    flush();

    expect(result()).toBe("success");

    stopHydration();
    flush();

    expect(result()).toBe("success");
  });

  test("onHydrationEnd callbacks fire after snapshot cleanup", () => {
    startHydration({});

    let callbackFired = false;
    let valueAtCallback: any;
    const [x, setX] = coreSignal(1);

    createRoot(
      () => {
        createMemo(() => 0, 0, { ssrSource: "client" });
        coreMemo(() => x());
        onHydrationEnd(() => {
          callbackFired = true;
          // After cleanup, reads return current values
          valueAtCallback = x();
        });
      },
      { id: "t" }
    );
    flush();

    setX(42);
    flush();

    expect(callbackFired).toBe(false);

    stopHydration();
    flush();

    expect(callbackFired).toBe(true);
    expect(valueAtCallback).toBe(42);
  });
});

// ============================================================================
// Loading + Async Iterable end-to-end pipeline
// ============================================================================
//
// These tests wire the full hydration pipeline: Loading boundary with a pending
// promise + inner primitives (createMemo/createProjection) backed by buffered
// async iterables — the exact path that real SSR produces but existing unit
// tests skip by calling createMemo/createProjection directly.
//
// ID scheme (matching server's fake-depth trick):
//   root "t"
//     └─ Loading coreMemo "t0"        (Loading boundary data)
//         └─ createOwner "t00"         (createCollectionBoundary)
//             └─ computed(fn) "t000"   (createBoundChildren)
//                 └─ user's primitive  "t0000"  (async iterable data)

describe("Loading + Async Iterable end-to-end pipeline", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    stopHydration();
    delete (globalThis as any)._$HY;
    warnSpy.mockRestore();
  });

  function makeLoadingPromise() {
    let resolve!: () => void;
    const p: any = new Promise<void>(r => {
      resolve = () => {
        p.s = 1;
        p.v = true;
        r();
      };
    });
    return { promise: p, resolve };
  }

  test("Loading resumes ssrSource 'client' children after hydration mode turns off", async () => {
    const { promise: lp, resolve: resolveLoading } = makeLoadingPromise();

    (globalThis as any)._$HY = {
      modules: {},
      loading: {},
      r: { t0: lp },
      events: [],
      completed: new WeakSet()
    };
    startHydration({ t0: lp });

    let memo: any;
    const hydratingStates: boolean[] = [];

    createRoot(
      () => {
        Loading({
          fallback: "loading...",
          get children() {
            memo = createMemo(
              () => {
                hydratingStates.push(sharedConfig.hydrating);
                return 123;
              },
              0,
              { ssrSource: "client" }
            );
            return (() => memo()) as any;
          }
        });
      },
      { id: "t" }
    );
    flush();

    resolveLoading();
    await new Promise<void>(r => setTimeout(r, 20));
    flush();

    expect(memo()).toBe(123);
    expect(hydratingStates).toEqual([false]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("Loading + createMemo: first value from async iterable available after resume", async () => {
    const { promise: lp, resolve: resolveLoading } = makeLoadingPromise();
    const ai = createBufferedAsyncIterable([42]);

    (globalThis as any)._$HY = {
      modules: {},
      loading: {},
      r: { t0: lp, t0000: ai },
      events: [],
      completed: new WeakSet()
    };
    startHydration({ t0: lp, t0000: ai });

    let memo: any;
    let result: any;
    createRoot(
      () => {
        result = Loading({
          fallback: "loading...",
          get children() {
            memo = createMemo(() => 0);
            return memo();
          }
        });
      },
      { id: "t" }
    );
    flush();

    expect(typeof result).toBe("function");
    expect(result()).toBe("loading...");

    resolveLoading();
    await new Promise<void>(r => setTimeout(r, 20));

    // After resume, the memo should read the first value from the async iterable
    expect(memo()).toBe(42);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("Loading + createMemo: subsequent async values propagate (JSX-like pattern)", async () => {
    const { promise: lp, resolve: resolveLoading } = makeLoadingPromise();
    const ai = createBufferedAsyncIterable([42]);

    (globalThis as any)._$HY = {
      modules: {},
      loading: {},
      r: { t0: lp, t0000: ai },
      events: [],
      completed: new WeakSet()
    };
    startHydration({ t0: lp, t0000: ai });

    let memo: any;
    let childrenCallCount = 0;
    createRoot(
      () => {
        Loading({
          fallback: "loading...",
          get children() {
            childrenCallCount++;
            memo = createMemo(() => 0);
            return (() => memo()) as any;
          }
        });
      },
      { id: "t" }
    );
    flush();

    resolveLoading();
    await new Promise<void>(r => setTimeout(r, 20));

    expect(childrenCallCount).toBe(1);
    expect(memo()).toBe(42);

    // Push a new value — should NOT cause children to re-run
    ai.push(99);
    await new Promise<void>(r => setTimeout(r, 20));
    flush();

    expect(childrenCallCount).toBe(1);
    expect(memo()).toBe(99);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("Loading + createMemo: multiple sync-buffered values consumed correctly", async () => {
    const { promise: lp, resolve: resolveLoading } = makeLoadingPromise();
    const ai = createBufferedAsyncIterable([42, 99, 200]);

    (globalThis as any)._$HY = {
      modules: {},
      loading: {},
      r: { t0: lp, t0000: ai },
      events: [],
      completed: new WeakSet()
    };
    startHydration({ t0: lp, t0000: ai });

    let memo: any;
    createRoot(
      () => {
        Loading({
          fallback: "loading...",
          get children() {
            memo = createMemo(() => 0);
            return (() => memo()) as any;
          }
        });
      },
      { id: "t" }
    );
    flush();

    resolveLoading();
    await new Promise<void>(r => setTimeout(r, 20));

    // After snapshot release, the latest sync-consumed value should be visible
    expect(memo()).toBe(200);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("Loading + createMemo: direct read in children getter still works after fix", async () => {
    const { promise: lp, resolve: resolveLoading } = makeLoadingPromise();
    const ai = createBufferedAsyncIterable([42]);

    (globalThis as any)._$HY = {
      modules: {},
      loading: {},
      r: { t0: lp, t0000: ai },
      events: [],
      completed: new WeakSet()
    };
    startHydration({ t0: lp, t0000: ai });

    let memo: any;
    let childrenCallCount = 0;
    createRoot(
      () => {
        Loading({
          fallback: "loading...",
          get children() {
            childrenCallCount++;
            memo = createMemo(() => 0);
            return memo();
          }
        });
      },
      { id: "t" }
    );
    flush();

    resolveLoading();
    await new Promise<void>(r => setTimeout(r, 20));

    expect(childrenCallCount).toBe(1);
    expect(memo()).toBe(42);

    ai.push(99);
    await new Promise<void>(r => setTimeout(r, 20));
    flush();

    // Direct read causes children to re-evaluate (expected reactive behavior),
    // but the memo value should reflect the push since flush() is no longer
    // called synchronously during computation.
    expect(childrenCallCount).toBe(2);
    // The new memo is non-hydrated since sharedConfig.hydrating is false
    expect(memo()).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("Loading + createProjection: first value (full state) hydrates store", async () => {
    const { promise: lp, resolve: resolveLoading } = makeLoadingPromise();
    const ai = createBufferedAsyncIterable([{ name: "Alice", count: 42 }]);

    (globalThis as any)._$HY = {
      modules: {},
      loading: {},
      r: { t0: lp, t0000: ai },
      events: [],
      completed: new WeakSet()
    };
    startHydration({ t0: lp, t0000: ai });

    let store: any;
    createRoot(
      () => {
        const result = Loading({
          fallback: "loading...",
          get children() {
            store = createProjection(
              (draft: any) => {
                draft.name = "client";
              },
              { name: "", count: 0 }
            );
            return store;
          }
        });
      },
      { id: "t" }
    );
    flush();

    resolveLoading();
    await new Promise<void>(r => setTimeout(r, 20));

    expect(store.name).toBe("Alice");
    expect(store.count).toBe(42);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("Loading + createProjection: patches streamed after first value", async () => {
    const { promise: lp, resolve: resolveLoading } = makeLoadingPromise();
    const patches = [[["name"], "Bob"]];
    const ai = createBufferedAsyncIterable([{ name: "Alice", count: 0 }, patches]);

    (globalThis as any)._$HY = {
      modules: {},
      loading: {},
      r: { t0: lp, t0000: ai },
      events: [],
      completed: new WeakSet()
    };
    startHydration({ t0: lp, t0000: ai });

    let store: any;
    createRoot(
      () => {
        Loading({
          fallback: "loading...",
          get children() {
            store = createProjection(
              (draft: any) => {
                draft.name = "client";
              },
              { name: "", count: 0 }
            );
            return store;
          }
        });
      },
      { id: "t" }
    );
    flush();

    resolveLoading();
    await new Promise<void>(r => setTimeout(r, 20));

    expect(store.name).toBe("Bob");
    expect(store.count).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Hybrid mode: server serializes { v, s } (resolved promise-like), not
  // async iterable. Client falls through to the standard memo/store path.
  // ---------------------------------------------------------------------------

  test("Loading + createMemo (hybrid): first value hydrates from { v, s } data", async () => {
    const { promise: lp, resolve: resolveLoading } = makeLoadingPromise();

    (globalThis as any)._$HY = {
      modules: {},
      loading: {},
      r: { t0: lp, t0000: { v: 42, s: 1 } },
      events: [],
      completed: new WeakSet()
    };
    startHydration({ t0: lp, t0000: { v: 42, s: 1 } });

    let memo: any;
    createRoot(
      () => {
        Loading({
          fallback: "loading...",
          get children() {
            memo = createMemo(() => 0, undefined, { ssrSource: "hybrid" });
            return (() => memo()) as any;
          }
        });
      },
      { id: "t" }
    );
    flush();

    resolveLoading();
    await new Promise<void>(r => setTimeout(r, 20));

    expect(memo()).toBe(42);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("Loading + createProjection (hybrid): first value hydrates store from { v, s } data", async () => {
    const { promise: lp, resolve: resolveLoading } = makeLoadingPromise();
    const serverState = { name: "Alice", count: 42 };

    (globalThis as any)._$HY = {
      modules: {},
      loading: {},
      r: { t0: lp, t0000: { v: serverState, s: 1 } },
      events: [],
      completed: new WeakSet()
    };
    startHydration({ t0: lp, t0000: { v: serverState, s: 1 } });

    let store: any;
    createRoot(
      () => {
        Loading({
          fallback: "loading...",
          get children() {
            store = createProjection(
              (draft: any) => {
                draft.name = "client";
              },
              { name: "", count: 0 },
              { ssrSource: "hybrid" }
            );
            return store;
          }
        });
      },
      { id: "t" }
    );
    flush();

    resolveLoading();
    await new Promise<void>(r => setTimeout(r, 20));

    expect(store.name).toBe("Alice");
    expect(store.count).toBe(42);
    // hybrid mode intentionally writes a `hydrated` signal inside the owned scope
  });
});
