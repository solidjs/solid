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
 * S2 — (fixed, #3540) a memo + render effect created inside loading-boundary
 *      content over a held value used to publish the held value (the in-flush
 *      form of spec O2 — creation under a transaction escaped; the content
 *      pass entered the hold, the creation direct-committed, and the effect
 *      ran behind the fallback). Creation under a boundary that has not
 *      revealed is born held into the transaction and collected by the
 *      boundary as not ready (A29's boundary exemption): nothing publishes
 *      until the hold commits, and the effect waits for the reveal like every
 *      effect behind a fallback. Mainline creation over the same value is
 *      born held (A29).
 *
 * S3 — INV-4 after disposing a projection mid-refetch: its own file,
 *      tests/inv4-projection-dispose-shadow.test.ts (the live actions S1/S2
 *      leave behind would mask the quiescence check here). Spec O5.
 * S4 — (fixed, 3b steps 2–3) a stale reader's UNTRACKED read of a held store
 *      key replays at the commit as the signal's does — node, backing, and
 *      adoption-hold paths (recordStaleReplay).
 * S5 — (fixed, 3b step 4) a mainline derivation's UNTRACKED read of a held
 *      store key is born held (A29) as the signal's is — the store's untracked
 *      paths served the pending value without entering the transaction.
 * S6 — RULED (2026-09-17, "store rules follow signal rules"), fix DEFERRED:
 *      A28 at the backing. Pinned at the store's CURRENT value below so the
 *      divergence stays visible; the fix is the store half of `serve`
 *      (DESIGN-CONSOLIDATION move 3b step 6) — done at the twin it costs
 *      +400 B minified (a node born in the unflushed window must stage the
 *      write; #3521 first cut).
 * S7 — (fixed) an optimistic override survives its key becoming unobserved
 *      (the slot release defers to the flush that resolves the override).
 * S8 — (fixed, 3b step 6c) a derivation's untracked read of a SUPERSEDED
 *      store node derives from the landed truth (A18), not the override —
 *      nodeValue delegates to core's one slow selection, `serve`.
 * Discovery for S4–S7: the matrix's `memoUntracked` / `effectUntracked`
 * reader kinds (an untracked read inside a derivation), added with S5.
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
  createEffect,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createOptimisticStore,
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
import { $TARGET } from "../src/store/store.js";

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

describe("S2 — creation in boundary content over a held value is born held and collected, not published (A29 boundary exemption, #3540; signal and store agree)", () => {
  /** Build a memo + render effect over `read` inside a loading boundary whose
   * content is pending on a sibling flight (the fallback shows). */
  function behindFallback(read: () => unknown) {
    const published: unknown[] = [];
    let shown: unknown;
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
      createRenderEffect(b, v => {
        shown = v;
      });
    });
    flush();
    return { published, shown: () => shown };
  }
  it("signal held by a live action: nothing publishes the held 1 while x() reads 0", () => {
    const [x, setX] = createSignal(0);
    action(function* () {
      setX(1);
      yield never();
    })();
    flush();
    expect(x()).toBe(0);
    const b = behindFallback(x);
    expect(b.published).toEqual([]);
    expect(b.shown()).toBe("fallback");
    expect(x()).toBe(0);
  });
  it("store leaf held by a live action: nothing publishes the held 1 while s.n reads 0", () => {
    const [s, setS] = createStore({ n: 0 });
    action(function* () {
      setS(d => {
        d.n = 1;
      });
      yield never();
    })();
    flush();
    expect(s.n).toBe(0);
    const b = behindFallback(() => s.n);
    expect(b.published).toEqual([]);
    expect(b.shown()).toBe("fallback");
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

/** A deriving reader (memo, user effect) created MAINLINE whose UNTRACKED
 * read is of a value held by a live action: the pass is served the staged
 * value and enters the transaction — born held (A29) — so nothing is
 * published until the action commits. The signal did this (core read()
 * enters on the same arm that serves the staged value; `context` persists
 * under untrack). The store's untracked paths (nodeValue, the backing's
 * pendingBackingVisible, the adoption-hold view) served the pending value
 * WITHOUT entering: a mainline memo published the action's unrevealed write
 * to the screen while the same read of a signal was held. */
type HeldShape = "signal" | "store+node" | "store" | "store reconcile" | "store reconcile+node";
function heldShape(shape: HeldShape) {
  if (shape === "signal") {
    const [x, setX] = createSignal(0);
    return { read: x, write: () => setX(1) };
  }
  const [s, setS] = createStore({ n: 0 });
  if (shape.endsWith("+node")) {
    createRoot(() =>
      createRenderEffect(
        () => s.n,
        () => {}
      )
    );
    flush();
  }
  return {
    read: () => s.n,
    write: () =>
      shape.startsWith("store reconcile")
        ? setS(reconcile({ n: 1 }))
        : setS(d => {
            d.n = 1;
          })
  };
}
describe("S5 — a mainline derivation's UNTRACKED read of a held value is born held (A29) — signal vs store", () => {
  for (const shape of [
    "signal",
    "store+node",
    "store",
    "store reconcile",
    "store reconcile+node"
  ] as HeldShape[]) {
    it(`${shape}: memo → render effect publishes nothing until the action commits`, async () => {
      const { read, write } = heldShape(shape);
      let release!: () => void;
      action(function* () {
        write();
        yield new Promise<void>(res => (release = res));
      })();
      flush();
      const log: number[] = [];
      const [u, setU] = createSignal(0);
      createRoot(() => {
        const m = createMemo(() => {
          u();
          return untrack(read);
        });
        createRenderEffect(m, v => {
          log.push(v);
        });
      });
      flush();
      setU(1); // a re-run off the hold is held too
      flush();
      expect(log).toEqual([]);
      release();
      await settle();
      expect(log).toEqual([1]);
    });
    it(`${shape}: user effect runs once, after the commit`, async () => {
      const { read, write } = heldShape(shape);
      let release!: () => void;
      action(function* () {
        write();
        yield new Promise<void>(res => (release = res));
      })();
      flush();
      const log: number[] = [];
      createRoot(() => {
        createEffect(
          () => untrack(read),
          v => {
            log.push(v);
          }
        );
      });
      flush();
      expect(log).toEqual([]);
      release();
      await settle();
      expect(log).toEqual([1]);
    });
  }
});

/** S6 — DIVERGENCE, ruled, fix deferred. Staged, ambient (a write before
 * any flush), reader created INSIDE a foreign action (which adopts the
 * write, spec O1): the signal's memo → render effect publishes the committed
 * 0 (A28 / #3510: adopted before any flush = unflushed, served committed);
 * the store's publishes the pending 1 (pendingBackingVisible: owner context
 * → pending backing). The verdict channels already agree (S1); the
 * derivation reads do not. Ruling: the store follows the signal (0). The
 * store side is pinned at its CURRENT value so the divergence stays visible
 * until the store's value selection shares core's (`serve`, move 3b step 6);
 * flip it to `[0]` then. */
describe("S6 — DIVERGENCE (ruled: store follows signal; fix deferred to `serve`): staged-ambient write read by a derivation created inside a foreign action", () => {
  function publishedInsideForeignAction(read: () => number) {
    const log: number[] = [];
    action(function* () {
      createRoot(() => {
        const m = createMemo(read);
        createRenderEffect(m, v => {
          log.push(v);
        });
      });
      yield never();
    })();
    flush();
    return log;
  }
  it("signal: publishes the committed 0", () => {
    const [x, setX] = createSignal(0);
    setX(1);
    expect(publishedInsideForeignAction(x)).toEqual([0]);
  });
  it("store: publishes the pending 1 (CURRENT; rule says 0)", () => {
    const [s, setS] = createStore({ n: 0 });
    setS(d => {
      d.n = 1;
    });
    expect(publishedInsideForeignAction(() => s.n)).toEqual([1]);
  });
});

/** S7 (fixed): the slot hook released a node the moment its last subscriber
 * left — with the override on it (overrides live on nodes, over a clone the
 * setter discards), so `s.n` read the committed 0 while the action was live.
 * A node carrying an override or a staged write now defers its release to
 * the flush that resolves it (deferSlotRelease / sweepTransientStoreNodes),
 * as an optimistic signal keeps its override whether or not anything reads
 * it. */
describe("S7 — optimistic override, the only reader gated away: the override is still the value (A17) — signal vs store", () => {
  function gateAway(read: () => number) {
    const [show, setShow] = createSignal(true);
    createRoot(() => {
      createRenderEffect(
        () => (show() ? read() : "gated"),
        () => {}
      );
    });
    flush();
    setShow(false);
    flush();
    return read();
  }
  it("signal: x() still reads the override while the action is live", () => {
    const [x, setX] = createOptimistic(0);
    action(function* () {
      setX(5);
      yield never();
    })();
    flush();
    expect(gateAway(x)).toBe(5);
  });
  it("store: s.n still reads the override once nothing observes the key", () => {
    const [s, setS] = createOptimisticStore({ n: 0 });
    action(function* () {
      setS(d => {
        d.n = 5;
      });
      yield never();
    })();
    flush();
    expect(gateAway(() => s.n)).toBe(5);
  });
  it("store: the node deferred for its override is released once the action settles", async () => {
    const [s, setS] = createOptimisticStore({ n: 0 });
    let release!: () => void;
    action(function* () {
      setS(d => {
        d.n = 5;
      });
      yield new Promise<void>(res => (release = res));
    })();
    flush();
    expect(gateAway(() => s.n)).toBe(5);
    release();
    await settle();
    expect(s.n).toBe(0);
    // the slot map no longer holds a node for `n`
    expect(((s as any)[$TARGET].n ?? {}).n).toBeUndefined();
  });
});

/** S7, the structural half (review of #3523): an optimistic add or delete
 * lives on the key's PRESENCE node (`target.h`, getHasNode) as its override.
 * Its unobserved callback released the node the moment the last structural
 * observer left — with the override on it — so `in`, `Object.keys` and
 * descriptors fell back to committed structure while the action was live.
 * The presence node now defers its release like the value slot does. */
describe("S7 (structural) — optimistic add/delete survives the only structural observer gating away", () => {
  for (const kind of ["add", "delete"] as const) {
    it(`optimistic ${kind}: in / Object.keys / descriptor keep the optimistic structure while live; settle restores committed and releases the presence node`, async () => {
      const [s, setS] = createOptimisticStore<Record<string, number>>(
        kind === "add" ? {} : { k: 1 }
      );
      const [show, setShow] = createSignal(true);
      createRoot(() => {
        createRenderEffect(
          () => (show() ? "k" in s : "gated"),
          () => {}
        );
      });
      flush();
      let release!: () => void;
      action(function* () {
        setS(d => {
          if (kind === "add") d.k = 5;
          else delete d.k;
        });
        yield new Promise<void>(res => (release = res));
      })();
      flush();
      const live = kind === "add";
      const structure = () => [
        "k" in s,
        Object.keys(s).includes("k"),
        Object.getOwnPropertyDescriptor(s, "k") !== undefined
      ];
      expect(structure()).toEqual([live, live, live]);
      setShow(false); // the only structural observer gates away
      flush();
      expect(structure()).toEqual([live, live, live]);
      release();
      await settle();
      expect(structure()).toEqual([!live, !live, !live]);
      expect(((s as any)[$TARGET].h ?? {}).k).toBeUndefined();
    });
  }
});

/** S8 (fixed, 3b step 6c): A18 supersession for a store node read UNTRACKED
 * inside a derivation. A derived optimistic store's own truth landed (2)
 * while an action's edit (3) is displayed: the signal serves a deriving
 * reader the staged truth and holds it (A18: truth in the graph now, on
 * screen at commit); the store's untracked node path served the memo the
 * OVERRIDE and let it publish 3 — nodeValue had its own override arm without
 * the supersession routing core read() has (overrideRead). nodeValue now
 * delegates to `serve`, the one slow selection, and inherits the arm. */
describe("S8 — a derivation's UNTRACKED read of a superseded store node derives from the truth (A18) — signal vs store", () => {
  it("store: memo → render effect holds, then publishes the landed truth at settle", async () => {
    const [value, setValue] = createSignal(0);
    const fetches: Array<() => void> = [];
    let s!: { n: number };
    let set!: (fn: (d: { n: number }) => void) => void;
    createRoot(() => {
      [s, set] = createOptimisticStore<{ n: number }>(
        () => {
          const v = value();
          return new Promise<{ n: number }>(r => fetches.push(() => r({ n: v * 2 })));
        },
        { n: -1 }
      );
      // an initialized downstream flight keeps the action live after its truth lands
      const downstream = createMemo(() => {
        const n = s.n;
        return new Promise<string>(r => flights.push(() => r(`${n}!`)));
      });
      createRenderEffect(downstream, () => {});
    });
    const flights: Array<() => void> = [];
    flush();
    fetches.shift()!(); // initial truth {n: 0}
    await settle();
    flights.shift()!();
    await settle();
    action(function* () {
      setValue(1);
      set(d => {
        d.n = 3;
      });
      yield new Promise<void>(res => flights.push(res as () => void));
    })();
    flush();
    fetches.shift()!(); // own truth lands {n: 2} ≠ 3
    await settle();
    expect(s.n).toBe(3); // A18 (c): the override stays displayed for an untracked mainline read
    const log: number[] = [];
    createRoot(() => {
      const m = createMemo(() => untrack(() => s.n));
      createRenderEffect(m, v => {
        log.push(v);
      });
    });
    flush();
    expect(log).toEqual([]); // held with the action: derives from the truth, not the override
    flights.splice(0).forEach(f => f());
    await settle();
    await settle();
    expect(log).toEqual([2]);
  });
});
