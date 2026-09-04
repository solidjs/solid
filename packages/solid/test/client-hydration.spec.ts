/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import {
  createRoot,
  flush,
  getOwner,
  isPending,
  NotReadyError,
  createSignal as coreSignal,
  createMemo as coreMemo
} from "@solidjs/signals";
import {
  enableHydration,
  sharedConfig,
  createEffect,
  createErrorBoundary,
  createMemo,
  createOptimistic,
  createProjection,
  createRenderEffect,
  createSignal,
  createStore,
  createOptimisticStore
} from "../src/client/hydration.js";
import { lazy } from "../src/client/component.js";
import { Errored, Loading } from "../src/client/flow.js";

// Enable the hydration-aware wrappers
enableHydration();

// Mock hydration data store
let hydrationData: Record<string, any>;

function loadModuleAssets(mapping: Record<string, string>): Promise<void> | undefined {
  const hy = (globalThis as any)._$HY;
  if (!hy) return;
  if (!hy.modules) hy.modules = {};
  if (!hy.loading) hy.loading = {};
  const pending: Promise<void>[] = [];
  for (const moduleUrl in mapping) {
    if (hy.modules[moduleUrl]) continue;
    const entryUrl = mapping[moduleUrl];
    if (!hy.loading[moduleUrl]) {
      hy.loading[moduleUrl] = import(/* @vite-ignore */ entryUrl).then(mod => {
        hy.modules[moduleUrl] = mod;
      });
    }
    pending.push(hy.loading[moduleUrl]);
  }
  return pending.length ? Promise.all(pending).then(() => {}) : undefined;
}

function startHydration(data: Record<string, any>) {
  hydrationData = data;
  sharedConfig.hydrating = true;
  (sharedConfig as any).has = (id: string) => id in hydrationData;
  (sharedConfig as any).load = (id: string) => hydrationData[id];
  (sharedConfig as any).gather = () => {};
  (sharedConfig as any).loadModuleAssets = loadModuleAssets;
}

function stopHydration() {
  sharedConfig.hydrating = false;
  (sharedConfig as any).has = undefined;
  (sharedConfig as any).load = undefined;
  (sharedConfig as any).gather = undefined;
  (sharedConfig as any).cleanupFragment = undefined;
  (sharedConfig as any).loadModuleAssets = undefined;
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
          (err: any) => `fallback: ${err().message}`
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
          (err: any) => `fallback: ${err().message}`
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
    let read!: () => unknown;
    let resetFn: (() => void) | undefined;
    createRoot(
      () => {
        read = createErrorBoundary(
          () => "recovered content",
          (err: any, reset) => {
            resetFn = reset;
            return `fallback: ${err().message}`;
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
    expect(read()).toBe("recovered content");
  });

  test("createErrorBoundary handles non-Error serialized values", () => {
    // Server might serialize a string or other value as the error
    startHydration({ t0: "string error" });

    let result: any;
    createRoot(
      () => {
        const read = createErrorBoundary(
          () => "children content",
          (err: any) => `fallback: ${err()}`
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
          fallback: (err: any) => `fallback: ${err().message}`,
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
          fallback: (err: any) => `fallback: ${err().message}`,
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
          (err: any) => `fallback: ${err().message}`
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
          (err: any) => `fallback: ${err().message}`
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
              (err: any) => `inner-fallback: ${err().message}`
            );
            return innerRead();
          },
          (err: any) => `outer-fallback: ${err().message}`
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
          (err: any) => `fallback: ${err().message}`
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

  test("Errored shows async rejection fallback after Loading resolves during hydration", async () => {
    startHydration({});
    const read = (value: any): any => {
      while (typeof value === "function") value = value();
      return value;
    };

    const resolved = Promise.resolve({ title: "Test Item" });
    const rejected = Promise.reject(new Error("Item bad-item not found"));
    rejected.catch(() => {});

    let result: any;
    createRoot(
      () => {
        function Item(props: { value: Promise<{ title: string }> }) {
          const item = createMemo(() => props.value);

          return Loading({
            fallback: "Item Loading..." as any,
            get children() {
              return Errored({
                fallback: (e: any) => `ItemError: ${String(e().message || e())}`,
                get children() {
                  return item().title as any;
                }
              }) as any;
            }
          }) as any;
        }

        result = [Item({ value: resolved }), Item({ value: rejected })];
      },
      { id: "t" }
    );

    flush();
    expect(read(result[0])).toBe("Item Loading...");
    expect(read(result[1])).toBe("Item Loading...");

    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(read(result[0])).toBe("Test Item");
    expect(read(result[1])).toBe("ItemError: Item bad-item not found");
  });

  test("outer Errored catches late Loading rejection without serialized outer error", async () => {
    const rejected: any = new Promise((_, reject) => {
      queueMicrotask(() => reject(new Error("Item bad-item not found")));
    });
    rejected.catch(() => {});
    startHydration({ t000000: rejected }); // memo id for Errored → Loading → memo

    const read = (value: any): any => {
      while (typeof value === "function") value = value();
      return value;
    };

    let result: any;
    createRoot(
      () => {
        const item = createMemo(() => rejected);

        result = Errored({
          fallback: (e: any) => `ItemError: ${String(e().message || e())}`,
          get children() {
            return Loading({
              fallback: "Item Loading..." as any,
              get children() {
                return item().title as any;
              }
            }) as any;
          }
        }) as any;
      },
      { id: "t" }
    );

    flush();
    expect(read(result)).toBe("Item Loading...");

    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(hydrationData.t1).toBeUndefined();
    expect(read(result)).toBe("ItemError: Item bad-item not found");
  });

  test("Loading resumes inner Errored under server-aligned owner IDs", async () => {
    let resolveLoading!: () => void;
    const loading = new Promise<void>(r => {
      resolveLoading = r;
    });
    startHydration({ t0: loading });

    const read = (value: any): any => {
      while (typeof value === "function") value = value();
      return value;
    };

    let result: any;
    let childOwnerId: string | undefined;
    let memoOwnerId: string | undefined;
    createRoot(
      () => {
        result = Loading({
          fallback: "Item Loading..." as any,
          get children() {
            return Errored({
              fallback: () => "ItemError" as any,
              get children() {
                childOwnerId = getOwner()!.id!;
                const item = createMemo(() => {
                  memoOwnerId = getOwner()!.id!;
                  return "Test Item";
                });
                return item() as any;
              }
            }) as any;
          }
        }) as any;
      },
      { id: "t" }
    );

    flush();
    expect(read(result)).toBe("Item Loading...");

    resolveLoading();
    await new Promise<void>(r => setTimeout(r, 20));
    flush();

    expect(childOwnerId).toBe("t00000");
    expect(memoOwnerId).toBe("t000000");
    expect(read(result)).toBe("Test Item");
  });

  test("Loading inner Errored reset recovers after hydrated server error", async () => {
    let resolveLoading!: () => void;
    const loading = new Promise<void>(r => {
      resolveLoading = r;
    });
    startHydration({ t0: loading, t0000: new Error("Item bad-item not found") });

    const read = (value: any): any => {
      while (typeof value === "function") value = value();
      return value;
    };

    let result: any;
    let resetFn: (() => void) | undefined;
    let setId!: (value: string) => void;
    createRoot(
      () => {
        const [id, _setId] = coreSignal("bad-item");
        setId = _setId;

        result = Loading({
          fallback: "Item Loading..." as any,
          get children() {
            return Errored({
              fallback: (e: any, reset) => {
                resetFn = reset;
                return `ItemError: ${String(e().message || e())}` as any;
              },
              get children() {
                return (id() === "1" ? "Test Item" : "Bad Item") as any;
              }
            }) as any;
          }
        }) as any;
      },
      { id: "t" }
    );

    flush();
    expect(read(result)).toBe("Item Loading...");

    resolveLoading();
    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(read(result)).toBe("ItemError: Item bad-item not found");

    setId("1");
    resetFn!();
    flush();

    expect(read(result)).toBe("Test Item");
  });
});

describe("Nullish serialized values (#2914)", () => {
  afterEach(() => {
    stopHydration();
  });

  test("settled ref { s: 1, v: null } hydrates to null, not the ref object", () => {
    startHydration({ t0: { s: 1, v: null } });

    let result: any;
    createRoot(
      () => {
        result = createMemo(() => "client")();
      },
      { id: "t" }
    );
    flush();

    expect(result).toBeNull();
  });

  test("settled ref { s: 1, v: undefined } hydrates to undefined", () => {
    startHydration({ t0: { s: 1, v: undefined } });

    let result: any;
    createRoot(
      () => {
        result = createMemo(() => "client")();
      },
      { id: "t" }
    );
    flush();

    expect(result).toBeUndefined();
  });

  test("directly serialized null adopts the server value instead of computing", () => {
    startHydration({ t0: null });

    let result: any;
    createRoot(
      () => {
        // The compute body still runs under subFetch (fetch-replay priming),
        // but its return value must be discarded in favor of the server null.
        result = createMemo(() => "client")();
      },
      { id: "t" }
    );
    flush();

    expect(result).toBeNull();
  });

  test("directly serialized undefined adopts the server value instead of computing", () => {
    startHydration({ t0: undefined });

    let result: any;
    createRoot(
      () => {
        result = createMemo(() => "client")();
      },
      { id: "t" }
    );
    flush();

    expect(result).toBeUndefined();
  });

  test("hybrid store: settled ref with null payload hydrates to null", () => {
    startHydration({ t0: { s: 1, v: null } });

    let result: any;
    createRoot(
      () => {
        result = createMemo(() => "client", { ssrSource: "hybrid" })();
      },
      { id: "t" }
    );
    flush();

    expect(result).toBeNull();
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
        result = createMemo(() => 999, { ssrSource: "hybrid" })();
      },
      { id: "t" }
    );
    flush();

    expect(result).toBe(42);
  });

  test("ssrSource 'client' serves the declared commit #0 during hydration", () => {
    startHydration({});

    let result: any;
    createRoot(
      () => {
        // `loadingValue: undefined` is the declared commit #0 — required for
        // "client" sources (#2981); "nothing yet" must be said out loud.
        result = createMemo(() => 999, { ssrSource: "client", loadingValue: undefined })();
      },
      { id: "t" }
    );
    flush();

    expect(result).toBeUndefined();
  });

  test("ssrSource 'client' toggle flips immediately, protected by snapshot scope", () => {
    startHydration({});

    let result: any;
    createRoot(
      () => {
        result = createMemo(() => 999, { ssrSource: "client", loadingValue: undefined });
      },
      { id: "t" }
    );
    flush();

    // During hydration, snapshot scope protects — returns commit #0 (undefined)
    expect(result()).toBeUndefined();

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
          // seedLoadingValue is required for "client" sources: the seed IS
          // what the pre-compute window shows, declared as commit #0 (#2981).
          { ssrSource: "client", seedLoadingValue: true }
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
          { ssrSource: "client", seedLoadingValue: true }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.name).toBe("init");
  });
});

// Bare `ssrSource: "client"` (no declared commit #0) is the structural form:
// on the server it suspends as a final hole (the nearest <Loading> hands the
// position to the client); on the client it stays UNASKED through the
// hydration gate — uninitialized, never a committed `undefined` — and runs
// its compute as a fresh first mount once the gate flips.
describe("bare ssrSource 'client' — unasked through the gate, computes after", () => {
  afterEach(() => {
    stopHydration();
  });

  test("createMemo: uninitialized during hydration, computes after the gate flips", () => {
    startHydration({});
    let read: any;
    createRoot(
      () => {
        read = (createMemo as any)(() => 42, { ssrSource: "client" });
        // Gate still closed: the node is unasked — a read suspends rather
        // than observing a committed undefined.
        expect(() => read()).toThrow(NotReadyError);
      },
      { id: "t" }
    );
    stopHydration();
    flush();
    expect(read()).toBe(42);
  });

  test("CSR is untouched: bare client memo computes immediately", () => {
    // No startHydration: fresh client-side mount — plain memo semantics.
    let read: any;
    createRoot(
      () => {
        read = (createMemo as any)(() => 7, { ssrSource: "client" });
        expect(read()).toBe(7);
      },
      { id: "t" }
    );
  });

  test("explicit `loadingValue: undefined` remains a valid declared commit #0", () => {
    startHydration({});
    let read: any;
    createRoot(
      () => {
        read = createMemo(() => 1, { ssrSource: "client", loadingValue: undefined });
        // Declared commit #0: born committed, read serves it synchronously.
        expect(read()).toBeUndefined();
      },
      { id: "t" }
    );
  });

  test("plain value forms are unaffected", () => {
    startHydration({});
    expect(() =>
      createRoot(() => (createSignal as any)(1, { ssrSource: "client" }), { id: "t" })
    ).not.toThrow();
  });

  test("bare client store hides its seed until the client derive completes", () => {
    startHydration({});
    let store: any;
    createRoot(
      () => {
        store = (createProjection as any)(
          (draft: any) => {
            draft.name = "computed";
          },
          { name: "seed" },
          { ssrSource: "client" }
        );
        expect(() => store.name).toThrow(NotReadyError);
      },
      { id: "t" }
    );
    stopHydration();
    flush();
    expect(store.name).toBe("computed");
  });

  test("createStore(fn) keeps Loading fallback through the first client flight", async () => {
    startHydration({});
    const read = (value: any): any => {
      while (typeof value === "function") value = value();
      return value;
    };

    let store: any;
    let result: any;
    let deriveRan = 0;
    let resolveDerive!: (value: { name: string }) => void;
    createRoot(
      () => {
        [store] = createStore<{ name: string }>(
          () => {
            deriveRan++;
            return new Promise(resolve => (resolveDerive = resolve));
          },
          { name: "seed" },
          { ssrSource: "client" }
        );
        result = Loading({
          fallback: "loading" as any,
          get children() {
            return store.name;
          }
        });
      },
      { id: "t" }
    );
    flush();

    expect(deriveRan).toBe(0);
    expect(() => store.name).toThrow(NotReadyError);
    expect(read(result)).toBe("loading");

    stopHydration();
    flush();

    expect(deriveRan).toBe(1);
    expect(() => store.name).toThrow(NotReadyError);
    expect(read(result)).toBe("loading");

    resolveDerive({ name: "landed" });
    await new Promise<void>(resolve => setTimeout(resolve));
    flush();

    expect(store.name).toBe("landed");
    expect(read(result)).toBe("landed");
  });

  test("bare seedless client store initializes after hydration", async () => {
    startHydration({});
    let store: any;
    let setStore: any;
    let deriveRan = 0;
    let receivedArgs: unknown[] | undefined;
    let resolve!: (value: { name: string }) => void;
    createRoot(
      () => {
        [store, setStore] = createStore<{ name: string }>(
          (...args: unknown[]) => {
            deriveRan++;
            receivedArgs = args;
            return new Promise(r => (resolve = r));
          },
          undefined,
          { ssrSource: "client" }
        );
      },
      { id: "t" }
    );
    flush();

    expect(deriveRan).toBe(0);
    expect(() => store.name).toThrow(NotReadyError);

    stopHydration();
    flush();
    expect(deriveRan).toBe(1);
    expect(receivedArgs).toEqual([]);
    expect(() => store.name).toThrow(NotReadyError);

    resolve({ name: "computed" });
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(store.name).toBe("computed");
    setStore((draft: any) => void (draft.name = "updated"));
    expect(store.name).toBe("updated");
  });
});

// The hydration gate must not close the loading window: a sync prev-return
// from the gate would count as the node's first real answer, making the
// post-hydration compute pending-class (isPending true) — but that compute IS
// the first question. The gate returns a never-settling flight instead, so
// commit #0 serves verdict-quiet until the real first flight lands, exactly
// like a fresh CSR mount.
describe("ssrSource 'client' + loading window — verdict-quiet through hydration", () => {
  afterEach(() => {
    stopHydration();
  });

  test("memo: post-hydration first flight serves commit #0 with isPending false", async () => {
    startHydration({});

    let read: any;
    const resolvers: ((s: string) => void)[] = [];
    const [v, setV] = coreSignal(0);
    createRoot(
      () => {
        read = createMemo(
          () => {
            v();
            return new Promise<string>(r => resolvers.push(r));
          },
          { ssrSource: "client", loadingValue: "commit-0" }
        );
      },
      { id: "t" }
    );
    flush();

    // During hydration: gate holds, compute never ran, commit #0 serves.
    expect(read()).toBe("commit-0");
    expect(isPending(() => read())).toBe(false);
    expect(resolvers.length).toBe(0);

    stopHydration();
    flush();

    // First real flight in-flight: still commit #0, still verdict-quiet.
    expect(resolvers.length).toBe(1);
    expect(read()).toBe("commit-0");
    expect(isPending(() => read())).toBe(false);

    resolvers[0]("landed-1");
    await new Promise<void>(r => setTimeout(r));
    flush();
    expect(read()).toBe("landed-1");

    // The window closed with the first landing: the SECOND flight is
    // pending-class like any other refetch.
    setV(1);
    flush();
    expect(resolvers.length).toBe(2);
    expect(read()).toBe("landed-1");
    expect(isPending(() => read())).toBe(true);

    resolvers[1]("landed-2");
    await new Promise<void>(r => setTimeout(r));
    flush();
    expect(read()).toBe("landed-2");
  });

  test("store: post-hydration first derive serves the seed with isPending false", async () => {
    startHydration({});

    let store: any;
    let resolveDerive!: (s: { v: string }) => void;
    let deriveRan = 0;
    createRoot(
      () => {
        [store] = createStore<{ v: string }>(
          () => {
            deriveRan++;
            return new Promise<{ v: string }>(r => (resolveDerive = r));
          },
          { v: "seed" },
          { ssrSource: "client", seedLoadingValue: true }
        );
      },
      { id: "t" }
    );
    flush();

    // During hydration: gate holds, derive never ran, seed serves.
    expect(store.v).toBe("seed");
    expect(isPending(() => store.v)).toBe(false);
    expect(deriveRan).toBe(0);

    stopHydration();
    flush();

    // First real derive in-flight: still the seed, still verdict-quiet.
    expect(deriveRan).toBe(1);
    expect(store.v).toBe("seed");
    expect(isPending(() => store.v)).toBe(false);

    resolveDerive({ v: "landed" });
    await new Promise<void>(r => setTimeout(r));
    flush();
    expect(store.v).toBe("landed");
  });
});

// === Phase 4: Async Iterable Hydration ===

function createBufferedAsyncIterable(values: any[]) {
  let idx = 0;
  let pending: { resolve: (v: any) => void } | null = null;
  let returnCalls = 0;
  const iter = {
    next(): any {
      if (idx < values.length) {
        return { done: false, value: values[idx++] };
      }
      return new Promise(r => (pending = { resolve: r }));
    },
    return(value?: any) {
      returnCalls++;
      pending = null;
      return Promise.resolve({ done: true, value });
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
    },
    get returnCalls() {
      return returnCalls;
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
        result = createMemo((prev = "default") => (void prev, "fallback"));
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

  test("server+AI: disposal forwards iterator return for createMemo hydration", () => {
    const ai = createBufferedAsyncIterable([42]);
    startHydration({ t0: ai });

    let dispose!: () => void;
    let result: any;
    createRoot(
      disposer => {
        dispose = disposer;
        result = createMemo(() => 0);
      },
      { id: "t" }
    );
    flush();

    expect(result()).toBe(42);

    dispose();

    expect(ai.returnCalls).toBe(1);
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
        result = createMemo(() => 999, { ssrSource: "hybrid" })();
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

  test("server+AI: sync patch backlog defers past the hydration pass, then applies", async () => {
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

    // The hydration window sees exactly the first yield — the state the SSR
    // DOM shows — so claiming primitives hydrate against the right shape.
    // The buffered patch backlog is parked until hydration completes (where
    // a live stream's yields land).
    expect(store.name).toBe("Alice");
    expect(store.count).toBe(0);

    stopHydration();
    await Promise.resolve();
    flush();

    expect(store.name).toBe("Bob");
    expect(store.count).toBe(0);
  });

  test("seedless replay adopts its snapshot before applying patch batches", async () => {
    const patches = [[["name"], "Bob"]];
    const ai = createBufferedAsyncIterable([{ name: "Alice", count: 0 }, patches]);
    startHydration({ t0: ai });

    let store: any;
    let receivedArgs: unknown[] | undefined;
    let valid = true;
    let setVersion!: (value: number) => number;
    createRoot(
      () => {
        const [version, set] = coreSignal(0);
        setVersion = set;
        store = createProjection<{ name: string; count: number }>((...args: unknown[]) => {
          version();
          receivedArgs = args;
          return valid ? { name: "client", count: 1 } : (undefined as any);
        });
      },
      { id: "t" }
    );
    flush();

    expect(receivedArgs).toEqual([]);
    expect(store.name).toBe("Alice");
    expect(store.count).toBe(0);

    stopHydration();
    await Promise.resolve();
    flush();

    expect(store.name).toBe("Bob");
    expect(store.count).toBe(0);

    ai.complete();
    await Promise.resolve();
    await Promise.resolve();
    flush();

    valid = false;
    setVersion(1);
    flush();
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(() => store.name).toThrow(
      "A seedless store projection must produce a plain object value"
    );
  });

  test("server+AI: deep nested patch application", async () => {
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
    expect(store.user.profile.bio).toBe("Hello");

    stopHydration();
    await Promise.resolve();
    flush();

    expect(store.user.name).toBe("Alice");
    expect(store.user.profile.bio).toBe("Updated");
  });

  test("server+AI: disposal forwards iterator return for createProjection hydration", () => {
    const ai = createBufferedAsyncIterable([{ name: "Alice", count: 42 }]);
    startHydration({ t0: ai });

    let dispose!: () => void;
    let store: any;
    createRoot(
      disposer => {
        dispose = disposer;
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

    dispose();

    expect(ai.returnCalls).toBe(1);
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

  test("server+AI: first value used, patch backlog applies after the hydration pass", async () => {
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
    expect(store.count).toBe(0);

    stopHydration();
    await Promise.resolve();
    flush();

    expect(store.name).toBe("Alice");
    expect(store.count).toBe(99);
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

  test("server+AI: disposal forwards iterator return for createStore hydration", () => {
    const ai = createBufferedAsyncIterable([{ name: "Alice", count: 0 }]);
    startHydration({ t0: ai });

    let dispose!: () => void;
    let store: any;
    createRoot(
      disposer => {
        dispose = disposer;
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

    dispose();

    expect(ai.returnCalls).toBe(1);
  });
});

// === Buffered multi-yield replay ===
//
// Models seroval's deserialized stream iterator — the shape real streaming SSR
// payloads hydrate through: values buffered before hydration come back as bare
// synchronous results, a stream that completed before hydration ends in a
// synchronous `{ done: true }`, and pulls past completion keep returning
// `{ done: true, value: undefined }` synchronously. createBufferedAsyncIterable
// above cannot produce a synchronously-buffered completion, which is exactly
// the case these tests cover.
function createCompletableBufferedIterable(values: any[], completed = false) {
  const buffer = [...values];
  let index = 0;
  let done = completed;
  let pending: { resolve: (v: any) => void } | null = null;
  let returnCalls = 0;
  const iter = {
    next(): any {
      if (index < buffer.length) return { done: false, value: buffer[index++] };
      if (done) return { done: true, value: undefined };
      return new Promise(r => (pending = { resolve: r }));
    },
    return(value?: any) {
      returnCalls++;
      pending = null;
      done = true;
      return Promise.resolve({ done: true, value });
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
        buffer.push(value);
      }
    },
    complete() {
      done = true;
      if (pending) {
        const p = pending;
        pending = null;
        p.resolve({ done: true, value: undefined });
      }
    },
    get returnCalls() {
      return returnCalls;
    }
  };
}

describe("Async Iterable Hydration — buffered multi-yield replay", () => {
  afterEach(() => {
    stopHydration();
  });

  test("all-buffered: replay lands on the latest yield when the stream completed before hydration", async () => {
    // Stream finished before hydration began: 1, 2, 3 then done, all buffered.
    const ai = createCompletableBufferedIterable([1, 2, 3], true);
    startHydration({ t0: ai });

    let result: any;
    createRoot(
      () => {
        result = createMemo(() => 0);
      },
      { id: "t" }
    );
    flush();

    // First yield is the synchronous snapshot value the server DOM reflects.
    expect(result()).toBe(1);

    stopHydration();
    await Promise.resolve();
    flush();

    // The batched replay must land on the LATEST buffered yield — not stay on
    // the first, and not be clobbered by the stream's done result.
    expect(result()).toBe(3);
  });

  test("done result does not clobber the last buffered yield", async () => {
    // Minimal clobbering shape: one replayable yield followed directly by the
    // buffered done result — the batching loop walks straight into done.
    const ai = createCompletableBufferedIterable([1, 2], true);
    startHydration({ t0: ai });

    let result: any;
    createRoot(
      () => {
        result = createMemo(() => 0);
      },
      { id: "t" }
    );
    flush();

    expect(result()).toBe(1);

    stopHydration();
    await Promise.resolve();
    flush();

    expect(result()).toBe(2);
  });

  test("createSignal(fn): buffered replay lands on the latest yield", async () => {
    const ai = createCompletableBufferedIterable(["a", "b", "c"], true);
    startHydration({ t0: ai });

    let read: any;
    createRoot(
      () => {
        [read] = createSignal(() => "client");
      },
      { id: "t" }
    );
    flush();

    expect(read()).toBe("a");

    stopHydration();
    await Promise.resolve();
    flush();

    expect(read()).toBe("c");
  });

  test("partially-buffered: batched replay conflates to latest, live yields apply one at a time", async () => {
    // 1, 2, 3 buffered before hydration; the stream is still open.
    const ai = createCompletableBufferedIterable([1, 2, 3]);
    startHydration({ t0: ai });

    const observed: any[] = [];
    let result: any;
    createRoot(
      () => {
        result = createMemo(() => 0);
        createRenderEffect(
          () => result(),
          (v: any) => {
            observed.push(v);
          }
        );
      },
      { id: "t" }
    );
    flush();

    expect(result()).toBe(1);

    stopHydration();
    await Promise.resolve();
    flush();

    // Buffered backlog conflates to the latest yield in one visible update.
    expect(result()).toBe(3);

    // Live yields after hydration each apply individually.
    ai.push(4);
    await new Promise<void>(r => setTimeout(r, 10));
    flush();
    expect(result()).toBe(4);

    ai.push(5);
    await new Promise<void>(r => setTimeout(r, 10));
    flush();
    expect(result()).toBe(5);

    // Live completion must not clobber the final value either.
    ai.complete();
    await new Promise<void>(r => setTimeout(r, 10));
    flush();
    expect(result()).toBe(5);

    // Observers saw: snapshot, one batched replay update, then each live yield.
    expect(observed).toEqual([1, 3, 4, 5]);
  });

  test("store path equivalence: buffered replay ends on the same final state", async () => {
    // The store-shaped serialization of the same three-resolution stream:
    // full snapshot, then one patch list per subsequent resolution.
    const ai = createCompletableBufferedIterable(
      [{ value: 1 }, [[["value"], 2]], [[["value"], 3]]],
      true
    );
    startHydration({ t0: ai });

    let store: any;
    createRoot(
      () => {
        [store] = createStore(
          (draft: any) => {
            draft.value = 0;
          },
          { value: 0 }
        );
      },
      { id: "t" }
    );
    flush();

    // The synchronous hydration window sees exactly the first yield — the
    // state the SSR DOM shows; the buffered patch backlog is deferred one
    // microtask past the claim pass (live-mode sequencing).
    expect(store.value).toBe(1);

    stopHydration();
    await Promise.resolve();
    flush();

    // Store replay applies every buffered patch; the signal path above must
    // land on the same final state.
    expect(store.value).toBe(3);
  });

  test("store buffered backlog: hydration pass sees first-yield state, then ONE conflated update", async () => {
    // Array-shaped projection stream, the Repeat-over-createProjection wire
    // shape: first yield is the full snapshot (one row — what the SSR DOM
    // shows), later yields are index+length patch lists, all buffered before
    // hydration along with the stream's completion.
    const ai = createCompletableBufferedIterable(
      [
        [{ id: 1 }],
        [
          [["1"], { id: 2 }],
          [["length"], 2]
        ],
        [
          [["2"], { id: 3 }],
          [["length"], 3]
        ]
      ],
      true
    );
    startHydration({ t0: ai });

    const observed: number[] = [];
    let store: any;
    createRoot(
      () => {
        store = createProjection((_draft: any) => {}, [] as any);
        createRenderEffect(
          () => store.length,
          (v: number) => {
            observed.push(v);
          }
        );
      },
      { id: "t" }
    );
    flush();

    // During the synchronous hydration pass only the first yield is applied,
    // so a claiming primitive (Repeat reading `length`) hydrates against the
    // exact row count the server rendered. Applying the backlog here would
    // snapshot the uncommitted seed as the pre-write base and orphan every
    // server-rendered row.
    expect(store.length).toBe(1);
    expect(store[0].id).toBe(1);

    stopHydration();
    await Promise.resolve();
    flush();

    // The backlog conflates to final state in ONE visible update.
    expect(store.length).toBe(3);
    expect(store[2].id).toBe(3);
    expect(observed).toEqual([1, 3]);
  });

  test("store partially-buffered: backlog conflates once, live yields apply one at a time", async () => {
    const ai = createCompletableBufferedIterable([
      [{ id: 1 }],
      [
        [["1"], { id: 2 }],
        [["length"], 2]
      ]
    ]);
    startHydration({ t0: ai });

    const observed: number[] = [];
    let store: any;
    createRoot(
      () => {
        store = createProjection((_draft: any) => {}, [] as any);
        createRenderEffect(
          () => store.length,
          (v: number) => {
            observed.push(v);
          }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.length).toBe(1);

    stopHydration();
    await Promise.resolve();
    flush();

    // Buffered backlog: one conflated update.
    expect(store.length).toBe(2);

    // Live yields after hydration each apply individually — unchanged.
    ai.push([
      [["2"], { id: 3 }],
      [["length"], 3]
    ]);
    await new Promise<void>(r => setTimeout(r, 10));
    flush();
    expect(store.length).toBe(3);

    ai.push([
      [["3"], { id: 4 }],
      [["length"], 4]
    ]);
    await new Promise<void>(r => setTimeout(r, 10));
    flush();
    expect(store.length).toBe(4);

    ai.complete();
    await new Promise<void>(r => setTimeout(r, 10));
    flush();
    expect(store.length).toBe(4);
    expect(observed).toEqual([1, 2, 3, 4]);
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
          { ssrSource: "client", seedLoadingValue: true }
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
          { ssrSource: "client", seedLoadingValue: true }
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
// Live-branded sources — automatic post-hydration takeover (no ssrSource)
// ============================================================================

describe("live-branded sources — automatic takeover", () => {
  afterEach(() => {
    stopHydration();
  });

  const LIVE = Symbol.for("solid.LiveSource");

  // A live transport call: constructs its iterable synchronously (no wire
  // activity until pulled), branded. Each iteration is its own "connection".
  function makeLiveSource<T>(value: T, connections: { count: number }) {
    return {
      [LIVE]: true,
      [Symbol.asyncIterator]() {
        connections.count++;
        let sent = false;
        return {
          next: () => {
            if (!sent) {
              sent = true;
              return Promise.resolve({ done: false, value });
            }
            return new Promise<never>(() => {}); // standing answer: stays open
          },
          return: (v?: any) => Promise.resolve({ done: true, value: v })
        };
      }
    };
  }

  test("memo adopts the serialized value, then re-runs the live compute after hydration", async () => {
    // The server took the live source's first value and closed (auto-hybrid):
    // the payload carries a plain settled value.
    startHydration({ t0: { v: "server-current", s: 1 } });

    const connections = { count: 0 };
    let result: any;
    createRoot(
      () => {
        result = createMemo(() => makeLiveSource("live-current", connections) as any);
      },
      { id: "t" }
    );
    flush();

    // During hydration: the adopted t=0 value serves the claim walk.
    expect(result()).toBe("server-current");

    stopHydration();
    flush();
    // The takeover recompute reconnects; the stale adopted value serves
    // until the reconnect's first yield lands.
    await new Promise(r => setTimeout(r, 10));
    flush();
    expect(result()).toBe("live-current");
  });

  test("store consumers adopt the serialized value, then reconnect after hydration", async () => {
    startHydration({
      t0: { v: { value: "server-projection" }, s: 1 },
      t1: { v: { value: "server-store" }, s: 1 },
      t2: { v: { value: "server-optimistic" }, s: 1 }
    });

    const projectionConnections = { count: 0 };
    const storeConnections = { count: 0 };
    const optimisticConnections = { count: 0 };
    let projection: any;
    let store: any;
    let optimistic: any;

    createRoot(
      () => {
        projection = createProjection(
          () => makeLiveSource({ value: "live-projection" }, projectionConnections) as any,
          { value: "seed" }
        );
        [store] = createStore(
          () => makeLiveSource({ value: "live-store" }, storeConnections) as any,
          { value: "seed" }
        );
        [optimistic] = createOptimisticStore(
          () => makeLiveSource({ value: "live-optimistic" }, optimisticConnections) as any,
          { value: "seed" }
        );
      },
      { id: "t" }
    );
    flush();

    expect(projection.value).toBe("server-projection");
    expect(store.value).toBe("server-store");
    expect(optimistic.value).toBe("server-optimistic");
    // The adoption trace opens each source under mocked transport so it can
    // discover dependencies and the live brand without network activity.
    expect(projectionConnections.count).toBe(1);
    expect(storeConnections.count).toBe(1);
    expect(optimisticConnections.count).toBe(1);

    stopHydration();
    flush();
    await new Promise(r => setTimeout(r, 10));
    flush();

    expect(projection.value).toBe("live-projection");
    expect(store.value).toBe("live-store");
    expect(optimistic.value).toBe("live-optimistic");
    expect(projectionConnections.count).toBe(2);
    expect(storeConnections.count).toBe(2);
    expect(optimisticConnections.count).toBe(2);
  });

  test("unbranded computes keep adopt-and-latch semantics — no takeover", async () => {
    startHydration({ t0: { v: "server-value", s: 1 } });

    let computeRuns = 0;
    let result: any;
    createRoot(
      () => {
        result = createMemo(() => {
          computeRuns++;
          return "client-value";
        });
      },
      { id: "t" }
    );
    flush();
    expect(result()).toBe("server-value");
    const runsDuringHydration = computeRuns;

    stopHydration();
    flush();
    await new Promise(r => setTimeout(r, 10));
    flush();
    // Still the adopted value: nothing armed a post-hydration recompute.
    expect(result()).toBe("server-value");
    expect(computeRuns).toBe(runsDuringHydration);
  });
});

// ============================================================================
// Latched divergence — dependency changes during hydration commit at done
// ============================================================================

describe("latched divergence — mid-stream dependency changes commit at hydration end", () => {
  afterEach(() => {
    stopHydration();
  });

  // A latched node whose dependency changes mid-stream re-runs its compute
  // (invalidation) but must keep serving the serialized value — orphaning
  // protection. Without a takeover that recompute leaves the node CLEAN:
  // nothing ever re-runs it after hydration and the change is silently
  // lost, not deferred. The re-entry into the latch path arms the takeover
  // gate so exactly the diverged nodes recompute at hydration end.
  test("memo: a dependency write while latched re-runs the compute after done", async () => {
    startHydration({ t0: { v: "server-value", s: 1 } });

    const [dep, setDep] = createSignal("initial");
    let result: any;
    createRoot(
      () => {
        result = createMemo(() => `client-${dep()}`);
      },
      { id: "t" }
    );
    flush();
    expect(result()).toBe("server-value");

    // Divergence: a dependency changes while the node is latched. The
    // recompute is absorbed — server truth owns the document mid-stream.
    setDep("updated");
    flush();
    expect(result()).toBe("server-value");

    stopHydration();
    flush();
    await new Promise(r => setTimeout(r, 10));
    flush();
    // Deferred, not lost: the takeover re-ran the compute live.
    expect(result()).toBe("client-updated");
  });

  test("projection: same contract through the store path", async () => {
    startHydration({ t0: { v: { value: "server-value" }, s: 1 } });

    const [dep, setDep] = createSignal("initial");
    let store: any;
    createRoot(
      () => {
        store = createProjection(
          (draft: any) => {
            draft.value = `client-${dep()}`;
          },
          { value: "" }
        );
      },
      { id: "t" }
    );
    flush();
    expect(store.value).toBe("server-value");

    setDep("updated");
    flush();
    expect(store.value).toBe("server-value");

    stopHydration();
    flush();
    await new Promise(r => setTimeout(r, 10));
    flush();
    expect(store.value).toBe("client-updated");
  });

  test("no divergence, no takeover: an untouched latched node stays adopted", async () => {
    startHydration({ t0: { v: "server-value", s: 1 } });

    const [dep] = createSignal("initial");
    let computeRuns = 0;
    let result: any;
    createRoot(
      () => {
        result = createMemo(() => {
          computeRuns++;
          return `client-${dep()}`;
        });
      },
      { id: "t" }
    );
    flush();
    expect(result()).toBe("server-value");
    const runsDuringHydration = computeRuns;

    stopHydration();
    flush();
    await new Promise(r => setTimeout(r, 10));
    flush();
    expect(result()).toBe("server-value");
    expect(computeRuns).toBe(runsDuringHydration);
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

  test("createStore(fn): hybrid async iterable disposal forwards iterator return", () => {
    startHydration({ t0: { v: { count: 1 }, s: 1 } });

    let returnCalls = 0;
    let dispose!: () => void;
    let store: any;
    createRoot(
      disposer => {
        dispose = disposer;
        [store] = createStore(
          (draft: any) => {
            draft.count = 1;
            return {
              [Symbol.asyncIterator]() {
                let step = 0;
                return {
                  next() {
                    step++;
                    if (step === 1) return Promise.resolve({ done: false, value: undefined });
                    return new Promise(() => {});
                  },
                  return(value?: any) {
                    returnCalls++;
                    return Promise.resolve({ done: true, value });
                  }
                };
              }
            };
          },
          { count: 0 } as any,
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );
    flush();

    expect(store.count).toBe(1);

    stopHydration();
    flush();

    dispose();

    expect(returnCalls).toBe(1);
  });

  test("createMemo: hybrid async generator continues iterating client-side (#2993)", async () => {
    // Server consumed exactly one yield and serialized it as a settled promise.
    startHydration({ t0: { v: 1, s: 1 } });

    let memo: any;
    createRoot(
      () => {
        memo = createMemo(
          async function* () {
            yield 1;
            await new Promise(r => setTimeout(r, 5));
            yield 2;
            await new Promise(r => setTimeout(r, 5));
            yield 3;
          } as any,
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );
    flush();

    // Adoption pass: serialized first yield.
    expect(memo()).toBe(1);

    stopHydration();
    flush();

    // Takeover: the client generator re-runs; its first yield reproduces the
    // server value and the rest continue — no refetch/invalidation required.
    await new Promise(r => setTimeout(r, 50));
    flush();
    expect(memo()).toBe(3);
  });

  test("createMemo: hybrid single-yield generator stays at the server value", async () => {
    startHydration({ t0: { v: "only", s: 1 } });

    let memo: any;
    createRoot(
      () => {
        memo = createMemo(
          async function* () {
            yield "only";
          } as any,
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );
    flush();

    expect(memo()).toBe("only");

    stopHydration();
    flush();
    await new Promise(r => setTimeout(r, 20));
    flush();
    expect(memo()).toBe("only");
  });

  test("createSignal(fn): hybrid async generator continues iterating client-side", async () => {
    startHydration({ t0: { v: 10, s: 1 } });

    let read: any;
    createRoot(
      () => {
        [read] = createSignal(
          async function* () {
            yield 10;
            await new Promise(r => setTimeout(r, 5));
            yield 20;
          } as any,
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );
    flush();

    expect(read()).toBe(10);

    stopHydration();
    flush();
    await new Promise(r => setTimeout(r, 30));
    flush();
    expect(read()).toBe(20);
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
      // Keyed by the hydration id of lazy's render memo — the server
      // registers the mapping under the same positional id ("t" root, first
      // child), so no module identity is needed on the client.
      modules: {
        t0: { default: (props: any) => `Hello ${props.name}` }
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
      undefined,
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

  test("lazy without moduleUrl still hydrates from a cached module (glob case)", () => {
    (globalThis as any)._$HY = {
      modules: {
        t0: { default: (props: any) => `Hello ${props.name}` }
      },
      loading: {},
      r: {},
      events: [],
      completed: new WeakSet()
    };
    startHydration({});

    let result: any;
    // No moduleUrl — e.g. a router using import.meta.glob. The positional
    // hydration id still finds the server-preloaded module.
    const LazyComp = lazy(() => Promise.resolve({ default: (props: any) => `async` }));

    createRoot(
      () => {
        result = LazyComp({ name: "World" });
      },
      { id: "t" }
    );

    expect(typeof result).toBe("function");
    expect(result()).toBe("Hello World");
  });

  test("cached module without a default export throws loudly in dev (#3011)", () => {
    (globalThis as any)._$HY = {
      modules: {
        // A raw multi-export route chunk registered via $$moduleUrl passthrough
        // — the named-export wrapper pattern. No default export.
        t0: { HomePage: (props: any) => `Home ${props.name}` }
      },
      loading: {},
      r: {},
      events: [],
      completed: new WeakSet()
    };
    startHydration({});

    // Wrapper selects the named export — lazy's fn contract is still honored
    // ({ default }), but the PRELOADED module's default is undefined. Rendering
    // it would silently orphan the server DOM, so dev fails loudly instead.
    const LazyComp = lazy(() =>
      Promise.resolve({ HomePage: (props: any) => `Home ${props.name}` }).then(m => ({
        default: m.HomePage
      }))
    );

    expect(() => {
      createRoot(
        () => {
          LazyComp({ name: "World" });
        },
        { id: "t" }
      );
    }).toThrow(/"default" export is not a component/);
  });

  test("lazy with { export } hydrates the named export synchronously (#3011)", () => {
    (globalThis as any)._$HY = {
      modules: {
        // Raw multi-export route chunk — no default export needed.
        t0: {
          HomePage: (props: any) => `Home ${props.name}`,
          AboutPage: (props: any) => `About ${props.name}`
        }
      },
      loading: {},
      r: {},
      events: [],
      completed: new WeakSet()
    };
    startHydration({});

    let result: any;
    const LazyComp = lazy(() => Promise.resolve({ HomePage: () => "async" } as any), {
      export: "HomePage"
    });

    createRoot(
      () => {
        result = (LazyComp as any)({ name: "World" });
      },
      { id: "t" }
    );

    // Resolved synchronously from the preloaded namespace — no async hop.
    expect(typeof result).toBe("function");
    expect(result()).toBe("Home World");
  });

  test("lazy with { export } naming a missing export throws loudly in dev (#3011)", () => {
    (globalThis as any)._$HY = {
      modules: {
        t0: { HomePage: () => "Home" }
      },
      loading: {},
      r: {},
      events: [],
      completed: new WeakSet()
    };
    startHydration({});

    const LazyComp = lazy(() => Promise.resolve({ HomePage: () => "Home" } as any), {
      export: "Missing"
    });

    expect(() => {
      createRoot(
        () => {
          (LazyComp as any)({});
        },
        { id: "t" }
      );
    }).toThrow(/"Missing" export is not a component/);
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
      undefined,
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
    let dispose!: () => void;
    createRoot(
      d => {
        dispose = d;
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

    // The boundary never resumes in this test; dispose so its pending count
    // releases instead of holding global hydration open (#2917 semantics).
    dispose();
    flush();
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
    let dispose!: () => void;
    createRoot(
      d => {
        dispose = d;
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

    // Assets never resolve here; dispose so the boundary's pending count
    // releases instead of holding global hydration open (#2917 semantics).
    dispose();
    flush();
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
    let dispose!: () => void;
    createRoot(
      d => {
        dispose = d;
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

    // Assets never resolve here; dispose so the boundary's pending count
    // releases instead of holding global hydration open (#2917 semantics).
    dispose();
    flush();
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

  // solidjs/solid#2817 layer 3: a rejected chunk preload must never hang
  // hydration silently — the boundary reports the error and resumes with a
  // fresh client render so lazy()'s own import() retries through normal
  // channels.
  test("rejected preload resumes a settled boundary instead of hanging", async () => {
    let rejectAssets!: (e: any) => void;
    const assetLoadPromise = new Promise<void>((_, rej) => (rejectAssets = rej));

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
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

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
    expect(result()).toBeUndefined(); // waiting on assets

    rejectAssets(new Error("chunk 404"));
    await new Promise(r => setTimeout(r, 0));
    flush();
    await new Promise(r => setTimeout(r, 0));
    flush();

    // resumed with a fresh client render: inner value is the boundary memo
    const inner = result();
    expect(typeof inner).toBe("function");
    expect(inner()).toBe("content");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  test("rejected preload with pending server data still resumes", async () => {
    let resolveData!: () => void;
    const dataPromise = new Promise<boolean>(r => (resolveData = () => r(true)));
    let rejectAssets!: (e: any) => void;
    const assetLoadPromise = new Promise<void>((_, rej) => (rejectAssets = rej));

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
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

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
    expect(result()).toBe("loading...");

    rejectAssets(new Error("network"));
    resolveData();
    await new Promise(r => setTimeout(r, 0));
    flush();
    await new Promise(r => setTimeout(r, 0));
    flush();

    // resumed with a fresh client render: inner value is the boundary memo
    const inner = result();
    expect(typeof inner).toBe("function");
    expect(inner()).toBe("content");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("Loading boundary: already-serialized settled ref", () => {
  afterEach(() => {
    stopHydration();
    delete (globalThis as any)._$HY;
  });

  test("inner createMemo hydrates straight through (t0 already { s: 1 })", () => {
    (globalThis as any)._$HY = {
      modules: {},
      loading: {},
      r: {
        t0: { s: 1, v: true },
        t0000: { s: 1, v: 42 }
      },
      events: [],
      completed: new WeakSet()
    };
    startHydration({
      t0: { s: 1, v: true },
      t0000: { s: 1, v: 42 }
    });

    let memo: any;
    let result: any;
    createRoot(
      () => {
        result = Loading({
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

    // Already settled: content hydrates in the same pass — the fallback only
    // renders when it is actually what the server left showing (#2801 bug 1).
    expect(result()).not.toBe("loading...");
    expect(memo()).toBe(42);
  });

  test("inner createProjection hydrates store after microtask resume (t0 already { s: 1 })", async () => {
    const serverState = { name: "Alice", count: 42 };

    (globalThis as any)._$HY = {
      modules: {},
      loading: {},
      r: {
        t0: { s: 1, v: true },
        t0000: { v: serverState, s: 1 }
      },
      events: [],
      completed: new WeakSet()
    };
    startHydration({
      t0: { s: 1, v: true },
      t0000: { v: serverState, s: 1 }
    });

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

    await new Promise<void>(r => queueMicrotask(r));
    flush();

    expect(store.name).toBe("Alice");
    expect(store.count).toBe(42);
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
          { ssrSource: "client", loadingValue: undefined }
        );
      },
      { id: "t" }
    );
    flush();

    // Snapshot protects: returns the uninitialized value during hydration
    expect(result()).toBeUndefined();

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
        createMemo(() => 0, { ssrSource: "client", loadingValue: undefined });
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
        createMemo(() => 0, { ssrSource: "client", loadingValue: undefined });
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
          (err: any) => `error: ${err().message}`
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
        createMemo(() => 0, { ssrSource: "client", loadingValue: undefined });
        coreMemo(() => x());
        sharedConfig.onHydrationEnd!(() => {
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
              { ssrSource: "client", loadingValue: undefined }
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
            memo = createMemo(() => 0, { ssrSource: "hybrid" });
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

describe("Loading boundary: fragment registration channel (_fr)", () => {
  afterEach(() => {
    stopHydration();
    delete (globalThis as any)._$HY;
  });

  test("already-resolved _fr hydrates straight through with inner memo", () => {
    (globalThis as any)._$HY = {
      modules: {},
      loading: {},
      r: {
        t0_fr: { s: 1, v: true },
        t0000: { s: 1, v: 42 }
      },
      events: [],
      completed: new WeakSet()
    };
    startHydration({
      t0_fr: { s: 1, v: true },
      t0000: { s: 1, v: 42 }
    });

    let memo: any;
    let result: any;
    createRoot(
      () => {
        result = Loading({
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

    // Already settled ($df ran before hydrate): content hydrates in the same
    // pass — the fallback only renders when it is actually showing (#2801).
    expect(result()).not.toBe("loading...");
    expect(memo()).toBe(42);
  });

  test("pending _fr waits then resumes hydration on resolve", async () => {
    let resolveFr!: (v: boolean) => void;
    const frPromise: any = new Promise<boolean>(r => (resolveFr = r));
    frPromise.s = 0;

    (globalThis as any)._$HY = {
      modules: {},
      loading: {},
      r: {
        t0_fr: frPromise,
        t0000: { s: 1, v: 99 }
      },
      events: [],
      completed: new WeakSet()
    };
    startHydration({
      t0_fr: frPromise,
      t0000: { s: 1, v: 99 }
    });

    let memo: any;
    let result: any;
    createRoot(
      () => {
        result = Loading({
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

    expect(result()).toBe("loading...");

    resolveFr(true);
    await new Promise<void>(r => setTimeout(r, 50));
    flush();

    expect(memo()).toBe(99);
  });

  test("rejected _fr resumes without hydrating serialized children", async () => {
    let rejectFr!: (e: any) => void;
    const frPromise: any = new Promise<boolean>((_, rej) => (rejectFr = rej));
    frPromise.s = 0;

    (globalThis as any)._$HY = {
      modules: {},
      loading: {},
      r: {
        t0_fr: frPromise,
        t0000: { s: 1, v: 7 }
      },
      events: [],
      completed: new WeakSet()
    };
    startHydration({
      t0_fr: frPromise,
      t0000: { s: 1, v: 7 }
    });

    let memo: any;
    let result: any;
    createRoot(
      () => {
        result = Loading({
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

    expect(result()).toBe("loading...");

    rejectFr(new Error("stream error"));
    await new Promise<void>(r => setTimeout(r, 50));
    flush();

    expect(memo()).toBe(0);
  });

  test("_fr with assets waits for both fragment and assets", async () => {
    let resolveAsset!: () => void;
    const assetPromise = new Promise<void>(r => (resolveAsset = r));

    (globalThis as any)._$HY = {
      modules: {},
      loading: { "./Comp": assetPromise },
      r: {
        t0_fr: { s: 1, v: true },
        t0_assets: { "./Comp": "/assets/comp.js" }
      },
      events: [],
      completed: new WeakSet()
    };
    startHydration({
      t0_fr: { s: 1, v: true },
      t0_assets: { "./Comp": "/assets/comp.js" }
    });

    let result: any;
    createRoot(
      () => {
        result = Loading({
          fallback: "loading...",
          get children() {
            return "loaded content";
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

  test("plain id check takes precedence over _fr when both exist", () => {
    (globalThis as any)._$HY = {
      modules: {},
      loading: {},
      r: {
        t0: "$$f",
        t0_fr: { s: 1, v: true }
      },
      events: [],
      completed: new WeakSet()
    };
    startHydration({
      t0: "$$f",
      t0_fr: { s: 1, v: true }
    });

    let result: any;
    createRoot(
      () => {
        result = Loading({
          fallback: "fallback-sync",
          get children() {
            return "content";
          }
        });
      },
      { id: "t" }
    );
    flush();

    expect(typeof result).toBe("function");
    expect(result()).toBe("fallback-sync");
  });

  test("_fr channel isolation: sibling boundaries with distinct root IDs", async () => {
    let resolveA!: (v: boolean) => void;
    const frA: any = new Promise<boolean>(r => (resolveA = r));
    frA.s = 0;

    let resolveB!: (v: boolean) => void;
    const frB: any = new Promise<boolean>(r => (resolveB = r));
    frB.s = 0;

    (globalThis as any)._$HY = {
      modules: {},
      loading: {},
      r: {
        a0_fr: frA,
        a0000: { s: 1, v: "val-A" },
        b0_fr: frB,
        b0000: { s: 1, v: "val-B" }
      },
      events: [],
      completed: new WeakSet()
    };
    startHydration({
      a0_fr: frA,
      a0000: { s: 1, v: "val-A" },
      b0_fr: frB,
      b0000: { s: 1, v: "val-B" }
    });

    let memoA: any, memoB: any;
    let resultA: any, resultB: any;

    createRoot(
      () => {
        resultA = Loading({
          fallback: "fb-A",
          get children() {
            memoA = createMemo(() => 0);
            return (() => memoA()) as any;
          }
        });
      },
      { id: "a" }
    );

    createRoot(
      () => {
        resultB = Loading({
          fallback: "fb-B",
          get children() {
            memoB = createMemo(() => 0);
            return (() => memoB()) as any;
          }
        });
      },
      { id: "b" }
    );
    flush();

    expect(resultA()).toBe("fb-A");
    expect(resultB()).toBe("fb-B");

    resolveA(true);
    await new Promise<void>(r => setTimeout(r, 50));
    flush();

    expect(memoA()).toBe("val-A");
    // B's children haven't been evaluated yet — boundary still showing fallback
    expect(memoB).toBeUndefined();

    resolveB(true);
    await new Promise<void>(r => setTimeout(r, 50));
    flush();

    expect(memoB()).toBe("val-B");
  });
});

describe("Transparent Effect Hydration", () => {
  afterEach(() => {
    stopHydration();
  });

  test("non-transparent effect adopts the serialized value at its id", () => {
    // Baseline for the test below: the server serialized a value at the
    // effect's id ("t0"); the hydrating effect's compute is replaced by it.
    startHydration({ t0: "serialized" });

    const observed: any[] = [];
    createRoot(
      () => {
        createRenderEffect(
          () => "live",
          (v: any) => {
            observed.push(v);
          }
        );
      },
      { id: "t" }
    );
    flush();

    expect(observed).toEqual(["serialized"]);
  });

  test("transparent effect runs live and consumes no hydration id slot", () => {
    // The router shape (claims.ts / scrollRestoration.ts): a client-only
    // effect created while hydrating. It must not adopt serialized state
    // (its compute runs live) and must not consume a child id — otherwise
    // every later sibling's hydration id shifts and serialized lookups miss.
    startHydration({ t0: "serialized" });

    const renderObserved: any[] = [];
    const userObserved: any[] = [];
    let sibling: any;
    createRoot(
      () => {
        createRenderEffect(
          () => "live",
          (v: any) => {
            renderObserved.push(v);
          },
          { transparent: true }
        );
        createEffect(
          () => "live-user",
          (v: any) => {
            userObserved.push(v);
          },
          { transparent: true }
        );
        // Neither transparent effect consumed a child slot, so this memo's
        // id is "t0" and it adopts the server's serialized value.
        sibling = createMemo(() => "computed");
      },
      { id: "t" }
    );
    flush();

    expect(renderObserved).toEqual(["live"]);
    expect(userObserved).toEqual(["live-user"]);
    expect(sibling()).toBe("serialized");
  });
});

// === Promise-of-AsyncIterable adoption (data-API flattening) ===
//
// The server's flattening serializes a promise that resolves to a tapped
// stream (replay first value, then delegate). The client adopts it as a
// plain serialized promise; the core's handleAsync flattening consumes the
// resolved stream — no dedicated hydration branch needed.

describe("Promise-of-AsyncIterable Hydration — createMemo", () => {
  afterEach(() => {
    stopHydration();
  });

  test("adopted promise resolving to a stream drives the memo per yield", async () => {
    const ai = createBufferedAsyncIterable([1]);
    let resolveChannel!: (v: any) => void;
    const channel = new Promise(r => (resolveChannel = r));
    startHydration({ t0: channel });

    let result: any;
    createRoot(
      () => {
        result = createMemo(() => 0);
      },
      { id: "t" }
    );
    flush();

    stopHydration();
    resolveChannel(ai);
    await new Promise(r => setTimeout(r, 0));
    flush();
    expect(result()).toBe(1);

    ai.push(2);
    await new Promise(r => setTimeout(r, 0));
    flush();
    expect(result()).toBe(2);

    ai.complete();
    await new Promise(r => setTimeout(r, 0));
    flush();
    expect(result()).toBe(2);
  });
});
