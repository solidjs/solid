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
