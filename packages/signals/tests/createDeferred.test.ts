/**
 * createDeferred — an async memo that may lag the global clock, but never
 * leads it (docs/create-deferred.md, propositions D1–D11).
 *
 * Once initialized, the node's own non-finality is invisible to the graph:
 * readers are served the committed value during a refetch (no NotReadyError,
 * no STATUS_PENDING, no frame observing a flight — the flush does not park),
 * while `isPending` stays loud through the `affects()` mark channel (A24).
 * The landing commits on the plain path — ambient when the flight was asked
 * against committed inputs, joining the input's hold when it was asked
 * against a staged write that a sibling's flight parked (never leads: the
 * node is held with the transaction like any pending node of the flush).
 *
 * The first `describe`s are the PR's (#3710), one per proposition; the "L2
 * pins" at the end fix what the hold model adds: the boundary interplay, the
 * flight inside an action, the verdict's display-ahead under a parked flush,
 * the D9 push through unchanged derivations and derived stores, the
 * sync-resolved thenable, disposal, `latest`, and mizulu's #3710 shape (a
 * plain async memo over a deferred node: the common part, the D11 ruling on
 * the playground's real graph, and its limit — a derivation between the
 * held memo and the frame joins by ruling 3, L2-general).
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
  latest,
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

  // ── L2 pins (the hold model) ────────────────────────────────────────────

  describe("L2 — Loading boundary: owns the first load, never sees a refetch (create-deferred.md 5)", () => {
    it("content stays through a refetch — the boundary shows no fallback, isPending is the affordance", async () => {
      const fetcher = deferredFetcher((n: number) => `rows-${n}`);
      const [period, setPeriod] = createSignal(1);
      const log: string[] = [];
      let rows!: () => string;
      createRoot(() => {
        rows = createDeferred(() => fetcher.fetch(period()));
        const view = createLoadingBoundary(
          () => rows(),
          () => "loading"
        );
        createRenderEffect(view, v => {
          log.push(v);
        });
      });
      flush();
      fetcher.resolve(1);
      await settle();
      expect(log).toEqual(["loading", "rows-1"]);

      setPeriod(2);
      flush();
      // No fallback: the node never went pending, so the boundary has
      // nothing to catch (A33 — a boundary collects pending readers; there
      // are none). The write committed.
      expect(log).toEqual(["loading", "rows-1"]);
      expect(period()).toBe(2);
      expect(isPending(rows)).toBe(true);

      fetcher.resolve(2);
      await settle();
      expect(log).toEqual(["loading", "rows-1", "rows-2"]);
      expect(isPending(rows)).toBe(false);
    });

    it("an `on` re-arm is inert for a deferred source: the boundary arms, nothing pends, the content stays", async () => {
      const fetcher = deferredFetcher((n: number) => `rows-${n}`);
      const [period, setPeriod] = createSignal(1);
      const log: string[] = [];
      createRoot(() => {
        const rows = createDeferred(() => fetcher.fetch(period()));
        const view = createLoadingBoundary(
          () => rows(),
          () => "loading",
          { on: () => period() }
        );
        createRenderEffect(view, v => {
          log.push(v);
        });
      });
      flush();
      fetcher.resolve(1);
      await settle();
      expect(log).toEqual(["loading", "rows-1"]);

      setPeriod(2);
      flush();
      // The re-arm would flip to the fallback at the first pending reader
      // under it; a deferred refetch pends nobody (create-deferred.md 5: "a deferred node's
      // refetch never arrives").
      expect(log).toEqual(["loading", "rows-1"]);
      fetcher.resolve(2);
      await settle();
      expect(log).toEqual(["loading", "rows-1", "rows-2"]);
    });
  });

  describe("L2 — inside an action: the flight is the action's work, never ahead of it", () => {
    it("a flight asked by the action's write is held with the action; its landing reveals at the settle", async () => {
      const fetcher = deferredFetcher((n: number) => `rows-${n}`);
      const [period, setPeriod] = createSignal(1);
      let label: number | undefined, rowsSlot: string | undefined;
      let rows!: () => string;
      createRoot(() => {
        rows = createDeferred(() => fetcher.fetch(period()));
        createRenderEffect(period, v => {
          label = v;
        });
        createRenderEffect(rows, v => {
          rowsSlot = v;
        });
      });
      flush();
      fetcher.resolve(1);
      await settle();

      let finish!: () => void;
      const act = action(function* () {
        setPeriod(2);
        yield new Promise<void>(r => (finish = r));
      });
      act();
      await settle();
      // The action holds the write; the panel serves stale and does not
      // suspend the body (nothing holds the action but itself).
      expect([label, rowsSlot]).toEqual([1, "rows-1"]);
      expect(isPending(period)).toBe(true);
      expect(isPending(rows)).toBe(true);

      // The landing arrives mid-action: asked against the held write, it is
      // the action's (D2) — staged under its transaction, nothing moves.
      fetcher.resolve(2);
      await settle();
      expect([label, rowsSlot]).toEqual([1, "rows-1"]);
      // Not final either way: the landed value is held uncommitted (A19 iii).
      expect(isPending(rows)).toBe(true);

      finish();
      await settle();
      expect([label, rowsSlot]).toEqual([2, "rows-2"]);
      expect(isPending(rows)).toBe(false);
      expect(isPending(period)).toBe(false);
    });

    it("the action does not wait for the flight: it settles, the write reveals, the panel follows", async () => {
      const fetcher = deferredFetcher((n: number) => `rows-${n}`);
      const [period, setPeriod] = createSignal(1);
      let label: number | undefined, rowsSlot: string | undefined;
      let rows!: () => string;
      createRoot(() => {
        rows = createDeferred(() => fetcher.fetch(period()));
        createRenderEffect(period, v => {
          label = v;
        });
        createRenderEffect(rows, v => {
          rowsSlot = v;
        });
      });
      flush();
      fetcher.resolve(1);
      await settle();

      let finish!: () => void;
      let done = false;
      const act = action(function* () {
        setPeriod(2);
        yield new Promise<void>(r => (finish = r));
      });
      act().then(() => (done = true));
      await settle();
      finish();
      await settle();
      // The body returned and nothing on screen derives from a flight the
      // transaction holds (`blocked`: a deferred node is never pending), so
      // it lands: the write reveals, the panel still shows its previous answer.
      expect(done).toBe(true);
      expect([label, rowsSlot]).toEqual([2, "rows-1"]);
      expect(isPending(rows)).toBe(true);

      fetcher.resolve(2);
      await settle();
      expect([label, rowsSlot]).toEqual([2, "rows-2"]);
      expect(isPending(rows)).toBe(false);
    });
  });

  describe("L2 — the verdict is display-ahead (ruling 6): a tracked isPending flips while the flush parks", () => {
    it("a render effect on isPending(rows) shows true at once, though a sibling's flight holds the write", async () => {
      const summaryFetcher = deferredFetcher((n: number) => `summary-${n}`);
      const rowsFetcher = deferredFetcher((n: number) => `rows-${n}`);
      const [period, setPeriod] = createSignal(1);
      const pendingLog: boolean[] = [];
      let summarySlot: string | undefined;
      createRoot(() => {
        const summary = createMemo(() => summaryFetcher.fetch(period()));
        const rows = createDeferred(() => rowsFetcher.fetch(period()));
        createRenderEffect(summary, v => {
          summarySlot = v;
        });
        createRenderEffect(
          () => isPending(rows),
          v => {
            pendingLog.push(v);
          }
        );
      });
      flush();
      summaryFetcher.resolve(1);
      rowsFetcher.resolve(1);
      await settle();
      expect(pendingLog).toEqual([false]);

      setPeriod(2);
      flush();
      // The flush parked on `summary`; the verdict reader is the holder's
      // verdict lane's — shown now, not stashed with the frame.
      expect(summarySlot).toBe("summary-1");
      expect(pendingLog).toEqual([false, true]);

      // The panel's landing joins the hold (D2); the verdict stays true
      // through it — the landed value is held uncommitted (A19 iii), and the
      // reader re-derives at the held landing exactly as a plain memo's
      // does (a render effect has no equality gate; the run count is the
      // engine's, the values are pinned here)...
      rowsFetcher.resolve(2);
      await settle();
      expect(pendingLog.every(v => v)).toBe(false);
      expect(pendingLog.slice(1).every(v => v)).toBe(true);
      // ...and flips at the reveal.
      summaryFetcher.resolve(2);
      await settle();
      expect(summarySlot).toBe("summary-2");
      expect(pendingLog.at(-1)).toBe(false);
      expect(pendingLog.filter(v => !v)).toEqual([false, false]);
    });
  });

  describe("L2 — D9's push: the flight's close wakes the readers parked on it", () => {
    it("until(() => derived()) over an unchanged derivation is released by an equal-value landing", async () => {
      // The derivation never re-runs (the landing equals the committed
      // value), so no value notification reaches the predicate; the flight's
      // close re-runs it (deferred.ts `wake`).
      const fetcher = deferredFetcher((_: number) => 1);
      const [n, setN] = createSignal(1);
      let derived!: () => number;
      createRoot(() => {
        const rows = createDeferred(() => fetcher.fetch(n()));
        derived = createMemo(() => rows() * 10);
      });
      flush();
      fetcher.resolve(1);
      await settle();
      expect(derived()).toBe(10);

      setN(2);
      flush();
      let result: number | undefined;
      const p = until(() => derived()).then(v => (result = v));
      await settle();
      expect(result).toBeUndefined();
      fetcher.resolve(2);
      await settle();
      await p;
      expect(result).toBe(10);
    });

    it("until over a derived store built on the deferred node parks on the flight through the family's derive", async () => {
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

      setN(3);
      flush();
      let result: number | undefined;
      // Truthy on the stale store too: only parking on the flight (reached
      // from the leaf through its family's derive) delivers the landed one.
      const p = until(() => store.items.length).then(v => (result = v));
      await settle();
      expect(result).toBeUndefined();
      fetcher.resolve(3);
      await settle();
      await p;
      expect(result).toBe(3);
    });
  });

  describe("L2 — a refetch that resolves synchronously is a landing (create-deferred.md 8.3, closed)", () => {
    it("a sync-resolving thenable closes the flight in the same flush; derived verdict readers re-derive", async () => {
      const [n, setN] = createSignal(1);
      let sync = false;
      const thenable = (v: string) => ({
        then(res: (v: string) => void) {
          if (sync) res(v);
          else setTimeout(() => res(v), 0);
        }
      });
      let upper!: () => string;
      const pendingLog: boolean[] = [];
      createRoot(() => {
        const rows = createDeferred(() => thenable(`rows-${n()}`));
        upper = createMemo(() => rows().toUpperCase());
        createRenderEffect(
          () => isPending(upper),
          v => {
            pendingLog.push(v);
          }
        );
      });
      flush();
      await settle();
      expect(upper()).toBe("ROWS-1");
      expect(pendingLog).toEqual([false]);

      sync = true;
      setN(2);
      flush();
      expect(upper()).toBe("ROWS-2");
      expect(isPending(upper)).toBe(false);
      // The answer was never in flight: no reader saw it pending (the probe
      // re-ran for `upper`'s change, and read final).
      expect(pendingLog.every(v => v === false)).toBe(true);
    });
  });

  describe("L2 — disposal and latest", () => {
    it("a node disposed mid-flight outside a flush drops its landing and keeps its mark until the next seam that runs", async () => {
      const fetcher = deferredFetcher((n: number) => `rows-${n}`);
      const [n, setN] = createSignal(1);
      const [tick, setTick] = createSignal(0);
      let rows!: () => string;
      let dispose!: () => void;
      createRoot(d => {
        dispose = d;
        rows = createDeferred(() => fetcher.fetch(n()));
        createRenderEffect(rows, () => {});
      });
      createRoot(() => {
        // An unrelated live graph: writing `tick` gives the scheduler real
        // work, so its flush ends in a seam.
        createRenderEffect(tick, () => {});
      });
      flush();
      fetcher.resolve(1);
      await settle();
      setN(2);
      flush();
      expect(isPending(rows)).toBe(true);
      // Disposing outside a flush schedules nothing (disposeChildren only
      // forces a seam for a held flight or a stale frame reader), so the open
      // flight's mark outlives the node; the late landing is still dropped by
      // identity and a dead node freezes at its last committed value (#3024).
      dispose();
      flush();
      fetcher.resolve(2);
      await settle();
      expect(rows()).toBe("rows-1");
      expect(isPending(rows)).toBe(true);
      // The next seam that runs — here, an unrelated write's flush — sweeps
      // the dead flight and releases the mark.
      setTick(1);
      flush();
      expect(rows()).toBe("rows-1");
      expect(isPending(rows)).toBe(false);
    });

    it("latest(() => d()) is a no-op — nothing staged to lead with — and its own-async verdict is loud (A8)", async () => {
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
      expect(latest(() => rows())).toBe("rows-1");
      expect(isPending(() => latest(() => rows()))).toBe(true);
      fetcher.resolve(2);
      await settle();
      expect(latest(() => rows())).toBe("rows-2");
      expect(isPending(() => latest(() => rows()))).toBe(false);
    });
  });

  /** mizulu's report on #3710 (playground `Lr5tYDWOTW2PD3JSHCdwbA`): a
   * plain async memo `m1` over a deferred `d1` over a signal `count`, both
   * read by a render effect under a Loading boundary, `count` also read by
   * a render effect outside it (the button). "Click before m1:exec and the
   * button goes freely; m1:exec shown but m1:done not yet, and every click
   * in that period is blocked — the button does not increment until
   * m1:end." Same on the PR and on L2. */
  describe("L2 — a plain async memo over a deferred node (mizulu's #3710 report)", () => {
    function playground(downstream: typeof createMemo) {
      const d1Fetch = deferredFetcher((c: number) => c * 2);
      const m1Fetch = deferredFetcher((d: number) => d);
      const [count, setCount] = createSignal(0);
      let d1!: () => number;
      let m1!: () => number;
      const out = { view: "", button: -1 };
      createRoot(() => {
        d1 = createDeferred(() => d1Fetch.fetch(count()));
        m1 = downstream(() => m1Fetch.fetch(d1()));
        const boundary = createLoadingBoundary(
          () => `signal ${count()} deferred ${d1()} m1 ${m1()}`,
          () => "loading..."
        );
        createRenderEffect(boundary, v => {
          out.view = v;
        });
        createRenderEffect(count, v => {
          out.button = v;
        });
      });
      return { d1Fetch, m1Fetch, setCount, d1: () => d1(), m1: () => m1(), out };
    }
    async function load(p: ReturnType<typeof playground>) {
      flush();
      expect(p.out.view).toBe("loading...");
      p.d1Fetch.resolve(0);
      await settle();
      p.m1Fetch.resolve(0);
      await settle();
      expect(p.out.view).toBe("signal 0 deferred 0 m1 0");
      expect(p.out.button).toBe(0);
    }

    it("a write to the input never waits on the deferred flight (D1): the button and the boundary's sync read repaint, the deferred lags", async () => {
      const p = playground(createMemo);
      await load(p);
      p.setCount(1);
      flush();
      expect(p.out.button).toBe(1);
      expect(p.out.view).toBe("signal 1 deferred 0 m1 0");
      expect(isPending(p.d1)).toBe(true);
      p.setCount(2);
      flush();
      expect(p.out.button).toBe(2);
      expect(p.out.view).toBe("signal 2 deferred 0 m1 0");
      // A superseded landing is dropped; the live one re-runs the plain memo.
      p.d1Fetch.resolve(1);
      await settle();
      expect(p.out.view).toBe("signal 2 deferred 0 m1 0");
      p.d1Fetch.resolve(2);
      await settle();
      // The landing re-ran `m1`, which went pending under the frame that
      // reads it: an ordinary async memo's hold (A15), and the landing — an
      // ordinary commit — is staged with it. Nothing deferred-specific
      // holds here (D1: `d1` itself blocks no transaction).
      expect(p.m1Fetch.inFlight()).toEqual([4]);
      expect(p.out.view).toBe("signal 2 deferred 0 m1 0");
      expect(isPending(p.m1)).toBe(true);
      p.m1Fetch.resolve(4);
      await settle();
      expect(p.out.view).toBe("signal 2 deferred 4 m1 4");
      expect(p.out.button).toBe(2);
    });

    it("with the downstream memo deferred too, no click ever waits: both lag, the sync reads never do (D1, D3)", async () => {
      const p = playground(createDeferred as typeof createMemo);
      await load(p);
      p.setCount(1);
      flush();
      p.setCount(2);
      flush();
      expect(p.out.button).toBe(2);
      p.d1Fetch.resolve(1);
      p.d1Fetch.resolve(2);
      await settle();
      // The landing commits (D3) and `m1` re-asks without holding.
      expect(p.out.view).toBe("signal 2 deferred 4 m1 0");
      expect(p.m1Fetch.inFlight()).toEqual([4]);
      p.setCount(3);
      flush();
      expect(p.out.button).toBe(3);
      expect(p.out.view).toBe("signal 3 deferred 4 m1 0");
      p.setCount(4);
      flush();
      expect(p.out.button).toBe(4);
      expect(p.out.view).toBe("signal 4 deferred 4 m1 0");
      p.m1Fetch.resolve(4);
      await settle();
      expect(p.out.view).toBe("signal 4 deferred 4 m1 4");
      for (const k of p.d1Fetch.inFlight()) p.d1Fetch.resolve(k);
      await settle();
      expect(p.out.view).toBe("signal 4 deferred 8 m1 4");
      for (const k of p.m1Fetch.inFlight()) p.m1Fetch.resolve(k);
      await settle();
      expect(p.out.view).toBe("signal 4 deferred 8 m1 8");
      expect(isPending(p.d1)).toBe(false);
      expect(isPending(p.m1)).toBe(false);
    });

    // The common part (lands ahead of the ruling, correct under either
    // reading): a re-pass over a held landing keeps it. `m1`'s flight holds
    // the frame and `d1`'s landing (2) is staged with it; a mainline write
    // to `count` re-passes `d1`. The wrapper's pass returns the staging as
    // its result — `handleAsync` served the committed value, and returned
    // as the result it was compared against the staging (INV-11) and
    // restaged over the landing: `m1` re-fetched against the OLD input and
    // the landing was lost until a later flight re-landed it. And the seam
    // sweep re-opens the window a commit closed under a question it did
    // not answer: when the hold lands, `commitPendingNode` closes `d1`'s
    // window on the older landing while the click's flight is still in the
    // air (D4). Pinned on the text-memo graph, where the tick is held
    // either way (the memo reads `m1`, ruling 3).
    describe("a re-pass over a held landing keeps it (the common part)", () => {
      it("m1 keeps its one flight; the hold lands with the landing it staged; isPending(d1) stays true while the newer flight is live", async () => {
        const p = playground(createMemo);
        await load(p);
        p.setCount(1);
        flush();
        p.d1Fetch.resolve(1);
        await settle();
        expect(p.out.view).toBe("signal 1 deferred 0 m1 0");
        expect(p.m1Fetch.inFlight()).toEqual([2]);
        // Clicks while m1 is in flight re-pass d1 (held, staged 2).
        p.setCount(2);
        flush();
        p.setCount(3);
        flush();
        // The held landing stands: m1 is not re-run against the old input;
        // d1's own questions are the clicks'.
        expect(p.m1Fetch.inFlight()).toEqual([2]);
        expect(p.d1Fetch.inFlight()).toEqual([2, 3]);
        expect(isPending(p.d1)).toBe(true);
        p.m1Fetch.resolve(2);
        await settle();
        // The hold lands with the landing it staged, never without it.
        expect(p.out.view).toBe("signal 3 deferred 2 m1 2");
        expect(p.out.button).toBe(3);
        // The commit of the older landing did not answer the newer question
        // — the window re-opens at the seam, the mark stays (D4).
        expect(isPending(p.d1)).toBe(true);
        expect(isPending(p.m1)).toBe(true);
        p.d1Fetch.resolve(2); // superseded: dropped by identity
        await settle();
        expect(p.out.view).toBe("signal 3 deferred 2 m1 2");
        p.d1Fetch.resolve(3);
        await settle();
        expect(p.m1Fetch.inFlight()).toEqual([6]);
        p.m1Fetch.resolve(6);
        await settle();
        expect(p.out.view).toBe("signal 3 deferred 6 m1 6");
        expect(isPending(p.d1)).toBe(false);
        expect(isPending(p.m1)).toBe(false);
      });
    });

    /** The playground's real graph: the `{}` inserts under `<Loading>` are
     * render effects of their own; the boundary's compute reads none of the
     * held nodes. (The text-memo `playground()` above puts a derivation
     * between them and the frame — which joins any hold it reads, ruling 3.) */
    function playgroundDom() {
      const d1Fetch = deferredFetcher((c: number) => c * 2);
      const m1Fetch = deferredFetcher((d: number) => d);
      const [count, setCount] = createSignal(0);
      let d1!: () => number;
      let m1!: () => number;
      const dom = { fallback: false, sig: -1, def: -1, m1: -1, button: -1 };
      createRoot(() => {
        d1 = createDeferred(() => d1Fetch.fetch(count()));
        m1 = createMemo(() => m1Fetch.fetch(d1()));
        const boundary = createLoadingBoundary(
          () => {
            createRenderEffect(count, v => {
              dom.sig = v;
            });
            createRenderEffect(d1, v => {
              dom.def = v;
            });
            createRenderEffect(m1, v => {
              dom.m1 = v;
            });
            return "content";
          },
          () => "fallback"
        );
        createRenderEffect(boundary, v => {
          dom.fallback = v === "fallback";
        });
        createRenderEffect(count, v => {
          dom.button = v;
        });
      });
      const view = () =>
        dom.fallback ? "fallback" : `signal ${dom.sig} deferred ${dom.def} m1 ${dom.m1}`;
      return { d1Fetch, m1Fetch, setCount, d1: () => d1(), m1: () => m1(), dom, view };
    }

    // Ruled 2026-10-04 (D11 — a lagging question is not an answer). Once `m1`'s
    // flight holds the frame, `d1` is a held node (its landing is staged in
    // that hold). A mainline write to `count` re-passes it; the pass joins
    // nothing (`recompute`'s T4 arm skips a CONFIG_DEFERRED node) and keeps
    // the held landing (the wrapper returns the staging as its result), so
    // the write commits mainline: the button and the boundary's sync insert
    // repaint, the inserts of `d1` and `m1` are stale readers re-derived at
    // `m1`'s landing (A15), and the seam sweep keeps `d1`'s window open
    // under the question the commit of the older landing did not answer
    // (D4).
    describe("a write to the input while the downstream plain memo is in flight commits mainline; the held landing stands (D11)", () => {
      it("the button never waits; the frame's readers of the flight are stale readers; m1 lands with the input it was asked with", async () => {
        const p = playgroundDom();
        flush();
        expect(p.view()).toBe("fallback");
        p.d1Fetch.resolve(0);
        await settle();
        p.m1Fetch.resolve(0);
        await settle();
        expect(p.view()).toBe("signal 0 deferred 0 m1 0");
        p.setCount(1);
        flush();
        expect(p.view()).toBe("signal 1 deferred 0 m1 0");
        expect(p.dom.button).toBe(1);
        p.d1Fetch.resolve(1);
        await settle();
        // m1 re-ran on the landing and holds the frame; the landing is staged with it.
        expect(p.view()).toBe("signal 1 deferred 0 m1 0");
        expect(p.m1Fetch.inFlight()).toEqual([2]);
        expect(isPending(p.m1)).toBe(true);
        // Clicks while m1 is in flight: mainline. The sync readers repaint;
        // the readers of the flight keep the committed frame.
        p.setCount(2);
        flush();
        expect(p.dom.button).toBe(2);
        expect(p.view()).toBe("signal 2 deferred 0 m1 0");
        p.setCount(3);
        flush();
        expect(p.dom.button).toBe(3);
        expect(p.view()).toBe("signal 3 deferred 0 m1 0");
        // The held landing (2) stands: m1 keeps its one flight; d1's own
        // questions are the clicks'.
        expect(p.m1Fetch.inFlight()).toEqual([2]);
        expect(p.d1Fetch.inFlight()).toEqual([2, 3]);
        expect(isPending(p.d1)).toBe(true);
        p.m1Fetch.resolve(2);
        await settle();
        // The hold lands with the landing it staged; the stale readers
        // re-derive on it.
        expect(p.view()).toBe("signal 3 deferred 2 m1 2");
        expect(p.dom.button).toBe(3);
        // d1's newest question is still in the air (D4).
        expect(isPending(p.d1)).toBe(true);
        p.d1Fetch.resolve(2);
        await settle();
        expect(p.view()).toBe("signal 3 deferred 2 m1 2");
        p.d1Fetch.resolve(3);
        await settle();
        expect(p.m1Fetch.inFlight()).toEqual([6]);
        p.m1Fetch.resolve(6);
        await settle();
        expect(p.view()).toBe("signal 3 deferred 6 m1 6");
        expect(isPending(p.d1)).toBe(false);
        expect(isPending(p.m1)).toBe(false);
      });

      // The limit of D11, L2-general and not deferred-specific: a derivation
      // (here the boundary's text memo) re-run by the write reads the held
      // pending `m1` and joins its hold (`read` → `joinPass`, ruling 3: a
      // derivation of a held node published mainline would tear). The
      // deferred node is not involved — the pure-L2 control below, with no
      // deferred node in the graph, holds the same way.
      it("with a derivation between the held memo and the frame, the write still joins — the derivation reads m1 (ruling 3); nothing deferred-specific", async () => {
        const p = playground(createMemo);
        await load(p);
        p.setCount(1);
        flush();
        p.d1Fetch.resolve(1);
        await settle();
        expect(p.m1Fetch.inFlight()).toEqual([2]);
        p.setCount(2);
        flush();
        // The boundary's text memo re-passes, reads the held pending `m1`,
        // and joins its hold: the tick parks, the button with it — as it
        // would with no deferred node in the graph at all.
        expect(p.out.button).toBe(1);
        expect(p.out.view).toBe("signal 1 deferred 0 m1 0");
        // The held landing stands all the same (the common part).
        expect(p.m1Fetch.inFlight()).toEqual([2]);
        p.m1Fetch.resolve(2);
        await settle();
        expect(p.out.view).toBe("signal 2 deferred 2 m1 2");
        expect(p.out.button).toBe(2);
        p.d1Fetch.resolve(2);
        await settle();
        p.m1Fetch.resolve(4);
        await settle();
        expect(p.out.view).toBe("signal 2 deferred 4 m1 4");
      });

      it("pure-L2 control: no deferred node — a derivation reading a held pending memo joins the hold on an unrelated write", async () => {
        const fetcher = deferredFetcher((n: number) => n * 10);
        const [a, setA] = createSignal(0);
        const [b, setB] = createSignal(0);
        const out = { view: "", button: -1 };
        let m!: () => number;
        createRoot(() => {
          m = createMemo(() => fetcher.fetch(a()));
          const boundary = createLoadingBoundary(
            () => `b ${b()} m ${m()}`,
            () => "loading..."
          );
          createRenderEffect(boundary, v => {
            out.view = v;
          });
          createRenderEffect(b, v => {
            out.button = v;
          });
        });
        flush();
        fetcher.resolve(0);
        await settle();
        expect(out.view).toBe("b 0 m 0");
        setA(1);
        flush();
        expect(isPending(m)).toBe(true);
        // A write to `b`, unrelated to the flight: the text memo re-passes,
        // reads the held pending `m`, joins — the button waits too.
        setB(1);
        flush();
        expect(out.button).toBe(0);
        expect(out.view).toBe("b 0 m 0");
        fetcher.resolve(1);
        await settle();
        expect(out.view).toBe("b 1 m 10");
        expect(out.button).toBe(1);
      });
    });
  });
});
