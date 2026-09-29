/**
 * createDeferred — an async memo that may lag the global clock, but never
 * leads it (docs/create-deferred.md, propositions D1–D10).
 *
 * Once initialized, the node's own non-finality is invisible to the graph:
 * readers are served the committed value during a refetch (no NotReadyError,
 * no transition hold, no async reporter), while `isPending` stays loud. The
 * landing commits on the plain path — ambient when the flight was asked
 * against committed inputs, joining the input's hold when it was asked against
 * a staged write that a sibling turned into a transition (never leads).
 */
import {
  action,
  createDeferred,
  createEffect,
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  refresh,
  until,
  type SourceAccessor
} from "../src/index.js";

afterEach(() => flush());

const tick = () => new Promise<void>(r => setTimeout(r, 0));
async function settle(rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await tick();
    flush();
  }
}

/** A fetcher whose flights resolve only when told to, keyed by argument. */
function deferredFetcher<A, T>(compute: (arg: A) => T) {
  const pending = new Map<A, { resolve: () => void; reject: (e: unknown) => void }>();
  return {
    fetch(arg: A): Promise<T> {
      return new Promise<T>((res, rej) => {
        pending.set(arg, { resolve: () => res(compute(arg)), reject: rej });
      });
    },
    resolve(arg: A) {
      pending.get(arg)!.resolve();
      pending.delete(arg);
    },
    reject(arg: A, e: unknown) {
      pending.get(arg)!.reject(e);
      pending.delete(arg);
    },
    inFlight() {
      return [...pending.keys()];
    }
  };
}

describe("createDeferred", () => {
  describe("D5 — first load is loading, not pending", () => {
    it("suspends readers to the nearest Loading boundary until the first landing", async () => {
      const fetcher = deferredFetcher((n: number) => `rows-${n}`);
      const [period, setPeriod] = createSignal(1);
      let slot: string | undefined;
      createRoot(() => {
        const rows = createDeferred(() => fetcher.fetch(period()));
        const view = createLoadingBoundary(
          () => rows(),
          () => "loading"
        );
        createRenderEffect(view, v => {
          slot = v;
        });
      });
      flush();
      expect(slot).toBe("loading");
      // Uninitialized: loading-class, not pending.
      fetcher.resolve(1);
      await settle();
      expect(slot).toBe("rows-1");
      void setPeriod;
    });
  });

  describe("D1/D4 — an initialized node serves committed truth during a refetch and reports pending", () => {
    it("readers keep the committed value, the render effect does not re-run, isPending is loud, the landing commits", async () => {
      const fetcher = deferredFetcher((n: number) => `rows-${n}`);
      const [period, setPeriod] = createSignal(1);
      const log: string[] = [];
      const pendingLog: boolean[] = [];
      let rows!: () => string;
      createRoot(() => {
        rows = createDeferred(() => fetcher.fetch(period()));
        createRenderEffect(rows, v => {
          log.push(v);
        });
        createRenderEffect(
          () => isPending(rows),
          v => {
            pendingLog.push(v);
          }
        );
      });
      flush();
      fetcher.resolve(1);
      await settle();
      expect(log).toEqual(["rows-1"]);
      expect(pendingLog).toEqual([false]);

      setPeriod(2);
      flush();
      // No suspension, no hold: the committed value keeps serving...
      expect(rows()).toBe("rows-1");
      expect(log).toEqual(["rows-1"]);
      // ...and the verdict is loud.
      expect(isPending(rows)).toBe(true);
      expect(pendingLog).toEqual([false, true]);
      // The write to the input committed immediately — nobody held it.
      expect(period()).toBe(2);
      expect(isPending(period)).toBe(false);

      fetcher.resolve(2);
      await settle();
      expect(rows()).toBe("rows-2");
      expect(log).toEqual(["rows-1", "rows-2"]);
      expect(isPending(rows)).toBe(false);
      expect(pendingLog).toEqual([false, true, false]);
    });

    it("the originating report: independent panels land on their own schedule", async () => {
      const fast = deferredFetcher((n: number) => `fast-${n}`);
      const slow = deferredFetcher((n: number) => `slow-${n}`);
      const [period, setPeriod] = createSignal(1);
      let fastSlot: string | undefined, slowSlot: string | undefined, label: number | undefined;
      createRoot(() => {
        const fastRows = createDeferred(() => fast.fetch(period()));
        const slowRows = createDeferred(() => slow.fetch(period()));
        createRenderEffect(period, v => {
          label = v;
        });
        createRenderEffect(fastRows, v => {
          fastSlot = v;
        });
        createRenderEffect(slowRows, v => {
          slowSlot = v;
        });
      });
      flush();
      fast.resolve(1);
      slow.resolve(1);
      await settle();
      expect([label, fastSlot, slowSlot]).toEqual([1, "fast-1", "slow-1"]);

      setPeriod(2);
      flush();
      // The selector flips at once; both panels show their previous answer.
      expect([label, fastSlot, slowSlot]).toEqual([2, "fast-1", "slow-1"]);

      fast.resolve(2);
      await settle();
      // The fast panel is not hostage to the slow one.
      expect([label, fastSlot, slowSlot]).toEqual([2, "fast-2", "slow-1"]);

      slow.resolve(2);
      await settle();
      expect([label, fastSlot, slowSlot]).toEqual([2, "fast-2", "slow-2"]);
    });
  });

  describe("D3 — a landing during an unrelated incomplete transition commits", () => {
    it("the deferred consumer repaints while the theme transition is still held", async () => {
      const images = deferredFetcher((t: string) => `img-${t}`);
      const rowsFetcher = deferredFetcher((n: number) => `rows-${n}`);
      const [theme, setTheme] = createSignal("light");
      const [period, setPeriod] = createSignal(1);
      let themeSlot: string | undefined, imgSlot: string | undefined, rowsSlot: string | undefined;
      createRoot(() => {
        // A plain async memo derived from theme: its render effect reports,
        // so a theme change opens a transition that waits for the image.
        const themedImage = createMemo(() => images.fetch(theme()));
        const rows = createDeferred(() => rowsFetcher.fetch(period()));
        createRenderEffect(theme, v => {
          themeSlot = v;
        });
        createRenderEffect(themedImage, v => {
          imgSlot = v;
        });
        createRenderEffect(rows, v => {
          rowsSlot = v;
        });
      });
      flush();
      images.resolve("light");
      rowsFetcher.resolve(1);
      await settle();
      expect([themeSlot, imgSlot, rowsSlot]).toEqual(["light", "img-light", "rows-1"]);

      // Start the deferred refetch first, against committed inputs.
      setPeriod(2);
      flush();
      expect(rowsSlot).toBe("rows-1");

      // Now the theme switch: held on the image.
      setTheme("dark");
      flush();
      expect([themeSlot, imgSlot]).toEqual(["light", "img-light"]);
      expect(isPending(theme)).toBe(true);

      // The panel's landing arrives while the theme is held: it commits.
      rowsFetcher.resolve(2);
      await settle();
      expect(rowsSlot).toBe("rows-2");
      expect([themeSlot, imgSlot]).toEqual(["light", "img-light"]);
      expect(isPending(theme)).toBe(true);

      images.resolve("dark");
      await settle();
      expect([themeSlot, imgSlot, rowsSlot]).toEqual(["dark", "img-dark", "rows-2"]);
    });
  });

  describe("D2 — never leads", () => {
    it("a flight asked against a write a sibling holds reveals with that write, never ahead of it", async () => {
      const summaryFetcher = deferredFetcher((n: number) => `summary-${n}`);
      const rowsFetcher = deferredFetcher((n: number) => `rows-${n}`);
      const [period, setPeriod] = createSignal(1);
      let label: number | undefined, summarySlot: string | undefined, rowsSlot: string | undefined;
      createRoot(() => {
        // The plain sibling holds the period write; the deferred panel does not.
        const summary = createMemo(() => summaryFetcher.fetch(period()));
        const rows = createDeferred(() => rowsFetcher.fetch(period()));
        createRenderEffect(period, v => {
          label = v;
        });
        createRenderEffect(summary, v => {
          summarySlot = v;
        });
        createRenderEffect(rows, v => {
          rowsSlot = v;
        });
      });
      flush();
      summaryFetcher.resolve(1);
      rowsFetcher.resolve(1);
      await settle();
      expect([label, summarySlot, rowsSlot]).toEqual([1, "summary-1", "rows-1"]);

      setPeriod(2);
      flush();
      // The sibling holds the write. The deferred panel serves stale and does
      // not add to what the transition waits for.
      expect([label, summarySlot, rowsSlot]).toEqual([1, "summary-1", "rows-1"]);
      expect(isPending(period)).toBe(true);

      // The deferred flight lands FIRST. Its answer is for period 2, which is
      // still held — showing it beside label 1 would lead the clock.
      rowsFetcher.resolve(2);
      await settle();
      expect([label, summarySlot, rowsSlot]).toEqual([1, "summary-1", "rows-1"]);

      // The sibling lands: everything reveals together.
      summaryFetcher.resolve(2);
      await settle();
      expect([label, summarySlot, rowsSlot]).toEqual([2, "summary-2", "rows-2"]);
    });

    it("the transition does not wait for the deferred flight: the sibling landing reveals the write, the panel follows", async () => {
      const summaryFetcher = deferredFetcher((n: number) => `summary-${n}`);
      const rowsFetcher = deferredFetcher((n: number) => `rows-${n}`);
      const [period, setPeriod] = createSignal(1);
      let label: number | undefined, summarySlot: string | undefined, rowsSlot: string | undefined;
      let rows!: () => string;
      createRoot(() => {
        const summary = createMemo(() => summaryFetcher.fetch(period()));
        rows = createDeferred(() => rowsFetcher.fetch(period()));
        createRenderEffect(period, v => {
          label = v;
        });
        createRenderEffect(summary, v => {
          summarySlot = v;
        });
        createRenderEffect(rows, v => {
          rowsSlot = v;
        });
      });
      flush();
      summaryFetcher.resolve(1);
      rowsFetcher.resolve(1);
      await settle();

      setPeriod(2);
      flush();
      // Sibling lands while the deferred panel is still in flight.
      summaryFetcher.resolve(2);
      await settle();
      expect([label, summarySlot, rowsSlot]).toEqual([2, "summary-2", "rows-1"]);
      expect(isPending(rows)).toBe(true);

      rowsFetcher.resolve(2);
      await settle();
      expect([label, summarySlot, rowsSlot]).toEqual([2, "summary-2", "rows-2"]);
      expect(isPending(rows)).toBe(false);
    });
  });

  describe("create-deferred.md 8.1 — isPending through derivations of a deferred node", () => {
    it("a sync memo over the deferred node reads pending during the refetch without re-running", async () => {
      const fetcher = deferredFetcher((n: number) => Array.from({ length: n }, (_, i) => i));
      const [n, setN] = createSignal(2);
      let count!: () => number;
      let runs = 0;
      createRoot(() => {
        const rows = createDeferred(() => fetcher.fetch(n()));
        count = createMemo(() => (runs++, rows().length));
      });
      flush();
      fetcher.resolve(2);
      await settle();
      expect(count()).toBe(2);
      expect(isPending(count)).toBe(false);
      const runsAfterLanding = runs;

      setN(3);
      flush();
      expect(count()).toBe(2);
      expect(runs).toBe(runsAfterLanding);
      expect(isPending(count)).toBe(true);

      fetcher.resolve(3);
      await settle();
      expect(count()).toBe(3);
      expect(isPending(count)).toBe(false);
    });

    it("a derived store over the deferred node reads pending at its leaves", async () => {
      const fetcher = deferredFetcher((n: number) => ({
        items: Array.from({ length: n }, (_, i) => i)
      }));
      const [n, setN] = createSignal(2);
      let store!: { items: number[] };
      createRoot(() => {
        const rows = createDeferred(() => fetcher.fetch(n()));
        [store] = createStore(() => rows(), { items: [] as number[] });
      });
      flush();
      fetcher.resolve(2);
      await settle();
      expect(store.items.length).toBe(2);
      expect(isPending(() => store.items.length)).toBe(false);

      setN(3);
      flush();
      expect(store.items.length).toBe(2);
      expect(isPending(() => store.items.length)).toBe(true);

      fetcher.resolve(3);
      await settle();
      expect(store.items.length).toBe(3);
      expect(isPending(() => store.items.length)).toBe(false);
    });

    it("a landing equal to the committed value still clears the verdict downstream", async () => {
      const fetcher = deferredFetcher((n: number) => "same");
      const [n, setN] = createSignal(1);
      let upper!: () => string;
      createRoot(() => {
        const rows = createDeferred(() => fetcher.fetch(n()));
        upper = createMemo(() => rows().toUpperCase());
      });
      flush();
      fetcher.resolve(1);
      await settle();
      expect(upper()).toBe("SAME");

      setN(2);
      flush();
      expect(isPending(upper)).toBe(true);
      fetcher.resolve(2);
      await settle();
      expect(upper()).toBe("SAME");
      expect(isPending(upper)).toBe(false);
    });
  });

  describe("D9 — authoritative readers bypass the clamp", () => {
    it("await refresh(d) resolves with the landed value, not the served stale one", async () => {
      let calls = 0;
      const fetcher = deferredFetcher((_: number) => `answer-${++calls}`);
      let rows!: SourceAccessor<string>;
      createRoot(() => {
        rows = createDeferred(() => fetcher.fetch(0));
      });
      flush();
      fetcher.resolve(0);
      await settle();
      expect(rows()).toBe("answer-1");

      let resolved: string | undefined;
      const p = refresh(rows).then(v => (resolved = v));
      await settle();
      // The re-ask is in flight: ordinary readers still see the stale answer,
      // and the waiter has NOT resolved with it.
      expect(rows()).toBe("answer-1");
      expect(resolved).toBeUndefined();

      fetcher.resolve(0);
      await settle();
      await p;
      expect(resolved).toBe("answer-2");
      expect(rows()).toBe("answer-2");
    });

    it("until(() => d()) evaluates only settled truth", async () => {
      const fetcher = deferredFetcher((n: number) => n);
      const [n, setN] = createSignal(1);
      let rows!: () => number;
      createRoot(() => {
        rows = createDeferred(() => fetcher.fetch(n()));
      });
      flush();
      fetcher.resolve(1);
      await settle();

      setN(5);
      flush();
      let result: number | undefined;
      const p = until(() => rows() >= 5).then(() => (result = rows()));
      await settle();
      // Stale truth (1) must not be evaluated as the answer; the predicate parks.
      expect(result).toBeUndefined();
      fetcher.resolve(5);
      await settle();
      await p;
      expect(result).toBe(5);
    });

    // The flight is asked against the action's own staged write, so it is
    // stamped with the action's transaction and its landing is held by it
    // (D2). The transaction waits on the action, the action on until(): the
    // predicate must accept the staged answer or the three deadlock.
    for (const form of ["direct", "derived"] as const) {
      it(`until(() => ${form === "direct" ? "d()" : "derived()"}) yielded from the action whose write asked the flight settles on the held answer`, async () => {
        const fetcher = deferredFetcher((n: number) => n);
        const [n, setN] = createSignal(1);
        let rows!: () => number;
        let read!: () => number;
        createRoot(() => {
          rows = createDeferred(() => fetcher.fetch(n()));
          read = form === "direct" ? rows : createMemo(() => rows() * 10);
        });
        flush();
        fetcher.resolve(1);
        await settle();
        const target = form === "direct" ? 5 : 50;

        let seen: number | undefined;
        let done = false;
        const act = action(function* () {
          setN(5);
          // Truthy on the stale value too: only parking on the flight makes
          // the delivered value the landed one.
          seen = yield until(() => read());
        });
        act().then(() => (done = true));
        await settle();
        // The predicate parks on the unanswered flight; the stale value is
        // not delivered as the answer, and the readers are still served it.
        expect(seen).toBeUndefined();
        expect(done).toBe(false);
        expect(read()).toBe(form === "direct" ? 1 : 10);

        fetcher.resolve(5);
        await settle();
        expect(seen).toBe(target);
        expect(done).toBe(true);
        expect(n()).toBe(5);
        expect(read()).toBe(target);
      });
    }

    it("refresh(d) is a quiet re-ask: isPending stays false while the waiter still parks (A24)", async () => {
      let calls = 0;
      const fetcher = deferredFetcher((_: number) => `answer-${++calls}`);
      let rows!: SourceAccessor<string>;
      createRoot(() => {
        rows = createDeferred(() => fetcher.fetch(0));
      });
      flush();
      fetcher.resolve(0);
      await settle();

      const p = refresh(rows);
      await settle();
      expect(isPending(rows)).toBe(false);
      fetcher.resolve(0);
      await settle();
      expect(await p).toBe("answer-2");
    });
  });

  describe("D6 — errors propagate", () => {
    it("a rejected refetch throws to the error boundary; the stale value does not mask it", async () => {
      const fetcher = deferredFetcher((n: number) => `rows-${n}`);
      const [n, setN] = createSignal(1);
      let slot: string | undefined;
      createRoot(() => {
        const rows = createDeferred(() => fetcher.fetch(n()));
        const view = createErrorBoundary(
          () => rows(),
          e => `error:${(e() as Error).message}`
        );
        createRenderEffect(view, v => {
          slot = v;
        });
      });
      flush();
      fetcher.resolve(1);
      await settle();
      expect(slot).toBe("rows-1");

      setN(2);
      flush();
      expect(slot).toBe("rows-1");
      fetcher.reject(2, new Error("boom"));
      await settle();
      expect(slot).toBe("error:boom");
    });
  });

  describe("create-deferred.md 2.1 — loadingValue composition", () => {
    it("is born committed, verdict-quiet through the first flight, and loud on refetch", async () => {
      const fetcher = deferredFetcher((n: number) => `rows-${n}`);
      const [n, setN] = createSignal(1);
      let rows!: () => string | undefined;
      const log: (string | undefined)[] = [];
      createRoot(() => {
        rows = createDeferred(() => fetcher.fetch(n()), { loadingValue: undefined });
        createRenderEffect(rows, v => {
          log.push(v);
        });
      });
      flush();
      expect(log).toEqual([undefined]);
      expect(isPending(rows)).toBe(false);

      fetcher.resolve(1);
      await settle();
      expect(log).toEqual([undefined, "rows-1"]);

      setN(2);
      flush();
      expect(rows()).toBe("rows-1");
      expect(isPending(rows)).toBe(true);
      fetcher.resolve(2);
      await settle();
      expect(log).toEqual([undefined, "rows-1", "rows-2"]);
      expect(isPending(rows)).toBe(false);
    });
  });

  describe("D8 — the wrapping form", () => {
    it("createDeferred(() => held()) serves stale while the held memo's other consumers suspend", async () => {
      const fetcher = deferredFetcher((n: number) => `q-${n}`);
      const [n, setN] = createSignal(1);
      let heldSlot: string | undefined, laggedSlot: string | undefined;
      let lagged!: () => string;
      createRoot(() => {
        const query = createMemo(() => fetcher.fetch(n()));
        lagged = createDeferred(() => query());
        createRenderEffect(query, v => {
          heldSlot = v;
        });
        createRenderEffect(lagged, v => {
          laggedSlot = v;
        });
      });
      flush();
      fetcher.resolve(1);
      await settle();
      expect([heldSlot, laggedSlot]).toEqual(["q-1", "q-1"]);

      setN(2);
      flush();
      expect([heldSlot, laggedSlot]).toEqual(["q-1", "q-1"]);
      expect(lagged()).toBe("q-1");
      expect(isPending(lagged)).toBe(true);
      expect(isPending(n)).toBe(true);

      fetcher.resolve(2);
      await settle();
      expect([heldSlot, laggedSlot]).toEqual(["q-2", "q-2"]);
      expect(isPending(lagged)).toBe(false);
    });
  });

  describe("effects and disposal", () => {
    it("a user effect over the deferred node runs once per landing, never for the flight", async () => {
      const fetcher = deferredFetcher((n: number) => `rows-${n}`);
      const [n, setN] = createSignal(1);
      const log: string[] = [];
      createRoot(() => {
        const rows = createDeferred(() => fetcher.fetch(n()));
        createEffect(rows, v => {
          log.push(v);
        });
      });
      flush();
      fetcher.resolve(1);
      await settle();
      setN(2);
      flush();
      await settle();
      expect(log).toEqual(["rows-1"]);
      fetcher.resolve(2);
      await settle();
      expect(log).toEqual(["rows-1", "rows-2"]);
    });

    it("a superseded flight's landing is dropped; the newest wins", async () => {
      const fetcher = deferredFetcher((n: number) => `rows-${n}`);
      const [n, setN] = createSignal(1);
      let rows!: () => string;
      createRoot(() => {
        rows = createDeferred(() => fetcher.fetch(n()));
      });
      flush();
      fetcher.resolve(1);
      await settle();

      setN(2);
      flush();
      setN(3);
      flush();
      expect(isPending(rows)).toBe(true);
      fetcher.resolve(2);
      await settle();
      expect(rows()).toBe("rows-1");
      expect(isPending(rows)).toBe(true);
      fetcher.resolve(3);
      await settle();
      expect(rows()).toBe("rows-3");
      expect(isPending(rows)).toBe(false);
    });
  });

  describe("create-deferred.md 8.2 — a landing during an in-flight optimistic action", () => {
    it("a consumer of both keeps the override (A17) and never flashes the committed value; the other consumer repaints now", async () => {
      const fetcher = deferredFetcher((n: number) => `rows-${n}`);
      const [n, setN] = createSignal(1);
      const [$toggled, setToggled] = createOptimistic(false);
      const rowA: string[] = [];
      const rowB: string[] = [];
      createRoot(() => {
        const rows = createDeferred(() => fetcher.fetch(n()));
        createRenderEffect(
          () => `${rows()}:${$toggled()}`,
          v => {
            rowA.push(v);
          }
        );
        createRenderEffect(rows, v => {
          rowB.push(v);
        });
      });
      flush();
      fetcher.resolve(1);
      await settle();
      expect(rowA).toEqual(["rows-1:false"]);
      expect(rowB).toEqual(["rows-1"]);

      // A refetch is asked, then the user acts optimistically while it flies.
      setN(2);
      flush();
      let finish!: () => void;
      const act = action(function* () {
        setToggled(true);
        yield new Promise<void>(r => (finish = r));
      });
      act();
      flush();
      expect(rowA).toEqual(["rows-1:false", "rows-1:true"]);

      // The landing arrives mid-action: an ambient commit, no lane.
      fetcher.resolve(2);
      await settle();
      // B is independent of the action: it repaints now.
      expect(rowB).toEqual(["rows-1", "rows-2"]);
      // A repaints now too, and keeps the override: the landing is a plain
      // ambient commit, exactly what a signal write mid-action is — the
      // committed (un-toggled) value never shows while the action runs.
      expect(rowA).toEqual(["rows-1:false", "rows-1:true", "rows-2:true"]);

      finish();
      await settle();
      // The action settles: the override drops over the landed data. (The
      // settle's run count is the lane engine's, identical for a plain signal
      // written mid-action; only the values are pinned here.)
      expect(rowA.slice(3).every(v => v === "rows-2:false")).toBe(true);
      expect(rowA.length).toBeGreaterThan(3);
    });
  });
});
