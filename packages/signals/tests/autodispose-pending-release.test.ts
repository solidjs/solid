/**
 * #2934 / #2935: the STATUS_PENDING exemption in unlinkSubs keeps a lazy
 * (auto-dispose) node alive when it loses its last subscriber mid-flight —
 * but every path that CLEARS that pending state must then run the matching
 * last-one-out release, or the node stays linked forever with zero
 * subscribers.
 *
 * - #2934: a derivatively-pending node (pending via _pendingSources, no own
 *   promise) settles through settlePendingSource / notifyStatus(STATUS_ERROR),
 *   which never released. It recomputed on every upstream change, forever.
 * - #2935: the AsyncIterable branch of handleAsync got the exemption without
 *   the release: an unobserved lazy node kept pulling values and never called
 *   it.return(), leaking whatever stream/socket backs the iterator.
 */
import { createMemo, createRenderEffect, createRoot, createSignal, flush } from "../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 5));

function subscribe(read: () => unknown): () => void {
  return createRoot(dispose => {
    createRenderEffect(
      () => {
        try {
          read();
        } catch {}
      },
      () => undefined
    );
    return dispose;
  });
}

describe("#2934: derivatively-pending lazy memo release", () => {
  test("released when upstream RESOLVES with no subscribers; revives on fresh read", async () => {
    const resolvers: ((v: number) => void)[] = [];
    const [sig, setSig] = createSignal(0);
    let derivedRuns = 0;

    let source!: () => number;
    createRoot(() => {
      source = createMemo(() => {
        sig();
        return new Promise<number>(r => resolvers.push(r));
      }) as unknown as () => number;
    });

    const derived = createMemo(
      () => {
        derivedRuns++;
        return source() * 2;
      },
      { lazy: true }
    ) as unknown as () => number;

    const unsubscribe = subscribe(derived);
    flush();
    unsubscribe();
    flush();
    expect(derivedRuns).toBe(1); // pending exemption kept it alive, no rerun yet

    // Upstream settles with no subscribers: release, not recompute.
    resolvers[0](5);
    await tick();
    flush();
    expect(derivedRuns).toBe(1);

    // Released for real: further upstream changes never recompute it.
    setSig(1);
    flush();
    resolvers[1]?.(7);
    await tick();
    flush();
    setSig(2);
    flush();
    resolvers[2]?.(9);
    await tick();
    flush();
    expect(derivedRuns).toBe(1);

    // Fresh subscriber recomputes from scratch.
    const unsubscribe2 = subscribe(derived);
    flush();
    expect(derivedRuns).toBe(2);
    unsubscribe2();
  });

  test("released when upstream ERRORS with no subscribers", async () => {
    let reject!: (e: unknown) => void;
    let derivedRuns = 0;

    let source!: () => number;
    createRoot(() => {
      source = createMemo(
        () => new Promise<number>((_, rej) => (reject = rej))
      ) as unknown as () => number;
    });

    const derived = createMemo(
      () => {
        derivedRuns++;
        return source() * 2;
      },
      { lazy: true }
    ) as unknown as () => number;

    const unsubscribe = subscribe(derived);
    flush();
    unsubscribe();
    flush();
    expect(derivedRuns).toBe(1);

    reject(new Error("boom"));
    await tick();
    flush();

    // Error settles the derivative pending; the stranded node released and
    // never re-runs (an error rerun would rethrow into nothing).
    expect(derivedRuns).toBe(1);
  });

  test("control: a live subscriber keeps the node recomputing across settles", async () => {
    const resolvers: ((v: number) => void)[] = [];
    const [sig, setSig] = createSignal(0);
    let derivedRuns = 0;

    let source!: () => number;
    createRoot(() => {
      source = createMemo(() => {
        sig();
        return new Promise<number>(r => resolvers.push(r));
      }) as unknown as () => number;
    });

    const derived = createMemo(
      () => {
        derivedRuns++;
        return source() * 2;
      },
      { lazy: true }
    ) as unknown as () => number;

    const unsubscribe = subscribe(derived);
    flush();
    resolvers[0](5);
    await tick();
    flush();
    const afterFirst = derivedRuns;
    expect(derived()).toBe(10);

    setSig(1);
    flush();
    resolvers[1](7);
    await tick();
    flush();
    expect(derivedRuns).toBeGreaterThan(afterFirst);
    expect(derived()).toBe(14);
    unsubscribe();
  });
});

describe("#2935: AsyncIterable lazy memo release", () => {
  function makeIterable() {
    const nextResolvers: ((r: IteratorResult<number>) => void)[] = [];
    let returned = 0;
    const iterable: AsyncIterable<number> = {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<number>>(res => nextResolvers.push(res)),
        return: () => (returned++, Promise.resolve({ value: undefined, done: true as const }))
      })
    };
    return { iterable, nextResolvers, returned: () => returned };
  }

  test("iterator closed after losing last subscriber while awaiting a value", async () => {
    const { iterable, nextResolvers, returned } = makeIterable();
    const lazyM = createMemo(() => iterable, { lazy: true }) as unknown as () => number;

    const unsubscribe = subscribe(lazyM);
    flush();
    expect(nextResolvers.length).toBe(1); // first pull outstanding

    unsubscribe();
    flush();

    // First value arrives with no subscribers: release — close the iterator,
    // pull nothing further.
    nextResolvers[0]({ value: 1, done: false });
    await tick();
    flush();
    expect(returned()).toBe(1);
    expect(nextResolvers.length).toBe(1);
  });

  test("control: a live subscriber keeps the stream pumping; dispose closes it", async () => {
    const { iterable, nextResolvers, returned } = makeIterable();
    let lazyM!: () => number;
    const dispose = createRoot(d => {
      lazyM = createMemo(() => iterable, { lazy: true }) as unknown as () => number;
      createRenderEffect(
        () => {
          try {
            lazyM();
          } catch {}
        },
        () => undefined
      );
      return d;
    });
    flush();
    expect(nextResolvers.length).toBe(1);

    nextResolvers[0]({ value: 1, done: false });
    await tick();
    flush();
    expect(lazyM()).toBe(1);
    expect(nextResolvers.length).toBe(2); // kept pulling

    nextResolvers[1]({ value: 2, done: false });
    await tick();
    flush();
    expect(lazyM()).toBe(2);

    dispose();
    flush();
    expect(returned()).toBe(1);
  });

  test("iterator completing (done) while unobserved still releases the node", async () => {
    const { iterable, nextResolvers } = makeIterable();
    const [sig, setSig] = createSignal(0);
    let runs = 0;
    const lazyM = createMemo(
      () => {
        runs++;
        sig();
        return iterable;
      },
      { lazy: true }
    ) as unknown as () => number;

    const unsubscribe = subscribe(lazyM);
    flush();
    nextResolvers[0]({ value: 1, done: false });
    await tick();
    flush();

    unsubscribe();
    flush();

    // Stream completes with no subscribers.
    nextResolvers[1]({ value: undefined as any, done: true });
    await tick();
    flush();

    // Released: upstream changes never recompute it.
    const runsAtRelease = runs;
    setSig(1);
    flush();
    await tick();
    flush();
    expect(runs).toBe(runsAtRelease);
  });
});
