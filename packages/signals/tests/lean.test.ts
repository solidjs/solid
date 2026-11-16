// Bug repros from the author of the reactive core (2026-11-15), run against
// `next` after rc.22. Each test's trailing comment gives the result `next`
// had before the fix. `it.fails` pins what is still open: E2 and K2 (a first
// load's frame), T3 (S-44, ruled-not-built) and S5 (the #3469 trade-off: an
// unchanged pass keeps its stale tail until the flush's verdict).
import { afterEach, describe, expect, it } from "vitest";
import {
  action,
  createEffect,
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  refresh,
  resetErrorHalt,
  untrack
} from "../src/index.js";
import { dirtyQueue } from "../src/core/scheduler.js";

const settle = async () => {
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flush();
  }
};
const cleanup: (() => void)[] = [];
afterEach(async () => {
  resetErrorHalt();
  for (const c of cleanup.splice(0)) c();
  await settle();
  resetErrorHalt();
});
const root = <T>(build: () => T): T => {
  let out!: T;
  cleanup.push(createRoot(d => ((out = build()), d)));
  return out;
};
const noop = () => {};

// ───────────────────────────── sync core (heap + marking) ─────────────────────────────

describe("sync", () => {
  it("S0 stale CHECK: a mark left by an earlier flush stops the next flush's marking", () => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    const runs: number[] = [];
    root(() => {
      let m5: () => number;
      createRenderEffect(() => (runs.push(a() ? m5() : 0), runs.at(-1)), noop);
      const m3 = createMemo(() => ((b() ? a() : 0) ? 0 : 1));
      const m4 = createMemo(() => m3());
      m5 = createMemo(() => m4() + b());
    });
    flush();
    setB(2);
    flush();
    runs.length = 0;
    setA(1);
    flush();
    expect(runs).toEqual([2]); // [3, 2]: the effect reads m5 = 3 (stale), then re-runs
  });

  it("S1 a reader of a memo that reads its own child sees the pre-update value", () => {
    const [a, setA] = createSignal(0);
    const runs: number[] = [];
    root(() => {
      const m1 = createMemo(() => a());
      const m2 = createMemo(() => createMemo(() => m1())());
      createRenderEffect(() => (runs.push(a() + m2()), runs.at(-1)), noop);
    });
    flush();
    runs.length = 0;
    setA(1);
    flush();
    expect(runs).toEqual([2]); // [1, 2]: a = 1 beside m2 = 0
  });

  it("S2 the dirty heap is empty after a flush (benign as far as known)", () => {
    const [a, setA] = createSignal(0);
    root(() => {
      let m3: (() => number) | undefined;
      const m1 = createMemo(() => ((m3 ? m3() : 0) ? 0 : a() ? 1 : 0));
      createMemo(() => createMemo(() => m1())());
      m3 = createMemo(() => a());
    });
    flush();
    setA(2);
    flush();
    expect(dirtyQueue._heap.filter(Boolean)).toEqual([]); // one node left in bucket 2
  });

  it("S3 a child created before a flush does not run before the owner that disposes it", () => {
    const [a, setA] = createSignal(0);
    const childRuns: number[] = [];
    const m1 = root(() => createMemo(() => a()));
    flush();
    setA(2);
    root(() =>
      createRenderEffect(() => (a() ? 0 : (createMemo(() => childRuns.push(a())), m1())), noop)
    );
    childRuns.length = 0;
    flush();
    expect(childRuns).toEqual([]); // [2]: the child runs with a = 2, a state its owner creates no child in
  });

  it("S4 an owned write to the dependency a memo just read re-runs the memo", () => {
    const [a, setA] = createSignal(0, { ownedWrite: true });
    const m1 = root(() => {
      const m = createMemo(() => (a() ? (setA(0), 0) : 7));
      createRenderEffect(() => m(), noop);
      return m;
    });
    flush();
    setA(1);
    flush();
    expect([untrack(a), untrack(m1)]).toEqual([0, 7]); // [0, 0]: wrong value after the flush
  });

  it.fails(
    "S5 a memo pulled early does not re-run for a dependency it no longer reads (perf only)",
    () => {
      const [a, setA] = createSignal(0);
      let m4runs = 0;
      root(() => {
        let m4: () => number;
        createRenderEffect(() => (a() ? m4() : 0), noop);
        const m2 = createMemo(() => a());
        const m3 = createMemo(() => (a() ? 1 : 0));
        m4 = createMemo(() => (m4runs++, m2() ? 0 : m3()));
      });
      flush();
      m4runs = 0;
      setA(1);
      flush();
      expect(m4runs).toBe(1); // 2
    }
  );
});

// ───────────────────────────── async (holds, verdicts, errors) ─────────────────────────────

/** Async memos are `fetch(src)`: a request asking `q` answers `q + 1 + 10 * epoch`, or rejects with Error(q + 1). */
function world() {
  type Req = {
    name: string;
    q: number;
    e: number;
    res: (v: number) => void;
    rej: (e: Error) => void;
    done: boolean;
  };
  const reqs: Req[] = [];
  const epochs: Record<string, number> = {};
  const asks: string[] = [];
  const shown: Record<string, unknown> = {};
  const w = {
    asks,
    shown,
    fetcher: (name: string, src: () => number) =>
      createMemo(() => {
        const q = src();
        asks.push(`${name}?${q}`);
        const p = new Promise<number>((res, rej) =>
          reqs.push({ name, q, e: epochs[name] ?? 0, res, rej, done: false })
        );
        p.catch(noop);
        return p;
      }) as () => number,
    show: (name: string, fn: () => unknown) => createRenderEffect(fn, v => void (shown[name] = v)),
    errored: (fn: () => unknown) =>
      untrack(() => createErrorBoundary(fn, e => "X" + (e() as Error).message)),
    loading: (fn: () => unknown) => untrack(() => createLoadingBoundary(fn, () => "F")),
    async mount<T>(build: () => T): Promise<T> {
      const out = root(build);
      flush();
      await settle();
      return out;
    },
    async land(name: string, q: number, ok = true) {
      const r = reqs.find(r => !r.done && r.name === name && r.q === q);
      if (!r) throw new Error(`no outstanding ${name}?${q}; asked ${asks.join(",")}`);
      r.done = true;
      ok ? r.res(q + 1 + 10 * r.e) : r.rej(new Error(String(q + 1)));
      await settle();
    },
    async write(set: (v: number) => void, ...vs: number[]) {
      for (const v of vs) set(v);
      flush();
      await settle();
    },
    async reask(name: string, node: any) {
      epochs[name] = (epochs[name] ?? 0) + 1;
      (refresh(node) as Promise<unknown>).catch(noop);
      flush();
      await settle();
    }
  };
  return w;
}
const pend = (...fns: (() => unknown)[]) => fns.map(f => isPending(f));
const tryLatest = (fn: () => unknown) => {
  try {
    return latest(fn);
  } catch (e: any) {
    return `throws ${e?.constructor?.name}`;
  }
};

describe("async", () => {
  it("K1b a same-tick batch that nets to the committed value re-asks and pends nothing (D-8)", async () => {
    const w = world();
    const { A, setS } = await w.mount(() => {
      const [s, setS] = createSignal(0);
      const A = w.fetcher("A", s);
      w.show("A", A);
      return { A, setS };
    });
    await w.land("A", 0);
    await w.write(setS, 1, 0);
    expect({ asks: w.asks, pending: isPending(A) }).toEqual({ asks: ["A?0"], pending: false });
    // asks ["A?0","A?0"], pending true
  });

  it("K1b (held) a batch that nets to the held value keeps the flight already asking it (F-2, D-8)", async () => {
    const w = world();
    const setS = await w.mount(() => {
      const [s, setS] = createSignal(0);
      const A = w.fetcher("A", s);
      w.show("s", s);
      w.show("A", A);
      return setS;
    });
    await w.land("A", 0);
    await w.write(setS, 1); // held on A?1
    await w.write(setS, 2, 1);
    await w.land("A", 1);
    expect({ asks: w.asks, shown: w.shown }).toEqual({
      asks: ["A?0", "A?1"],
      shown: { s: 1, A: 2 }
    });
    // asks [A?0,A?1,A?1], shown {s:0, A:1}: the landed answer is discarded
  });

  it("K1 an input moved back to its committed value is not a new question (A24, A19 exc. 2)", async () => {
    const w = world();
    const { s, A, setS } = await w.mount(() => {
      const [s, setS] = createSignal(0);
      const A = w.fetcher("A", s);
      w.show("A", A);
      w.show("s", s);
      return { s, A, setS };
    });
    await w.land("A", 0);
    await w.write(setS, 1); // held on A?1
    await w.write(setS, 0);
    expect(w.shown).toEqual({ A: 1, s: 0 });
    expect(pend(s, A)).toEqual([false, false]); // [false, true]
  });

  it("K1 (monotone) a memo over a pending node is pending (A24 (2))", async () => {
    const w = world();
    const { A, B, S, setT } = await w.mount(() => {
      const [s] = createSignal(0);
      const [t, setT] = createSignal(0);
      const A = w.fetcher("A", s);
      const B = w.fetcher("B", t);
      const S = createMemo(() => A() + B());
      w.show("S", S);
      return { A, B, S, setT };
    });
    await w.land("A", 0);
    await w.land("B", 0);
    await w.write(setT, 1);
    await w.reask("A", A);
    await w.land("B", 1);
    await w.write(setT, 0);
    const [pB, pS] = pend(B, S);
    expect({ pB, pS }).toEqual({ pB, pS: pB }); // pB true, pS false
  });

  it("K3 latest() of a never-committed node keeps a held answer when re-asked (D-22)", async () => {
    const w = world();
    const { A, setS } = await w.mount(() => {
      const [s, setS] = createSignal(0);
      const A = w.fetcher("A", s);
      const B = w.fetcher("B", A);
      w.show("s", s);
      w.show("B", B);
      return { A, setS };
    });
    await w.land("A", 0); // held for B's first load
    expect(tryLatest(A)).toBe(1);
    await w.write(setS, 1);
    expect(tryLatest(A)).toBe(1); // throws NotReadyError
  });

  it("K4 refresh() of a node whose new answer is held does not launder its verdict (A19 (iii))", async () => {
    const w = world();
    const { s, A, B, setS } = await w.mount(() => {
      const [s, setS] = createSignal(0);
      const A = w.fetcher("A", s);
      const B = w.fetcher("B", A);
      w.show("s", s);
      w.show("B", B);
      return { s, A, B, setS };
    });
    await w.land("A", 0);
    await w.land("B", 1);
    await w.write(setS, 1);
    await w.land("A", 1); // lands into the hold; B re-asks
    expect(pend(s, A, B)).toEqual([true, true, true]);
    await w.reask("A", A);
    expect(pend(s, A, B)).toEqual([true, true, true]); // [true, false, true]
  });

  it("K4 (memo) a refresh elsewhere does not launder a held new question of a sum", async () => {
    const w = world();
    const { s, B, S, setS } = await w.mount(() => {
      const [s, setS] = createSignal(0);
      const [t] = createSignal(0);
      const A = w.fetcher("A", s);
      const B = w.fetcher("B", t);
      const S = createMemo(() => A() + B());
      w.show("S", S);
      return { s, B, S, setS };
    });
    await w.land("A", 0);
    await w.land("B", 0);
    await w.write(setS, 1);
    await w.reask("B", B);
    await w.land("A", 1); // held while B's re-ask is out
    expect(w.shown.S).toBe(2);
    expect(pend(s, S)).toEqual([true, true]); // [true, false]
  });

  it.fails(
    "K2 a write during a first load is held alike for a direct read and a read through a memo (F-1, F-2)",
    async () => {
      const run = async (viaMemo: boolean) => {
        const w = world();
        const setS = await w.mount(() => {
          const [s, setS] = createSignal(0);
          const A = w.fetcher("A", s);
          const M = viaMemo ? createMemo(() => A()) : A;
          w.show("s", s);
          w.show("A", M);
          return setS;
        });
        await w.write(setS, 1);
        return w.shown.s;
      };
      expect(await run(true)).toBe(await run(false)); // 1 through the memo, 0 direct
    }
  );

  /** A = fetch(s) shown through an error boundary; `s` shown outside it; error fallback up; then s := 5. */
  const errorShown = async (wrap: "E" | "L>E", firstLoadFails: boolean) => {
    const w = world();
    const setS = await w.mount(() => {
      const [s, setS] = createSignal(0);
      const A = w.fetcher("A", s);
      const view = wrap === "E" ? w.errored(A) : w.loading(() => w.errored(A)());
      w.show("A", view);
      w.show("s", s);
      return setS;
    });
    if (firstLoadFails) await w.land("A", 0, false);
    else {
      await w.land("A", 0);
      await w.write(setS, 1);
      await w.land("A", 1, false);
    }
    await w.write(setS, 5);
    return w.shown;
  };

  it("E1 a write publishes beside a shown error fallback: error after a good value (D-39, F-3, F-12)", async () => {
    expect(await errorShown("E", false)).toEqual({ A: "X2", s: 5 }); // s: 1
  });
  it("E1 … first load failed (D-39)", async () => {
    expect(await errorShown("E", true)).toEqual({ A: "X1", s: 5 }); // s: 0
  });
  it("E1 … error boundary inside a shown Loading (F-5, F-3)", async () => {
    expect(await errorShown("L>E", false)).toEqual({ A: "X2", s: 5 }); // s: 1
  });

  it.fails(
    "E2 a first load's rejection waits for its mount frame as its value does (D-41)",
    async () => {
      const run = async (ok: boolean) => {
        const w = world();
        await w.mount(() => {
          const [s] = createSignal(0);
          w.show("A", w.errored(w.fetcher("A", s)));
          w.show("B", w.errored(w.fetcher("B", s)));
        });
        await w.land("A", 0, ok); // B's first load is still out
        return w.shown.A;
      };
      expect(await run(false)).toBe(await run(true)); // "X1" at once vs nothing shown yet
    }
  );
});

// ───────────────────────────── transitions (actions, optimistic) ─────────────────────────────

/** `A = fetch(a)` answers `q + 100` or rejects `E<q>`; only a user effect reads it. */
function tx(readsA: "a:A" | "A") {
  const reqs: { q: number; res: () => void; rej: () => void }[] = [];
  const log: string[] = [];
  const [a, setA] = createSignal(0);
  let A!: () => number;
  const dispose = createRoot(d => {
    A = createMemo(() => {
      const q = a();
      return new Promise<number>((res, rej) =>
        reqs.push({ q, res: () => res(q + 100), rej: () => rej(new Error(`E${q}`)) })
      );
    });
    if (readsA === "a:A")
      createEffect(
        () => `${a()}:${A()}`,
        (v: string) => void log.push(v)
      );
    else
      createEffect(() => A(), {
        effect: (v: number) => void log.push(`value ${v}`),
        error: (e: any) => void log.push(`error ${e?.message}`)
      } as any);
    return d;
  });
  cleanup.push(() => {
    for (const r of reqs.splice(0)) r.res();
    dispose();
  });
  flush();
  return {
    a,
    A,
    setA,
    log,
    async answer(q: number, ok = true) {
      const r = reqs.find(r => r.q === q)!;
      reqs.splice(reqs.indexOf(r), 1);
      ok ? r.res() : r.rej();
      await settle();
    },
    probe() {
      try {
        return String(latest(A));
      } catch (e: any) {
        return `throws ${e?.message}`;
      }
    }
  };
}
/** Starts an action that runs `before`, waits at a yield until released, then runs `after`. */
function hold(before: () => void, after: () => void = noop) {
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const done = action(function* () {
    before();
    yield gate;
    after();
  })();
  flush();
  return { release, done };
}

describe("transitions", () => {
  // T1: an action writes a = 1; A(1) lands into the hold; a = 3 joins the hold; the hold commits
  // with A(3) in flight (F-2 amended 2026-11-12, F-1 / D-29).
  for (const second of ["body", "mainline", "action"] as const)
    it(`T1 a commit does not show the answer to a superseded question (second write: ${second})`, async () => {
      const g = tx("a:A");
      await g.answer(0);
      const h = hold(
        () => g.setA(1),
        () => second === "body" && g.setA(3)
      );
      await g.answer(1);
      let h2: ReturnType<typeof hold> | undefined;
      if (second === "mainline") (g.setA(3), flush());
      if (second === "action") h2 = hold(() => g.setA(3));
      h.release();
      await settle();
      h2?.release();
      await settle();
      expect(g.a()).toBe(3);
      expect(g.A()).not.toBe(101); // 101 beside a = 3
      expect(g.log.filter(v => v.startsWith("1:"))).toEqual([]); // ["1:101"]: a never committed 1
    });

  it("T1 (memo) no effect run sees S = 1000 * A + b of a world that never committed", async () => {
    const reqs: { q: number; res: () => void }[] = [];
    const seen: number[] = [];
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    const dispose = createRoot(d => {
      const A = createMemo(() => {
        const q = a();
        return new Promise<number>(res => reqs.push({ q, res: () => res(q + 100) }));
      });
      const S = createMemo(() => 1000 * A() + b());
      createEffect(
        () => S(),
        (v: number) => void seen.push(v)
      );
      return d;
    });
    cleanup.push(() => (reqs.forEach(r => r.res()), dispose()));
    flush();
    reqs.shift()!.res();
    await settle();
    const h = hold(() => setB(1));
    setA(3);
    flush();
    h.release();
    await settle();
    expect([a(), b()]).toEqual([3, 1]);
    expect(seen).toEqual([100000]); // [100000, 100001]: S of (a = 0, b = 1)
  });

  it("T2 latest() stays on a committed error while the next question is in flight (D-22, D-41)", async () => {
    const g = tx("A");
    await g.answer(0);
    g.setA(1);
    flush();
    await g.answer(1, false);
    expect([g.log.at(-1), g.probe()]).toEqual(["error E1", "throws E1"]);
    g.setA(2);
    flush();
    expect(g.probe()).toBe("throws E1"); // "100": the answer older than the error
  });

  it("T2 (held) a staged error stays the newest answer when the question moves again in the hold", async () => {
    const g = tx("A");
    await g.answer(0);
    const h = hold(() => g.setA(1));
    await g.answer(1, false);
    expect(g.probe()).toBe("throws E1");
    g.setA(3);
    flush();
    expect(g.probe()).toBe("throws E1"); // "100" (a staged value in this position is kept)
    h.release();
    await settle();
  });

  it.fails(
    "T3 two mainline writes to a guessed node's sync source are held alike (D-34, S-44)",
    async () => {
      const ra: number[] = [];
      const [a, setA] = createSignal(0);
      const setO = root(() => {
        const [o, setO] = createOptimistic(() => a()) as any;
        createRenderEffect(
          () => a(),
          v => void ra.push(v)
        );
        createRenderEffect(() => o(), noop);
        return setO as (v: number) => void;
      });
      flush();
      const h = hold(() => setO(1));
      cleanup.unshift(h.release);
      const state = () => ({ shown: ra.at(-1), latest: latest(a), pending: isPending(a) });
      setA(3);
      flush();
      const first = state();
      setA(4);
      flush();
      const second = state();
      expect([first, second]).toEqual([
        { shown: 0, latest: 3, pending: true }, // { shown: 3, latest: 3, pending: false }: escapes the hold
        { shown: 0, latest: 4, pending: true } // { shown: 3, latest: 4, pending: true }: joins it
      ]);
    }
  );
});
