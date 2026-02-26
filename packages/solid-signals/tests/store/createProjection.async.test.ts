import {
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  NotReadyError,
  latest,
  refresh
} from "../../src/index.js";

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
    expect(proj.value).toBe(0);
    await Promise.resolve();
    expect(proj.value).toBe(2);
    expect(runs).toBe(1);

    setX(2);
    flush();

    await Promise.resolve();
    expect(proj.value).toBe(4);
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
    expect(proj.phase).toBe("start");

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.phase).toBe("middle");

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.phase).toBe("end");
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
    expect(proj).toEqual({ a: 0, b: 0, c: 99 });

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
    expect(proj.a).toBe(0);

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

  it("yielded values preserve identity only for unchanged subtrees", async () => {
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

    expect(proj.nested).not.toBe(firstNested);
    expect(proj.nested.x).toBe(1);
    expect(proj.nested.y).toBeUndefined();
    expect(firstY).toBe(2);
  });

  it("yielded values replace changed subtrees", async () => {
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

    expect(proj.nested).not.toBe(firstNested);
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
    expect(proj.value).toBe(null);

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
        () => [isPending(() => proj.value), proj.value] as const,
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

    // After completion: not pending, new value
    expect(proj.value).toBe(20);
    const finalResult = results[results.length - 1];
    expect(finalResult?.pending).toBe(false);
    expect(finalResult?.value).toBe(20);
  });

  it("isPending with refresh() and subscribed effect", async () => {
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

    // Refresh triggers new async - now we have stale data
    refresh(proj);
    flush();

    // Should see pending state
    const pendingResult = results.find(r => r.pending);
    expect(pendingResult).toBeDefined();

    await Promise.resolve();
    await Promise.resolve();

    expect(proj.value).toBe(200);
    const finalResult = results[results.length - 1];
    expect(finalResult?.pending).toBe(false);
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
});
