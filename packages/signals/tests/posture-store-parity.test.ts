/**
 * Posture matrix — store / signal PARITY pins (2026-09-16). Discovery source:
 * visibility-oracle-posture.test.ts over the store oracle's states
 * (visibility-oracle-store.states.ts) beside the signal states.
 *
 * S1 — VIOLATION (signal side), pinned it.fails: adopted, unflushed. Same-tick
 *      adoption is by design (spec O1); A28 still says nothing is visible
 *      before the flush. The store leaf answers latest 0 / isPending false
 *      inside the adopting action's body; the signal answers 1 / true.
 * S2 — OBSERVED, both sides agree: a memo + render effect created inside
 *      loading-boundary content over a held value publishes the held value
 *      (the in-flush form of spec O2 — creation under a transaction escapes;
 *      the content pass entered the hold, the creation direct-committed).
 *      Mainline creation over the same value is born held (A29).
 *
 * S3 — VIOLATION (INV-4), pinned it.fails: a projection leaf's latest()
 *      shadow is stale on the flush right after the store's root is disposed
 *      while a refetch is held. Transient (it recovers a microtask later),
 *      but a __TEST__ quiescence check in that window throws — and a throw
 *      from the runtime's own scheduled flush leaves the scheduler mid-flush.
 *      Surfaced when #3488/O3 stopped leaking the parked transactions that
 *      had masked every quiescence check in the posture matrix. Spec O5.
 *
 * (A first cut also reported the projection's seed leaking as a value inside
 * boundary content, and `isPending` false / override invisible behind a
 * fallback. All three were a runner artifact — the boundary content re-ran
 * after the entanglement probe resolved the flight and overwrote the
 * captured read. The runner now freezes the served value before probing.)
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  latest
} from "../src/index.js";

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

const never = () => new Promise<never>(() => {});

describe("S1 — adopted, unflushed: verdict channels inside the adopting action (A28 (1)/(2)) — signal vs store", () => {
  // Adoption stamps the signal with the transaction, and `unflushedValue`
  // reads a stamped node with no stash as "flushed, held" — so latest()
  // serves the staged 1 and isPending answers true for a write no flush has
  // carried. The store leaf's selection (nodeValue / serveDataKey) does not
  // take that path and answers by A28. The store is right.
  it("store leaf: latest / isPending inside the adopting action see nothing before the flush", () => {
    const [s, setS] = createStore({ n: 0 });
    setS(d => {
      d.n = 1;
    });
    let seen: [number, boolean] | undefined;
    action(function* () {
      seen = [latest(() => s.n), isPending(() => s.n)];
      yield never();
    })();
    expect(seen).toEqual([0, false]);
  });
  it.fails(
    "signal: latest / isPending inside the adopting action see nothing before the flush (A28) — VIOLATION: 1 / true",
    () => {
      const [x, setX] = createSignal(0);
      setX(1);
      let seen: [number, boolean] | undefined;
      action(function* () {
        seen = [latest(x), isPending(x)];
        yield never();
      })();
      expect(seen).toEqual([0, false]);
    }
  );
});

describe("S2 — creation in boundary content over a held value publishes it (OBSERVED, spec O2 in-flush form; signal and store agree)", () => {
  /** Build a memo + render effect over `read` inside a loading boundary whose
   * content is pending on a sibling flight (the fallback shows). */
  function behindFallback(read: () => unknown) {
    const published: unknown[] = [];
    createRoot(() => {
      const blocker = createMemo(() => never());
      const b = createLoadingBoundary(
        () => {
          const m = createMemo(read);
          createRenderEffect(m, v => {
            published.push(v);
          });
          blocker();
          return "content";
        },
        () => "fallback"
      );
      createRenderEffect(b, () => {});
    });
    flush();
    return published;
  }
  it("signal held by a live action: the memo publishes the held 1 while x() reads 0", () => {
    const [x, setX] = createSignal(0);
    action(function* () {
      setX(1);
      yield never();
    })();
    flush();
    expect(x()).toBe(0);
    expect(behindFallback(x)).toEqual([1]);
    expect(x()).toBe(0);
  });
  it("store leaf held by a live action: the memo publishes the held 1 while s.n reads 0", () => {
    const [s, setS] = createStore({ n: 0 });
    action(function* () {
      setS(d => {
        d.n = 1;
      });
      yield never();
    })();
    flush();
    expect(s.n).toBe(0);
    expect(behindFallback(() => s.n)).toEqual([1]);
    expect(s.n).toBe(0);
  });
});

describe("S3 — INV-4: a projection leaf's latest() shadow after its root is disposed mid-refetch (spec O5) — VIOLATION, pinned it.fails", () => {
  // Reproduces on `next`: the flush right after `dispose()` trips the
  // quiescence invariant (the shadow holds the pre-refetch value, is not
  // dirty, and the leaf's committed value differs). A microtask later the
  // shadow is re-derived and the same check passes — so this is a window,
  // not a permanent divergence; under __TEST__ the window is fatal.
  it.fails(
    "the flush right after disposing a projection with a held refetch passes the quiescence invariants",
    async () => {
      const [q, setQ] = createSignal(0);
      const fetches: Array<() => void> = [];
      let s!: { n: number };
      const dispose = createRoot(d => {
        [s] = createStore<{ n: number }>(
          () => {
            const v = q();
            return new Promise(r => fetches.push(() => r({ n: v * 10 })));
          },
          { n: -1 }
        );
        createRenderEffect(
          () => s.n,
          () => {}
        );
        return d;
      });
      flush();
      fetches.shift()!();
      await settle();
      setQ(1); // refetch, never lands
      flush();
      expect(latest(() => s.n)).toBe(0); // creates the leaf's shadow
      dispose();
      expect(() => flush()).not.toThrow(); // INV-4 here on next
    }
  );
});
