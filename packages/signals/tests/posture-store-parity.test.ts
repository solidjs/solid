/**
 * Posture matrix — store / signal PARITY pins (2026-09-16). Discovery source:
 * visibility-oracle-posture.test.ts over the store oracle's states
 * (visibility-oracle-store.states.ts) beside the signal states.
 *
 * S1 — adopted, unflushed (spec O4, fixed): same-tick adoption is by design
 *      (spec O1); A28 still says nothing is visible before the flush. The
 *      store leaf answered latest 0 / isPending false inside the adopting
 *      action's body; the signal answered 1 / true. Both now answer by one
 *      `unflushed`: an adopted-before-any-flush staging is marked
 *      (ADOPTED_UNFLUSHED) — latest() serves the committed value, the
 *      verdict sees nothing staged — until the carrying flush.
 * S2 — OBSERVED, both sides agree: a memo + render effect created inside
 *      loading-boundary content over a held value publishes the held value
 *      (the in-flush form of spec O2 — creation under a transaction escapes;
 *      the content pass entered the hold, the creation direct-committed).
 *      Mainline creation over the same value is born held (A29).
 *
 * S3 — INV-4 after disposing a projection mid-refetch: its own file,
 *      tests/inv4-projection-dispose-shadow.test.ts (the live actions S1/S2
 *      leave behind would mask the quiescence check here). Spec O5.
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
  latest,
  reconcile,
  untrack
} from "../src/index.js";

const never = () => new Promise<never>(() => {});

describe("S1 — adopted, unflushed: verdict channels inside the adopting action (A28 (1)/(2)) — signal vs store", () => {
  // Was: adoption stamped the signal with the transaction, and
  // `unflushedValue` read a stamped node with no stash as "flushed, held" —
  // latest() served the staged 1 and isPending answered true for a write no
  // flush had carried; the store leaf's own selection happened to answer by
  // A28. Now initTransition's adoption outside a flush marks the node
  // ADOPTED_UNFLUSHED and both channels answer the same way for both.
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
  it("signal: latest / isPending inside the adopting action see nothing before the flush (A28)", () => {
    const [x, setX] = createSignal(0);
    setX(1);
    let seen: [number, boolean] | undefined;
    action(function* () {
      seen = [latest(x), isPending(x)];
      yield never();
    })();
    expect(seen).toEqual([0, false]);
  });
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

/** A render effect (stale reader) whose UNTRACKED read is of a value held by
 * a foreign action: it is served committed (A15 / A26) and — because the
 * commit will change what it read — is recorded for replay at that commit
 * (core heldFromStale, the `_gatedSubs` contract). The signal side always
 * did this; the store's node path restated the stale-of-foreign clause
 * without the registration (nodeValue's `foreignHold` twin), so the effect
 * showed the committed value after the action settled, permanently. Both
 * paths now go through one readerSeesCommitted. */
function untrackedStaleReplay(read: () => number, hold: () => void, release: () => void) {
  const [u, setU] = createSignal(0);
  const log: number[] = [];
  createRoot(() => {
    createRenderEffect(
      () => {
        u();
        return untrack(read);
      },
      v => {
        log.push(v);
      }
    );
  });
  flush();
  hold();
  flush();
  setU(1); // the stale reader re-runs off the hold: committed
  flush();
  const held = [...log];
  release();
  return { held, log };
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  flush();
  await Promise.resolve();
  await Promise.resolve();
  flush();
};

describe("S4 — a stale reader's untracked read of a foreign hold replays at the hold's commit (A15 / A26 replay contract) — signal vs store", () => {
  it("signal: committed while held, the new value after the action settles", async () => {
    const [x, setX] = createSignal(0);
    let release!: () => void;
    const r = untrackedStaleReplay(
      x,
      () =>
        action(function* () {
          setX(1);
          yield new Promise<void>(res => (release = res));
        })(),
      () => release()
    );
    expect(r.held).toEqual([0, 0]);
    await settle();
    expect(r.log).toEqual([0, 0, 1]);
  });
  it("store leaf with a node: committed while held, the new value after the action settles", async () => {
    const [s, setS] = createStore({ n: 0 });
    // A tracked reader materializes the node for `n`; the untracked read
    // then serves through it (nodeValue).
    createRoot(() =>
      createRenderEffect(
        () => s.n,
        () => {}
      )
    );
    flush();
    let release!: () => void;
    const r = untrackedStaleReplay(
      () => s.n,
      () =>
        action(function* () {
          setS(d => {
            d.n = 1;
          });
          yield new Promise<void>(res => (release = res));
        })(),
      () => release()
    );
    expect(r.held).toEqual([0, 0]);
    await settle();
    expect(r.log).toEqual([0, 0, 1]);
  });
  // The backing twin (pendingBackingVisible / heldFromReader) serves the key
  // with no node the same committed value; it records the reader on the
  // holding transaction directly (staleReplay → core recordStaleReplay).
  it("store leaf WITHOUT a node: the same replay (backing twin)", async () => {
    const [s, setS] = createStore({ n: 0 });
    let release!: () => void;
    const r = untrackedStaleReplay(
      () => s.n,
      () =>
        action(function* () {
          setS(d => {
            d.n = 1;
          });
          yield new Promise<void>(res => (release = res));
        })(),
      () => release()
    );
    expect(r.held).toEqual([0, 0]);
    await settle();
    expect(r.log).toEqual([0, 0, 1]);
  });
  // The other hold kind: an adoption (reconcile inside an action) holds at
  // the backing (`ht`, #3074) — the held view is served to the stale reader
  // by readSource, and the same replay is recorded there.
  for (const withNode of [false, true]) {
    it(`store reconcile held by a live action, ${withNode ? "with" : "without"} a node: the same replay`, async () => {
      const [s, setS] = createStore({ n: 0 });
      if (withNode) {
        createRoot(() =>
          createRenderEffect(
            () => s.n,
            () => {}
          )
        );
        flush();
      }
      let release!: () => void;
      const r = untrackedStaleReplay(
        () => s.n,
        () =>
          action(function* () {
            setS(reconcile({ n: 1 }));
            yield new Promise<void>(res => (release = res));
          })(),
        () => release()
      );
      expect(r.held).toEqual([0, 0]);
      await settle();
      expect(r.log).toEqual([0, 0, 1]);
    });
  }
});
