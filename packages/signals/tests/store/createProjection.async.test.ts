import {
  affects,
  createEffect,
  createErrorBoundary,
  createMemo,
  createLoadingBoundary,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  latest,
  NotReadyError,
  refresh,
  untrack
} from "../../src/index.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Projection async behavior", () => {
  it("resolves async draft and transforms into new value", async () => {
    const [$x, setX] = createSignal(1);

    let runs = 0;
    let proj;

    createRoot(() => {
      proj = createProjection(
        async draft => {
          const v = $x();
          await Promise.resolve();
          draft.value = v * 2;
          runs++;
        },
        { value: 0 }
      );
    });

    flush();
    // The seed is a draft for the derive function, never an observable value
    // (#2897): until the first resolution settles, reads throw NotReady.
    expect(() => proj.value).toThrow(NotReadyError);
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.value).toBe(2);
    expect(runs).toBe(1);

    setX(2);
    flush();

    await Promise.resolve();
    expect(proj.value).toBe(4);
    expect(runs).toBe(2);
  });

  it("does not self-track through array splice has checks", async () => {
    const mockedItems = [
      { id: "some-id-1", value: "Sample text 1", timestamp: 100 },
      { id: "some-id-2", value: "Sample text 2", timestamp: 100 },
      { id: "some-id-3", value: "Sample text 3", timestamp: 100 },
      { id: "some-id-4", value: "Sample text 4", timestamp: 200 },
      { id: "some-id-5", value: "Sample text 5", timestamp: 250 },
      { id: "some-id-6", value: "Sample text 6", timestamp: 200 },
      { id: "some-id-7", value: "Sample text 7", timestamp: 300 },
      { id: "some-id-8", value: "Sample text 8", timestamp: 300 }
    ];

    function insertValueByTimestamp<M extends { timestamp: number; id: string }>(arr: M[], el: M) {
      let left = 0;
      let right = arr.length;

      while (left < right) {
        const mid = (left + right) >>> 1;
        if (arr[mid].timestamp <= el.timestamp) left = mid + 1;
        else right = mid;
      }

      arr.splice(left, 0, el);
    }

    const retrieveItems = () =>
      new Promise<typeof mockedItems>(resolve => {
        setTimeout(() => resolve([...mockedItems]), 0);
      });

    let runs = 0;

    createRoot(() => {
      const items = createMemo(() => retrieveItems());
      const proj = createProjection(
        store => {
          if (++runs > 20) throw new Error("Projection self-tracked through splice");

          for (const item of items()) {
            insertValueByTimestamp(store, item);
          }
        },
        [] as typeof mockedItems
      );

      createRenderEffect(
        () => proj.length,
        () => {}
      );
    });

    flush();
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(runs).toBe(2);
  });

  it("async projection preserves identity only for unchanged paths", async () => {
    const [$x, setX] = createSignal({ a: 1, b: 2 });

    let proj;

    createRoot(() => {
      proj = createProjection(
        async draft => {
          const v = $x();
          await Promise.resolve();
          draft.a = v.a;
          draft.b = v.b;
        },
        { a: 0, b: 0 }
      );
    });

    flush();
    // Draft writes land on the store value one microtask before the async
    // settles; the store stays unreadable (NotReady) until the settle (#2897).
    await Promise.resolve();
    expect(() => proj.a).toThrow(NotReadyError);
    await Promise.resolve();

    const firstProj = proj;
    const firstA = proj.a;
    const firstB = proj.b;

    setX({ a: 1, b: 3 });
    flush();
    await Promise.resolve();

    expect(proj).toBe(firstProj);
    expect(proj.a).toBe(firstA);
    expect(proj.b).not.toBe(firstB);
  });

  it("async iterable projection yields multiple transformed snapshots", async () => {
    let proj;

    createRoot(() => {
      proj = createProjection(
        async function* (draft) {
          draft.phase = "start";
          yield;

          await Promise.resolve();
          draft.phase = "middle";
          yield;

          await Promise.resolve();
          draft.phase = "end";
        },
        { phase: "init" }
      );
    });

    flush();
    // Uninitialized only until the first yield — but an async generator's
    // first next() resolves in a microtask, so even the synchronous first
    // yield can't beat the window: the seed ("init") is never observable, and
    // reads throw until "start" lands two ticks later (#2897).
    expect(() => proj.phase).toThrow(NotReadyError);
    await Promise.resolve();
    expect(() => proj.phase).toThrow(NotReadyError);
    await Promise.resolve();
    expect(proj.phase).toBe("start");

    await Promise.resolve();
    expect(proj.phase).toBe("middle");

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.phase).toBe("end");
  });

  it("derive continuation can READ its own draft after an await (push/length)", async () => {
    // Regression: `state.push(item)` after an `await` first READS
    // `state.length`. The continuation runs outside the sync write scope, so
    // that read used to hit the §6c firewall gate (seed invisibility), throw
    // NotReadyError into the derive itself, and the post-await read
    // diagnostic (#2987) escalated it to a reactivity halt — wedging any
    // boundary over the projection forever (the rendering example's Stream
    // page on client navigation). Own-draft ops carry the write override and
    // must be exempt from the gate.
    const tick = (ms: number) => new Promise(r => setTimeout(r, ms));
    const seen: number[] = [];
    let proj!: { id: number }[];
    createRoot(() => {
      proj = createProjection<{ id: number }[]>(async function* (state) {
        for (const item of [{ id: 1 }, { id: 2 }]) {
          await tick(2);
          state.push(item);
          yield;
        }
      }, []);
      createEffect(
        () => proj.length,
        len => {
          seen.push(len);
        }
      );
    });
    flush();
    await tick(30);
    flush();
    expect(seen).toEqual([1, 2]);
    expect(proj.map(i => i.id)).toEqual([1, 2]);
  });

  it("yielding a value replaces the entire snapshot (no merge)", async () => {
    let proj;

    createRoot(() => {
      proj = createProjection<{ a: number; b: number; c?: number }>(
        async function* () {
          yield { a: 1, b: 2 };
        },
        { a: 0, b: 0, c: 99 }
      );
    });

    flush();
    // Seed { a: 0, b: 0, c: 99 } is never observable — enumeration throws
    // too, so its structure can't leak either (#2897).
    expect(() => ({ ...proj })).toThrow(NotReadyError);

    await Promise.resolve();
    await Promise.resolve();

    // c disappears — no merging
    expect(proj).toEqual({ a: 1, b: 2 });
  });

  it("yielding multiple values transforms snapshot each time", async () => {
    let proj;

    createRoot(() => {
      proj = createProjection(
        async function* () {
          yield { a: 1 };
          yield { a: 2 };
          yield { a: 3 };
        },
        { a: 0 }
      );
    });

    flush();
    // Seed a: 0 is never observable (#2897).
    expect(() => proj.a).toThrow(NotReadyError);

    await Promise.resolve();
    await Promise.resolve();
    expect(proj.a).toBe(1);

    await Promise.resolve();
    await Promise.resolve();
    expect(proj.a).toBe(2);

    await Promise.resolve();
    await Promise.resolve();
    expect(proj.a).toBe(3);
  });

  // RULED (INTERNALS-STORE-STATE.md RUL-12, 2026-08-17): unkeyed nested
  // objects MERGE in place — the legacy yield-path's identity replacement was
  // an accident, inconsistent with positional/keyed merge semantics
  // everywhere else. Assertions rewritten to the ruled contract: proxy
  // identity is preserved; values and membership still update.
  it("yielded values merge unkeyed subtrees in place (identity preserved)", async () => {
    let proj;

    createRoot(() => {
      proj = createProjection(
        async function* () {
          yield { nested: { x: 1, y: 2 } };
          yield { nested: { x: 1 } }; // y removed
        },
        { nested: { x: 0, y: 0 } }
      );
    });

    flush();
    await Promise.resolve();
    await Promise.resolve();

    const firstNested = proj.nested;
    const firstY = proj.nested.y;

    await Promise.resolve();
    await Promise.resolve();

    expect(proj.nested).toBe(firstNested);
    expect(proj.nested.x).toBe(1);
    expect(proj.nested.y).toBeUndefined();
    expect(firstY).toBe(2);
  });

  it("yielded values merge changed unkeyed subtrees in place", async () => {
    let proj;

    createRoot(() => {
      proj = createProjection(
        async function* () {
          yield { nested: { x: 1, y: 2 } };
          yield { nested: { x: 10 } };
        },
        { nested: { x: 0, y: 0 } }
      );
    });

    flush();
    await Promise.resolve();
    await Promise.resolve();

    const firstNested = proj.nested;

    await Promise.resolve();
    await Promise.resolve();

    expect(proj.nested).toBe(firstNested);
    expect(proj.nested.x).toBe(10);
    expect(proj.nested.y).toBeUndefined();
  });

  it("shape changes DO NOT cause proxy identity changes", async () => {
    let proj;

    createRoot(() => {
      proj = createProjection(
        async function* () {
          yield { a: 1 };
          yield { a: 1, b: 2 }; // shape change
        },
        { a: 0 }
      );
    });

    flush();
    await Promise.resolve();
    await Promise.resolve();

    const firstProj = proj;

    await Promise.resolve();
    await Promise.resolve();

    expect(proj).toBe(firstProj);
    expect(proj).toEqual({ a: 1, b: 2 });
  });

  it("keyed identity mismatch replaces subtree identity", async () => {
    let proj;

    createRoot(() => {
      proj = createProjection(async function* () {
        yield [{ id: 1, v: "a" }];
        yield [{ id: 2, v: "b" }]; // key changed → identity replaced
      }, []);
    });

    flush();
    await Promise.resolve();
    await Promise.resolve();

    const firstItem = proj[0];

    await Promise.resolve();
    await Promise.resolve();

    expect(proj[0]).not.toBe(firstItem); // key mismatch → identity replaced
    expect(proj[0]).toEqual({ id: 2, v: "b" });
  });

  it("async supersession ignores stale yielded values", async () => {
    const [$x, setX] = createSignal(1);

    let proj;
    let resolve1, resolve2;

    createRoot(() => {
      proj = createProjection<{ value: string | null }>(
        async function* () {
          const v = $x();
          if (v === 1) {
            await new Promise(r => (resolve1 = r));
            yield { value: "first" };
          } else {
            await new Promise(r => (resolve2 = r));
            yield { value: "second" };
          }
        },
        { value: null }
      );
    });

    flush();

    setX(2);
    flush();

    resolve1();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // The superseded run's yield is discarded, and nothing has landed yet —
    // the store is still uninitialized, so the seed (null) stays hidden (#2897).
    expect(() => proj.value).toThrow(NotReadyError);

    resolve2();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.value).toBe("second");
  });

  it("async projection notifies only changed paths", async () => {
    const [$x, setX] = createSignal(1);

    let proj;
    let runs = 0,
      runs2 = 0;

    createRoot(() => {
      proj = createProjection(
        async draft => {
          const v = $x();
          await Promise.resolve();
          draft.a = v;
          draft.b = 123;
        },
        { a: 0, b: 0 }
      );

      createRenderEffect(
        () => proj.a,
        () => {
          runs++;
        }
      );

      createRenderEffect(
        () => proj.b,
        () => {
          runs2++;
        }
      );
    });

    flush();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(runs).toBe(1);
    expect(runs2).toBe(1);

    setX(2);
    flush();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(runs).toBe(2);
    expect(runs2).toBe(1);

    setX(2);
    flush();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(runs).toBe(2);
    expect(runs2).toBe(1);
  });

  it("refresh() forces a new async run", async () => {
    let proj;
    let runs = 0;

    createRoot(() => {
      proj = createProjection(
        async draft => {
          await Promise.resolve();
          draft.value = ++runs;
        },
        { value: 0 }
      );
    });

    flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.value).toBe(1);

    refresh(proj);
    flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.value).toBe(2);

    refresh(proj);
    flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.value).toBe(3);
  });

  it("refresh() cancels in-flight yielded values", async () => {
    let proj;
    let resolve;

    createRoot(() => {
      proj = createProjection(
        async function* () {
          yield { value: "start" };
          await new Promise(r => (resolve = r));
          yield { value: "end" };
        },
        { value: "init" }
      );
    });

    flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.value).toBe("start");

    refresh(proj);
    flush();

    resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(proj.value).toBe("start");
  });

  it("refresh() ignores stale draft writes that happen before the next yield", async () => {
    let proj;
    const resolves: Array<() => void> = [];

    createRoot(() => {
      proj = createProjection(
        async function* (draft) {
          yield;
          await new Promise<void>(r => resolves.push(r));
          draft.items.push(resolves.length);
          yield;
        },
        { items: [] as number[] }
      );
    });

    flush();
    await Promise.resolve();
    await Promise.resolve();

    expect(resolves.length).toBe(1);
    expect(proj.items).toEqual([]);

    refresh(proj);
    flush();
    await Promise.resolve();
    await Promise.resolve();

    expect(resolves.length).toBe(2);

    resolves[0]!();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(proj.items).toEqual([]);

    resolves[1]!();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(proj.items).toEqual([2]);
  });
});

describe("Projection isPending behavior", () => {
  it("isPending is false during initial async load (no transition)", async () => {
    let proj;

    createRoot(() => {
      proj = createProjection(
        async draft => {
          await Promise.resolve();
          draft.value = 123;
        },
        { value: 0 }
      );
    });

    // Before flush: not pending (no transition)
    expect(isPending(() => proj.value)).toBe(false);

    flush();

    // During async: not pending (no effect subscribed = no transition)
    expect(isPending(() => proj.value)).toBe(false);

    await Promise.resolve();
    await Promise.resolve();

    // After completion: not pending
    expect(isPending(() => proj.value)).toBe(false);
    expect(proj.value).toBe(123);
  });

  it("isPending is true when effect subscribes and triggers transition", async () => {
    const [$x, setX] = createSignal(1);
    let proj;
    const results: { pending: boolean; value: number }[] = [];

    createRoot(() => {
      proj = createProjection(
        async draft => {
          const v = $x();
          await Promise.resolve();
          draft.value = v * 10;
        },
        { value: 0 }
      );

      // Effect subscribes to projection - this enables transitions
      createRenderEffect(
        () => {
          const p = isPending(() => proj.value);
          const v = proj.value;
          return [p, v] as const;
        },
        ([pending, value]) => {
          results.push({ pending, value });
        }
      );
    });

    // Initial load - effect runs with initial value
    flush();
    await Promise.resolve();
    await Promise.resolve();

    expect(proj.value).toBe(10);
    // Find the final settled state
    const settledResult = results.find(r => r.value === 10 && !r.pending);
    expect(settledResult).toBeDefined();

    results.length = 0; // Clear for next phase

    // Signal change triggers new async with transition
    setX(2);
    flush();

    // Effect should see pending state with stale value
    const pendingResult = results.find(r => r.pending && r.value === 10);
    expect(pendingResult).toBeDefined();

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // After completion: not pending, new value
    expect(proj.value).toBe(20);
    const finalResult = results[results.length - 1];
    expect(finalResult?.pending).toBe(false);
    expect(finalResult?.value).toBe(20);
  });

  it("isPending reports projection pending with stale value", async () => {
    const [$x, setX] = createSignal(1);
    let proj;
    const results: { pending: boolean; value: number }[] = [];

    createRoot(() => {
      proj = createProjection(
        async draft => {
          const v = $x();
          await Promise.resolve();
          draft.value = v * 10;
        },
        { value: 0 }
      );

      createRenderEffect(
        () => [isPending(() => proj.value), proj.value] as const,
        ([pending, value]) => {
          results.push({ pending, value });
        }
      );
    });

    flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.value).toBe(10);

    results.length = 0;
    setX(2);
    flush();

    const pendingResult = results.find(r => r.pending && r.value === 10);
    expect(pendingResult).toBeDefined();

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.value).toBe(20);
    const finalResult = results[results.length - 1];
    expect(finalResult?.pending).toBe(false);
    expect(finalResult?.value).toBe(20);
  });

  it("refresh() is a quiet re-ask; affects() + refresh() pends the subscribed effect (re-ruled 2026-07-13)", async () => {
    let runCount = 0;
    let proj;
    const results: { pending: boolean; value: number }[] = [];

    createRoot(() => {
      proj = createProjection(
        async draft => {
          runCount++;
          await Promise.resolve();
          draft.value = runCount * 100;
        },
        { value: 0 }
      );

      createRenderEffect(
        () => [isPending(() => proj.value), proj.value] as const,
        ([pending, value]) => {
          results.push({ pending, value });
        }
      );
    });

    // Initial load
    flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.value).toBe(100);

    results.length = 0;

    // A bare refresh is a re-ask of the same question — the shown value
    // stays honest, so no pending state is ever published; the new value
    // reveals silently.
    refresh(proj);
    flush();
    expect(results.find(r => r.pending)).toBeUndefined();

    await Promise.resolve();
    await Promise.resolve();

    expect(proj.value).toBe(200);
    expect(results[results.length - 1]).toEqual({ pending: false, value: 200 });

    results.length = 0;

    // The DECLARED reload pends the subscribed effect for the whole window.
    affects(proj);
    refresh(proj);
    flush();
    expect(results.find(r => r.pending && r.value === 200)).toBeDefined();

    await Promise.resolve();
    await Promise.resolve();

    expect(proj.value).toBe(300);
    const finalResult = results[results.length - 1];
    expect(finalResult?.pending).toBe(false);
    expect(finalResult?.value).toBe(300);
  });

  it("isPending with async generator and subscribed effect", async () => {
    let proj;
    const results: { pending: boolean; value: number }[] = [];

    createRoot(() => {
      proj = createProjection(
        async function* (draft) {
          draft.value = 1;
          yield;
          await Promise.resolve();
          draft.value = 2;
          yield;
          await Promise.resolve();
          draft.value = 3;
        },
        { value: 0 }
      );

      createRenderEffect(
        () => [isPending(() => proj.value), proj.value] as const,
        ([pending, value]) => {
          results.push({ pending, value });
        }
      );
    });

    // Initial sequence - no stale data
    flush();
    await new Promise(r => setTimeout(r, 0));

    expect(proj.value).toBe(3);
    // During initial sequence, isPending should always be false
    expect(results.every(r => !r.pending)).toBe(true);

    results.length = 0;

    // Refresh triggers new sequence - now has stale data
    refresh(proj);
    flush();

    // Should see pending state during re-run
    const pendingResult = results.find(r => r.pending);
    expect(pendingResult).toBeDefined();

    await new Promise(r => setTimeout(r, 0));

    expect(proj.value).toBe(3);
    const finalResult = results[results.length - 1];
    expect(finalResult?.pending).toBe(false);
  });

  it("nested render effect resumes when async generator projection settles to same array shape", async () => {
    let result: any;
    let started = false;

    createRoot(() => {
      const proj = createProjection(async function* () {
        await Promise.resolve();
        yield [];
      }, []);
      const [text, setText] = createSignal<string | undefined>(undefined);

      const boundary = createLoadingBoundary(
        () => {
          if (!started) {
            started = true;
            createRenderEffect(
              () => `typeof: ${typeof proj.length}`,
              value => {
                setText(value);
              }
            );
          }
          const value = text();
          return value === undefined ? undefined : ["Before ", value, " After"];
        },
        () => undefined
      );

      createRenderEffect(
        () => (result = boundary()),
        () => {}
      );
    });

    flush();
    expect(result).toBeUndefined();

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(result).toEqual(["Before ", "typeof: number", " After"]);
  });

  it("async projection can wrap a pending async read", async () => {
    const gate = deferred<string>();
    let boundary!: () => unknown;
    let proj!: { value: string };

    createRoot(() => {
      const inner = createMemo(() => gate.promise);
      proj = createProjection(
        async draft => {
          draft.value = inner().toUpperCase();
          await Promise.resolve();
        },
        { value: "init" }
      );
      boundary = createLoadingBoundary(
        () => proj.value,
        () => "loading"
      );
    });

    flush();
    expect(boundary()).toBe("loading");

    gate.resolve("ready");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(proj.value).toBe("READY");
    expect(boundary()).toBe("READY");
    expect(isPending(() => proj.value)).toBe(false);
  });

  // #2938: a projection deriving from an async store settles through a Loading
  // boundary. The firewall's UNINITIALIZED clear is deferred to batch commit,
  // so during the settle flush downstream recomputes read the first values off
  // the pending rail — the trap's untracked uninitialized guard must not veto
  // those reads with the stale flag (it threw a fresh NotReadyError for an
  // already-settled source, which no sweep would ever release, wedging the
  // boundary on the tree's never-produced `undefined`).
  it("projection over an async store settles through a Loading boundary (#2938)", async () => {
    const gate = deferred<{ value: string }>();
    let view: unknown;
    const effectLog: string[] = [];
    let dispose!: () => void;

    createRoot(d => {
      dispose = d;
      const [store] = createStore(() => gate.promise, { value: "" } as { value: string });

      const proj = createProjection<{ value: string }>(
        draft => {
          draft.value = store.value;
        },
        { value: "" }
      );

      const boundary = createLoadingBoundary(
        () => "content:" + proj.value,
        () => "loading"
      );
      createRenderEffect(
        () => (view = boundary()),
        () => {}
      );
      createEffect(
        () => proj.value,
        v => {
          effectLog.push(v);
        }
      );
    });
    flush();
    expect(view).toBe("loading");
    expect(effectLog).toEqual([]);

    gate.resolve({ value: "hello" });
    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(view).toBe("content:hello");
    expect(effectLog).toEqual(["hello"]);
    dispose();
  });

  it("untracked reads of a loading projection still throw NotReady (#2897 invariant)", async () => {
    const gate = deferred<{ value: string }>();
    let proj!: { value: string };
    let dispose!: () => void;

    createRoot(d => {
      dispose = d;
      const [store] = createStore(() => gate.promise, { value: "" } as { value: string });
      proj = createProjection<{ value: string }>(
        draft => {
          draft.value = store.value;
        },
        { value: "" }
      );
    });
    flush();
    // The seed never leaks: observer-less reads throw for the whole
    // uninitialized window.
    expect(() => untrack(() => proj.value)).toThrow(NotReadyError);

    gate.resolve({ value: "hello" });
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(untrack(() => proj.value)).toBe("hello");
    dispose();
  });
});

/**
 * Errored derives follow async memo rules (the #2897 ruling: derived stores
 * mirror async memos). Before this was enforced, a rejected derive pushed its
 * error to settle-time subscribers only — every later reader (fresh tracked
 * or untracked) silently got node values instead: the seed when
 * uninitialized, last-good data after a failed refetch. Memo parity means:
 * - late readers throw the derive's error;
 * - a genuine tracked re-read on a later cycle retries the derive (same
 *   rules as read()'s computed error branch: never for untracked reads,
 *   never inside an isPending probe, once per cycle);
 * - a successful retry serves the fresh value.
 */
describe("errored derive follows memo rules", () => {
  const settle = async () => {
    await new Promise(r => setTimeout(r, 0));
    flush();
  };

  it("routes async reconciliation errors through the projection error state", async () => {
    const boom = new Error("invalid projection key");
    let store!: { id: number };
    const dispose = createRoot(d => {
      store = createProjection(
        async () => ({ id: 2 }),
        { id: 1 },
        {
          key: item => {
            if (item.id === 2) throw boom;
            return item.id;
          }
        }
      );
      return d;
    });

    flush();
    await settle();
    expect(() => untrack(() => store.id)).toThrow("invalid projection key");
    dispose();
  });

  it("untracked reads of a rejected uninitialized derive throw its error", async () => {
    const boom = new Error("boom");
    let store!: any;
    const dispose = createRoot(d => {
      [store] = createStore<{ v: number }>(
        async () => {
          throw boom;
        },
        { v: 0 }
      );
      return d;
    });
    flush();
    await settle();
    // Thrown as a StatusError wrapping the derive's error, same as an
    // errored async memo; boundaries unwrap it to the original.
    expect(() => untrack(() => store.v)).toThrow("boom");
    dispose();
  });

  it("a fresh tracked reader after rejection sees the error (not the seed), then retries", async () => {
    const boom = new Error("boom");
    let runs = 0;
    let store!: any;
    const dispose = createRoot(d => {
      [store] = createStore<{ v: number }>(
        async () => {
          runs++;
          throw boom;
        },
        { v: 0 }
      );
      return d;
    });
    flush();
    await settle();
    expect(runs).toBe(1);

    // A late subscriber must not silently read the seed. Its tracked read
    // retries the derive (memo parity); the retry re-rejects and the error
    // lands in the boundary.
    const views: unknown[] = [];
    const lateDispose = createRoot(d => {
      const view = createErrorBoundary(
        () => `value:${store.v}`,
        (e: () => unknown) => `caught:${(e() as Error)?.message}`
      );
      createEffect(
        () => view(),
        (v: unknown) => {
          views.push(v);
        }
      );
      return d;
    });
    flush();
    await settle();
    expect(views).toEqual(["caught:boom"]);
    expect(runs).toBe(2); // the tracked re-read retried the derive
    expect(views).not.toContain("value:0");
    lateDispose();
    dispose();
  });

  it("a failed refetch stops serving last-good data (memo parity)", async () => {
    const gate1 = deferred<string>();
    let fail = false;
    let store!: any;
    let setSource!: (v: number) => void;
    const dispose = createRoot(d => {
      const [$source, set] = createSignal(0);
      setSource = set;
      [store] = createStore(
        async () => {
          $source();
          if (fail) throw new Error("refetch-boom");
          return { v: await gate1.promise };
        },
        { v: "" } as any
      ) as any;
      return d;
    });
    flush();
    gate1.resolve("good");
    await settle();
    expect(untrack(() => store.v)).toBe("good");

    fail = true;
    setSource(1); // trigger refetch, which rejects
    flush();
    await settle();
    expect(() => untrack(() => store.v)).toThrow("refetch-boom");
    dispose();
  });

  it("a successful retry recovers and serves the fresh value", async () => {
    let attempts = 0;
    let store!: any;
    const dispose = createRoot(d => {
      [store] = createStore(
        async () => {
          attempts++;
          if (attempts === 1) throw new Error("first-boom");
          return { v: "recovered" };
        },
        { v: "" } as any
      ) as any;
      return d;
    });
    flush();
    await settle();
    expect(() => untrack(() => store.v)).toThrow("first-boom");

    // A tracked read on a later cycle retries; this attempt succeeds.
    const views: unknown[] = [];
    const lateDispose = createRoot(d => {
      const view = createLoadingBoundary(
        () => store.v,
        () => "loading"
      );
      createEffect(
        () => view(),
        (v: unknown) => {
          views.push(v);
        }
      );
      return d;
    });
    flush();
    await settle();
    expect(views).toContain("recovered");
    expect(attempts).toBe(2);
    lateDispose();
    dispose();
  });
});

describe("a flight superseded by a synchronous settle wakes pending dependents (#3181)", () => {
  // The cache-backed fetch shape (TanStack Query's adapter): the "cache"
  // commits and announces via a signal write in the SAME synchronous step in
  // which the flight's promise resolves. The write recomputes the derive
  // first, so the flight lands pre-superseded — asyncWrite's
  // settlePendingSource walk never runs, and before the recompute-side twin
  // every dependent that registered the flight stayed STATUS_PENDING
  // forever. The projection reconciles in place, so a memo over it recovers
  // to an UNCHANGED value: nothing else ever re-notifies, and a reader that
  // suspended through the memo re-parked on the dead source permanently.
  it("notifies a leaf reader behind a memo over the projection", async () => {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const throughMemo: Array<boolean> = [];
    const direct: Array<boolean> = [];

    let committed: { a: boolean };
    let inFlight: Promise<{ value: { a: boolean } }> | null = null;
    let land!: () => void;

    const [version, setVersion] = createSignal(0);
    const fetchNow = (next: { a: boolean }) => {
      const gate = deferred<void>();
      land = () => {
        committed = next;
        inFlight = null;
        // announce first (sync recompute supersedes the flight)…
        setVersion(v => v + 1);
        // …then the flight's own promise resolves, already stale
        gate.resolve();
      };
      inFlight = gate.promise.then(() => ({ value: next }));
    };

    let memo!: () => { a: boolean };
    const dispose = createRoot(d => {
      const store = createProjection(
        () => {
          version();
          if (inFlight) return inFlight;
          return { value: committed };
        },
        { value: { a: undefined as unknown as boolean } }
      );
      const data = () => store.value;
      memo = createMemo(() => data());
      createEffect(
        () => memo().a,
        v => {
          throughMemo.push(v);
        }
      );
      createEffect(
        () => data().a,
        v => {
          direct.push(v);
        }
      );
      return d;
    });

    fetchNow({ a: false });
    flush();
    land();
    await sleep(5);
    flush();
    expect(throughMemo).toEqual([false]);
    expect(direct).toEqual([false]);

    // refetch: an extra announce while in flight, like the reporter's shape
    fetchNow({ a: true });
    setVersion(v => v + 1);
    flush();
    land();
    await sleep(5);
    flush();

    // the commit is visible everywhere: directly, through the memo's own
    // read, and — the regression — to the reader that suspended THROUGH the
    // memo while the flight was pending
    expect(direct).toEqual([false, true]);
    expect(untrack(() => memo()).a).toBe(true);
    expect(throughMemo).toEqual([false, true]);
    dispose();
  });

  // The counterpart boundary: superseding a first-load flight with a fresh
  // promise that has not landed yet must not wake dependents. The cache
  // announces its commit via a signal write and the derive re-runs, but what
  // it returns is a NEW promise still a microtask from landing (TanStack
  // Query's adapter returns `query.promise.then(wrap)`, rebuilt whenever the
  // underlying promise changes). The old flight is preempted, the new one
  // has not landed, and the loading window has committed nothing to the
  // store: the driver leaves STATUS_PENDING while still
  // STATUS_UNINITIALIZED. Waking dependents there hands readers the
  // projection's initial face — undefined data a read layer promised was
  // settled. Leaving pending for uninitialized is not a settle.
  it("does not wake dependents when a fresh not-yet-landed promise supersedes the first flight", async () => {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const observed: Array<boolean | undefined> = [];

    let inFlight: Promise<{ value: { a: boolean } }>;
    let land!: () => void;

    const [version, setVersion] = createSignal(0);
    const gate = deferred<void>();
    inFlight = gate.promise.then(() => ({ value: { a: false } }));
    land = () => {
      // The cache commits and announces: the derive re-runs synchronously
      // and hands the engine a FRESH chained promise (one microtask from
      // landing), then the original flight's own promise resolves stale.
      inFlight = Promise.resolve({ value: { a: false } });
      setVersion(v => v + 1);
      gate.resolve();
    };

    const dispose = createRoot(d => {
      const store = createProjection(
        () => {
          version();
          return inFlight;
        },
        { value: { a: undefined as unknown as boolean } }
      );
      createEffect(
        () => store.value.a,
        v => {
          observed.push(v);
        }
      );
      return d;
    });

    flush();
    expect(observed).toEqual([]);

    land();
    // The synchronous window right after the announce: the superseding
    // promise has not landed. Parked means parked — a wake here observes
    // the uninitialized initial face.
    flush();
    expect(observed).toEqual([]);

    await sleep(5);
    flush();
    expect(observed).toEqual([false]);
    dispose();
  });
});
