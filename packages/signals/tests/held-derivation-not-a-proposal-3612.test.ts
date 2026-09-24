import { describe, expect, it } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  latest
} from "../src/index.js";

// A34 amendment (#3612, sshockwave). Ruled 2026-09-23:
//
//   #2692's "manual write wins" precedence applies within a synchronous frame.
//   Across a hold, a held derivation is not a proposal: a mainline write to a
//   node whose held staging is a pass result (stamped `_transition = T` by
//   another transaction, `REACTIVE_MANUAL_WRITE` NOT set on the node / its
//   `_firewall`) becomes `prev` for the transaction's re-derivation and does
//   not suppress it. The write still joins T per A34(1) (writer's tick reveals
//   with T; NO intermediate mainline commit). Writes made inside the
//   transaction (T's staging already a manual proposal) keep today's A34(1)
//   last-write-wins. Applies to `createSignal(fn)` and `createStore(fn)`
//   (CS-R31); projections have no setter.
//
// Shape (the report): `a`, `b = createSignal(() => a() * 100)`, an async memo
// `c` over `a` that parks on an external gate for `a !== 1`, and a render
// effect reading all three (the DOM-binding shape — it is what holds `a`'s
// write while `c` is in flight). `setA(2)` opens the hold T; `b` re-derives
// under T (staged 200, stamped). A mainline `setB(101)` mid-hold was written
// against the DISPLAYED frame (`b() === 100`), and used to overwrite T's
// derivation and mask its recompute: the reveal published `a=2 b=101`, a
// frame no derivation ever produced.

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}
async function settle() {
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flush();
  }
}

function setup(opts: { holds?: (a: number) => boolean } = {}) {
  const holds = opts.holds ?? (a => a !== 1);
  const views: string[] = [];
  const gates: ReturnType<typeof deferred>[] = [];
  let dispose!: () => void;
  const h = createRoot(d => {
    dispose = d;
    const [a, setA] = createSignal(1);
    const [b, setB] = createSignal(() => a() * 100);
    const c = createMemo(async () => {
      const v = a();
      if (!holds(v)) return v;
      const g = deferred();
      gates.push(g);
      await g.promise;
      return v;
    });
    createRenderEffect(
      () => `a=${a()} b=${b()} c=${c()}`,
      v => {
        views.push(v);
      }
    );
    return { a, setA, b, setB, c };
  });
  return {
    ...h,
    views,
    dispose,
    /** Land every parked flight of `c`. */
    async release() {
      while (gates.length) gates.shift()!.resolve();
      await settle();
    }
  };
}

describe("A34 amendment — a held derivation is not a proposal (#3612)", () => {
  it("the report: a mainline write mid-hold becomes prev; T re-derives and reveals a=2 b=200", async () => {
    const h = setup();
    await settle();
    expect(h.views).toEqual(["a=1 b=100 c=1"]);

    h.setA(2); // T opens: a=2 held on c's flight; b re-derives to 200 under T
    await settle();
    expect(h.views).toEqual(["a=1 b=100 c=1"]);
    expect(h.b()).toBe(100);
    expect(latest(h.b)).toBe(200);
    expect(isPending(h.b)).toBe(true);

    // Mid-hold, from mainline (a timer, an event handler): written against
    // the displayed frame `b() === 100`.
    h.setB(101);
    // A28: an unflushed rewrite of a held node is not yet observable —
    // latest() keeps serving the value the last flush staged.
    expect(latest(h.b)).toBe(200);
    await settle();
    // No intermediate mainline commit: the writer's tick joined T (A34(1)).
    expect(h.views).toEqual(["a=1 b=100 c=1"]);
    expect(h.b()).toBe(100);
    // The write is not a proposal: T re-derived `b` with prev = 101 and
    // staged f(a=2) = 200 again. latest() shows T's derivation, never 101.
    expect(latest(h.b)).toBe(200);
    expect(isPending(h.b)).toBe(true);

    await h.release();
    expect(h.views).toEqual(["a=1 b=100 c=1", "a=2 b=200 c=2"]);
    expect(h.b()).toBe(200);
    expect(isPending(h.b)).toBe(false);
    h.dispose();
  });

  it("the functional updater composes on the committed frame (prev === 100, not T's staged 200)", async () => {
    const h = setup();
    await settle();
    h.setA(2);
    await settle();
    let seen: number | undefined;
    h.setB(prev => {
      seen = prev;
      return prev + 1;
    });
    expect(seen).toBe(100);
    await settle();
    expect(h.views).toEqual(["a=1 b=100 c=1"]);
    await h.release();
    expect(h.views).toEqual(["a=1 b=100 c=1", "a=2 b=200 c=2"]);
    h.dispose();
  });

  it("a prev-reading derivation folds the write: max(prev=5, a=2) = 5", async () => {
    const views: string[] = [];
    const gates: ReturnType<typeof deferred>[] = [];
    let setA!: (v: number) => void;
    let setHi!: (v: number | ((p: number) => number)) => void;
    let hi!: () => number;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const [a, sa] = createSignal(1);
      const [h, sh] = createSignal<number>(prev => Math.max(prev ?? 0, a()));
      setA = sa;
      setHi = sh;
      hi = h;
      const c = createMemo(async () => {
        const v = a();
        if (v === 1) return v;
        const g = deferred();
        gates.push(g);
        await g.promise;
        return v;
      });
      createRenderEffect(
        () => `a=${a()} hi=${h()} c=${c()}`,
        v => {
          views.push(v);
        }
      );
    });
    await settle();
    expect(views).toEqual(["a=1 hi=1 c=1"]);
    setA(2);
    await settle();
    expect(latest(hi)).toBe(2);
    setHi(5);
    await settle();
    expect(views).toEqual(["a=1 hi=1 c=1"]);
    expect(hi()).toBe(1);
    expect(latest(hi)).toBe(5);
    while (gates.length) gates.shift()!.resolve();
    await settle();
    expect(views).toEqual(["a=1 hi=1 c=1", "a=2 hi=5 c=2"]);
    dispose();
  });

  describe("`a` moves again mid-hold after the write: b re-derives, and probing isPending between the writes changes nothing", () => {
    // Before the amendment the manual-write mask outlived its tick (it is
    // only cleared by the commit, which for a held node is T's), so the
    // later `setA(3)` was dropped at the heap and `a=3 b=101` committed —
    // unless something pulled `updateIfNecessary` in between (an
    // `isPending(b)` probe wipes the flags), which flipped it to `a=3 b=300`.
    for (const probe of [false, true]) {
      it(`setA(2) | setB(101) | ${probe ? "isPending(b) | " : ""}setA(3) → a=3 b=300`, async () => {
        const h = setup();
        await settle();
        h.setA(2);
        await settle();
        h.setB(101);
        await settle();
        if (probe) expect(isPending(h.b)).toBe(true);
        h.setA(3);
        await settle();
        expect(h.views).toEqual(["a=1 b=100 c=1"]);
        expect(latest(h.b)).toBe(300);
        await h.release();
        expect(h.views).toEqual(["a=1 b=100 c=1", "a=3 b=300 c=3"]);
        h.dispose();
      });
    }
  });

  it("`a` written back to its committed value after the write: T re-derives for a=1 and reveals nothing new", async () => {
    // A consequence of the ruling, pinned so it is a decision and not an
    // accident: the derivation re-runs for a=1 with prev=101 → 100, the
    // whole hold nets to the committed frame, and the write is not shown.
    // (Before: the masked 101 committed — `a=1 b=101` — and only because the
    // mask was still up; an isPending(b) probe in between produced `b=100`.)
    const h = setup();
    await settle();
    h.setA(2);
    await settle();
    h.setB(101);
    await settle();
    h.setA(1);
    await settle();
    // (A hold that nets to the committed frame replays the effect with the
    // same value — pre-existing, plain-signal behavior, not pinned here.)
    expect(new Set(h.views)).toEqual(new Set(["a=1 b=100 c=1"]));
    expect(h.b()).toBe(100);
    expect(latest(h.b)).toBe(100);
    await h.release();
    expect(new Set(h.views)).toEqual(new Set(["a=1 b=100 c=1"]));
    expect(h.b()).toBe(100);
    expect(isPending(h.b)).toBe(false);
    h.dispose();
  });

  describe("#2692 preserved: within a synchronous frame the manual write wins, regardless of order", () => {
    it("setA(2); setB(101); flush() — no hold → a=2 b=101", async () => {
      const h = setup({ holds: () => false });
      await settle();
      h.setA(2);
      h.setB(101);
      await settle();
      expect(h.views).toEqual(["a=1 b=100 c=1", "a=2 b=101 c=2"]);
      h.dispose();
    });

    it("setB(101); setA(2); flush() — no hold → a=2 b=101", async () => {
      const h = setup({ holds: () => false });
      await settle();
      h.setB(101);
      h.setA(2);
      await settle();
      expect(h.views).toEqual(["a=1 b=100 c=1", "a=2 b=101 c=2"]);
      h.dispose();
    });

    it("setA(2); setB(101); flush() — the same frame opens the hold → reveals a=2 b=101", async () => {
      const h = setup();
      await settle();
      h.setA(2);
      h.setB(101);
      await settle();
      expect(h.views).toEqual(["a=1 b=100 c=1"]);
      await h.release();
      expect(h.views).toEqual(["a=1 b=100 c=1", "a=2 b=101 c=2"]);
      h.dispose();
    });

    it("separate ticks, no hold: setA(2) | setB(101) → a=2 b=200 → a=2 b=101", async () => {
      const h = setup({ holds: () => false });
      await settle();
      h.setA(2);
      await settle();
      h.setB(101);
      await settle();
      expect(h.views).toEqual(["a=1 b=100 c=1", "a=2 b=200 c=2", "a=2 b=101 c=2"]);
      h.dispose();
    });
  });

  describe("a write made INSIDE the transaction is a proposal: A34(1) last-write-wins is unchanged", () => {
    it("the action that opened T writes b=999 under it, then mainline writes b=101 → a=2 b=101", async () => {
      const h = setup();
      await settle();
      const g1 = deferred();
      const g2 = deferred();
      const act = action(function* () {
        h.setA(2); // T is this action's transaction; b re-derives to 200 under it
        yield g1.promise;
        h.setB(999); // under T: T's staging is now a manual proposal (masked)
        yield g2.promise;
      });
      act();
      await settle();
      expect(latest(h.b)).toBe(200);
      g1.resolve();
      await settle();
      expect(h.views).toEqual(["a=1 b=100 c=1"]);
      expect(latest(h.b)).toBe(999);
      h.setB(101); // a second proposal on the same slot: last write wins
      await settle();
      expect(h.views).toEqual(["a=1 b=100 c=1"]);
      expect(latest(h.b)).toBe(101);
      g2.resolve();
      await h.release();
      expect(h.views).toEqual(["a=1 b=100 c=1", "a=2 b=101 c=2"]);
      h.dispose();
    });

    // Not covered by the ruling's text but decided by its discriminator: an
    // action of its OWN (T2 ≠ T) writing b mid-hold reads the committed frame
    // (`b() === 100` under T2) and hits a staging that is T's pass result —
    // that write is `prev` too, and T2 merges into T at the join.
    it("a separate action (T2 ≠ T) writing b=999 mid-hold is outside T: prev for the re-derivation → a=2 b=200", async () => {
      const h = setup();
      await settle();
      h.setA(2);
      await settle();
      const gate = deferred();
      const act = action(function* () {
        h.setB(999);
        yield gate.promise;
      });
      act();
      await settle();
      expect(h.views).toEqual(["a=1 b=100 c=1"]);
      expect(latest(h.b)).toBe(200);
      gate.resolve();
      await h.release();
      expect(h.views).toEqual(["a=1 b=100 c=1", "a=2 b=200 c=2"]);
      h.dispose();
    });

    it("compute-phase ownedWrite under T (b=201), then mainline b=101 → a=2 b=101", async () => {
      const views: string[] = [];
      const gates: ReturnType<typeof deferred>[] = [];
      let setA!: (v: number) => void;
      let setB!: (v: number) => void;
      let dispose!: () => void;
      createRoot(d => {
        dispose = d;
        const [a, sa] = createSignal(1);
        const [b, sb] = createSignal(() => a() * 100, { ownedWrite: true });
        setA = sa;
        setB = sb;
        const c = createMemo(async () => {
          const v = a();
          if (v === 1) return v;
          const g = deferred();
          gates.push(g);
          await g.promise;
          return v;
        });
        createRenderEffect(
          () => `a=${a()} b=${b()} c=${c()}`,
          v => {
            views.push(v);
          }
        );
        // Runs under T when a=2 is staged: the write is T's own proposal.
        createEffect(
          () => {
            const av = a();
            if (av !== 1) sb(av * 100 + 1);
            return av;
          },
          () => {}
        );
      });
      await settle();
      setA(2);
      await settle();
      setB(101);
      await settle();
      expect(views).toEqual(["a=1 b=100 c=1"]);
      while (gates.length) gates.shift()!.resolve();
      await settle();
      expect(views).toEqual(["a=1 b=100 c=1", "a=2 b=101 c=2"]);
      dispose();
    });
  });

  it("an unrelated hold (T holds k; a unchanged; b unstamped): the mainline write commits at once, as today", async () => {
    const views: string[] = [];
    let gate: ReturnType<typeof deferred> | null = null;
    let setK!: (v: number) => void;
    let setB!: (v: number) => void;
    let b!: () => number;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const [a] = createSignal(1);
      const [k, sk] = createSignal(0);
      const [bb, sb] = createSignal(() => a() * 100);
      setK = sk;
      setB = sb;
      b = bb;
      const c = createMemo(async () => {
        const v = a();
        if (k() === 0) return v;
        gate = deferred();
        await gate.promise;
        return v;
      });
      createRenderEffect(
        () => `a=${a()} b=${bb()} c=${c()} k=${k()}`,
        v => {
          views.push(v);
        }
      );
    });
    await settle();
    setK(1); // hold on k; b never re-derived, not stamped
    await settle();
    setB(101);
    await settle();
    expect(b()).toBe(101);
    expect(isPending(b)).toBe(false);
    expect(views).toEqual(["a=1 b=100 c=1 k=0", "a=1 b=101 c=1 k=0"]);
    gate!.resolve();
    await settle();
    expect(views).toEqual(["a=1 b=100 c=1 k=0", "a=1 b=101 c=1 k=0", "a=1 b=101 c=1 k=1"]);
    dispose();
  });

  describe("store twin — createStore(fn) (CS-R31)", () => {
    function setupStore(opts: { holds?: (a: number) => boolean } = {}) {
      const holds = opts.holds ?? (a => a !== 1);
      const views: string[] = [];
      const gates: ReturnType<typeof deferred>[] = [];
      let dispose!: () => void;
      const h = createRoot(d => {
        dispose = d;
        const [a, setA] = createSignal(1);
        const [s, setS] = createStore(
          d => {
            d.v = a() * 100;
          },
          { v: 0 }
        );
        const c = createMemo(async () => {
          const v = a();
          if (!holds(v)) return v;
          const g = deferred();
          gates.push(g);
          await g.promise;
          return v;
        });
        createRenderEffect(
          () => `a=${a()} s.v=${s.v} c=${c()}`,
          v => {
            views.push(v);
          }
        );
        return { a, setA, s, setS, c };
      });
      return {
        ...h,
        views,
        dispose,
        async release() {
          while (gates.length) gates.shift()!.resolve();
          await settle();
        }
      };
    }

    it("a mainline setter mid-hold becomes the draft's prior state; T re-runs the fold → a=2 s.v=200", async () => {
      const h = setupStore();
      await settle();
      expect(h.views).toEqual(["a=1 s.v=100 c=1"]);
      h.setA(2);
      await settle();
      expect(h.s.v).toBe(100);
      expect(latest(() => h.s.v)).toBe(200);
      h.setS(d => {
        d.v = 101;
      });
      await settle();
      expect(h.views).toEqual(["a=1 s.v=100 c=1"]);
      expect(h.s.v).toBe(100);
      expect(latest(() => h.s.v)).toBe(200);
      expect(isPending(() => h.s.v)).toBe(true);
      await h.release();
      expect(h.views).toEqual(["a=1 s.v=100 c=1", "a=2 s.v=200 c=2"]);
      expect(h.s.v).toBe(200);
      h.dispose();
    });

    it("`a` moves again after the write → the fold follows: a=3 s.v=300", async () => {
      const h = setupStore();
      await settle();
      h.setA(2);
      await settle();
      h.setS(d => {
        d.v = 101;
      });
      await settle();
      h.setA(3);
      await settle();
      expect(h.views).toEqual(["a=1 s.v=100 c=1"]);
      await h.release();
      expect(h.views).toEqual(["a=1 s.v=100 c=1", "a=3 s.v=300 c=3"]);
      h.dispose();
    });

    it("same frame: setA(2); setS(v=101) — the manual write still wins (#2692 / CS-R31)", async () => {
      const h = setupStore({ holds: () => false });
      await settle();
      h.setA(2);
      h.setS(d => {
        d.v = 101;
      });
      await settle();
      expect(h.views).toEqual(["a=1 s.v=100 c=1", "a=2 s.v=101 c=2"]);
      h.dispose();
    });

    it("same frame opening the hold: setA(2); setS(v=101) → reveals a=2 s.v=101", async () => {
      const h = setupStore();
      await settle();
      h.setA(2);
      h.setS(d => {
        d.v = 101;
      });
      await settle();
      expect(h.views).toEqual(["a=1 s.v=100 c=1"]);
      await h.release();
      expect(h.views).toEqual(["a=1 s.v=100 c=1", "a=2 s.v=101 c=2"]);
      h.dispose();
    });

    it("a setter INSIDE the transaction is a proposal: the action that opened T writes v=999, then mainline v=101 → a=2 s.v=101", async () => {
      const h = setupStore();
      await settle();
      const g1 = deferred();
      const g2 = deferred();
      const act = action(function* () {
        h.setA(2);
        yield g1.promise;
        h.setS(d => {
          d.v = 999;
        });
        yield g2.promise;
      });
      act();
      await settle();
      g1.resolve();
      await settle();
      expect(latest(() => h.s.v)).toBe(999);
      h.setS(d => {
        d.v = 101;
      });
      await settle();
      expect(h.views).toEqual(["a=1 s.v=100 c=1"]);
      expect(latest(() => h.s.v)).toBe(101);
      g2.resolve();
      await h.release();
      expect(h.views).toEqual(["a=1 s.v=100 c=1", "a=2 s.v=101 c=2"]);
      h.dispose();
    });
  });
});
