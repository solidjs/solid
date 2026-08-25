import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  untrack
} from "../src/index.js";

afterEach(() => flush());

describe("autodispose contract — async-throw-untrack escape", () => {
  it("an async memo read only via untrack from a suspending render-effect settles once and returns the cached value across re-runs", async () => {
    let computeRuns = 0;
    let resolveName!: (v: number) => void;
    let memoAccessor!: () => number;
    const [tick, setTick] = createSignal(0);
    let observed = 0;

    createRoot(() => {
      memoAccessor = createMemo(() => {
        computeRuns++;
        return new Promise<number>(res => {
          resolveName = res;
        });
      }) as unknown as () => number;

      // The render-effect mirrors the user's <div title={runAndLog(() => untrack(name), ...)}>.
      // It tracks an unrelated signal (tick) to give itself a reason to re-run, and reads
      // name via untrack — which throws NotReadyError until name resolves, after which
      // the read returns the cached value.
      createRenderEffect(
        () => {
          tick();
          observed = untrack(memoAccessor);
          return undefined;
        },
        () => undefined
      );
    });

    flush();
    expect(computeRuns).toBe(1);

    resolveName(123);
    await Promise.resolve();
    flush();
    await Promise.resolve();
    flush();

    expect(observed).toBe(123);
    expect(computeRuns).toBe(1);

    setTick(1);
    flush();
    expect(observed).toBe(123);
    expect(computeRuns).toBe(1);

    setTick(2);
    flush();
    setTick(3);
    flush();

    expect(observed).toBe(123);
    expect(computeRuns).toBe(1);
  });

  it("the suspension link added during the throw should not cause autodispose when later removed by a successful re-run", async () => {
    let computeRuns = 0;
    let resolveName!: (v: number) => void;
    let memoAccessor!: () => number;
    const [tick, setTick] = createSignal(0);

    createRoot(() => {
      memoAccessor = createMemo(() => {
        computeRuns++;
        return new Promise<number>(res => {
          resolveName = res;
        });
      }) as unknown as () => number;

      createRenderEffect(
        () => {
          tick();
          untrack(memoAccessor);
          return undefined;
        },
        () => undefined
      );
    });

    flush();
    resolveName(123);
    await Promise.resolve();
    flush();
    await Promise.resolve();
    flush();
    const runsAfterFirstSettle = computeRuns;

    setTick(1);
    flush();
    setTick(2);
    flush();

    expect(computeRuns).toBe(runsAfterFirstSettle);
  });
});

describe("autodispose contract — lazy async memo in flight", () => {
  // `dynamic()`'s source shape: a LAZY memo (autodispose when unobserved)
  // whose computation is an async call. The in-flight promise counts as an
  // observer — losing the last subscriber while pending must not tear the
  // node down (each teardown re-executes the source on the next read: one
  // server fetch per suspended re-read). The settle is the promise-
  // observer's release, and runs the last-one-out check itself.
  it("subscriber churn while the promise is in flight neither tears down nor re-executes", async () => {
    let runs = 0;
    const resolvers: ((v: number) => void)[] = [];
    const lazyM = createMemo(
      () => {
        runs++;
        return new Promise<number>(r => resolvers.push(r));
      },
      { lazy: true }
    ) as unknown as () => number;

    // First subscriber starts the computation, then goes away mid-flight.
    const dispose1 = createRoot(dispose => {
      createRenderEffect(
        () => lazyM(),
        () => undefined
      );
      return dispose;
    });
    flush();
    expect(runs).toBe(1);
    dispose1();
    flush();

    // A later subscriber attaches to the SAME in-flight computation.
    let observed = 0;
    const dispose2 = createRoot(dispose => {
      createRenderEffect(
        () => (observed = lazyM()),
        () => undefined
      );
      return dispose;
    });
    flush();
    expect(runs).toBe(1);

    resolvers[0](42);
    await Promise.resolve();
    flush();
    await Promise.resolve();
    flush();
    expect(observed).toBe(42);
    expect(runs).toBe(1);
    dispose2();
    flush();
  });

  it("settling while unobserved releases the node (lazy teardown resumes once idle)", async () => {
    let runs = 0;
    const resolvers: ((v: number) => void)[] = [];
    const lazyM = createMemo(
      () => {
        runs++;
        return new Promise<number>(r => resolvers.push(r));
      },
      { lazy: true }
    ) as unknown as () => number;

    const dispose1 = createRoot(dispose => {
      createRenderEffect(
        () => lazyM(),
        () => undefined
      );
      return dispose;
    });
    flush();
    expect(runs).toBe(1);
    // Unobserved but in flight: stays alive (previous test) …
    dispose1();
    flush();

    // … but once it settles with no subscribers, the node releases — it
    // must not stay linked to its sources forever. A fresh subscriber
    // recomputes from scratch, which is lazy's normal idle behavior.
    resolvers[0](1);
    await Promise.resolve();
    flush();
    await Promise.resolve();
    flush();

    createRoot(() => {
      createRenderEffect(
        () => lazyM(),
        () => undefined
      );
    });
    flush();
    expect(runs).toBe(2);
  });
});
