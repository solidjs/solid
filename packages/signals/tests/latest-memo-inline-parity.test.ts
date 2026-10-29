/**
 * A `latest()` read inline and the same read through a memo
 * (`L = createMemo(() => latest(x))`) show the same screen (F-6, D-25, D-26).
 *
 * 1. #4284 through a memo: an optimistic `x` with a downstream async memo,
 *    one render effect `${x()} ${derived()} / ${L()}`. The lane holds on
 *    `derived(5)`; `latest(guess)` tears beside the held screen — `1 x1 / 5`,
 *    inline or memo, one effect or split — then `5 x5 / 5` at the landing.
 *    Before, the memo form parked the whole effect with the lane: `1 x1 / 1`.
 * 2. A plain write outside any action, beside an async memo (the flush
 *    parks on it, A28/A15). `D = createMemo(() => `v:${s()} l:${L()}`)` and a
 *    render effect `v:${s()} a:${A()} l:${L()}` show the screen beside the
 *    proposal — `v:0 l:1` and `v:0 a:0 l:1` — inline or memo, in either
 *    read order. Before, the inline D read `s()`'s staging before the frame
 *    had a transaction and stayed the frame's (`v:0 l:0` until the landing),
 *    and the memo form's effect held on `A()` (`l:0`).
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest
} from "../src/index.js";

type Via = "inline" | "memo";

async function tick() {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
}

describe("#4284 through a memo: latest(guess) tears beside a lane held on downstream async", () => {
  function setup(via: Via, lFirst: boolean) {
    let resolveDerived: (() => void) | undefined;
    let resolveAction!: () => void;
    let attempt!: () => Promise<void>;
    const out = { one: "", split: "" };
    const dispose = createRoot(d => {
      const [base] = createSignal(1);
      const [x, set] = createOptimistic(() => base());
      let L!: () => number;
      const makeL = () => (L = via === "memo" ? createMemo(() => latest(x)) : () => latest(x));
      // Creation order decides which of `L` and `derived` the heap runs
      // first in the action's flush (same height).
      if (lFirst) makeL();
      const derived = createMemo(() =>
        x() === 1 ? "x1" : new Promise<string>(r => (resolveDerived = () => r("x" + x())))
      );
      if (!lFirst) makeL();
      attempt = action(function* () {
        set(5);
        yield new Promise<void>(r => (resolveAction = r));
      });
      createRenderEffect(
        () => `${x()} ${derived()} / ${L()}`,
        v => void (out.one = v)
      );
      createRenderEffect(
        () => `${L()}`,
        v => void (out.split = v)
      );
      return d;
    });
    return {
      dispose,
      attempt,
      out,
      resolveDerived: () => resolveDerived!(),
      resolveAction: () => resolveAction()
    };
  }

  for (const via of ["inline", "memo"] as const)
    for (const lFirst of [true, false])
      it(`${via}, L created ${lFirst ? "before" : "after"} derived: 1 x1 / 5, then 5 x5 / 5`, async () => {
        const t = setup(via, lFirst);
        flush();
        await tick();
        expect(t.out).toEqual({ one: "1 x1 / 1", split: "1" });
        void t.attempt();
        flush();
        await tick();
        expect(t.out).toEqual({ one: "1 x1 / 5", split: "5" });
        t.resolveDerived();
        await tick();
        expect(t.out).toEqual({ one: "5 x5 / 5", split: "5" });
        t.resolveAction();
        await tick();
        expect(t.out).toEqual({ one: "1 x1 / 1", split: "1" });
        t.dispose();
      });
});

describe("a plain write beside an async memo: the screen beside latest(), inline or memo", () => {
  function setup(via: Via, order: "plain-first" | "latest-first") {
    let resolveA: (() => void) | undefined;
    let set!: (v: number) => void;
    const out = { d: "", e: "" };
    const dispose = createRoot(d => {
      const [s, _set] = createSignal(0);
      set = _set;
      const A = createMemo(() => {
        const v = s();
        return v === 0 ? 0 : new Promise<number>(r => (resolveA = () => r(v)));
      });
      const L = via === "memo" ? createMemo(() => latest(s)) : () => latest(s);
      createRenderEffect(
        () => `v:${s()} a:${A()} l:${L()}`,
        v => void (out.e = v)
      );
      const D = createMemo(() => {
        if (order === "latest-first") {
          const l = L();
          return `v:${s()} l:${l}`;
        }
        return `v:${s()} l:${L()}`;
      });
      createRenderEffect(D, v => void (out.d = v));
      return d;
    });
    return {
      dispose,
      out,
      set: (v: number) => set(v),
      resolveA: () => resolveA!()
    };
  }

  for (const via of ["inline", "memo"] as const)
    for (const order of ["plain-first", "latest-first"] as const)
      it(`${via}, ${order}: v:0 l:1 beside the held write, then v:1 l:1 at the landing`, async () => {
        const t = setup(via, order);
        flush();
        expect(t.out).toEqual({ d: "v:0 l:0", e: "v:0 a:0 l:0" });
        t.set(1);
        flush();
        await tick();
        expect(t.out).toEqual({ d: "v:0 l:1", e: "v:0 a:0 l:1" });
        t.resolveA();
        await tick();
        expect(t.out).toEqual({ d: "v:1 l:1", e: "v:1 a:1 l:1" });
        t.dispose();
      });

  it("inline [s(), latest(s)] in a flush that commits runs once (the seam re-derives only a parked frame's reader)", () => {
    let set!: (v: number) => void;
    let passes = 0;
    const seen: string[] = [];
    const dispose = createRoot(d => {
      const [s, _set] = createSignal(0);
      set = _set;
      const D = createMemo(() => (passes++, `v:${s()} l:${latest(s)}`));
      createRenderEffect(D, v => void seen.push(v));
      return d;
    });
    flush();
    passes = 0;
    set(1);
    flush();
    expect(seen).toEqual(["v:0 l:0", "v:1 l:1"]);
    expect(passes).toBe(1);
    dispose();
  });
});

// A memo of a verdict read moves its async derivation into the verdict lane
// (F-6: async derived from a display-ahead read is held in that lane). That
// derivation's first load, still in flight, has produced no value:
// `latest()` of it throws NotReady (D-22) — the boundary keeps its fallback —
// never `undefined`. (async-gen seed 3289 #464: `m0 = s0() + latest(s0)`
// reached this once its pass re-derived as a verdict reader; the
// `latest(s0)`-only memo reached it on `next` already.)
describe("latest() of a first load in flight in a verdict lane throws, never undefined", () => {
  for (const shape of ["latest(s)", "s() + latest(s)"] as const)
    it(`m0 = ${shape}, m1 = async(m0), a leaf reading latest(m1) under Loading`, async () => {
      const seen: string[] = [];
      const resolvers: (() => void)[] = [];
      let set!: (v: number) => void;
      const dispose = createRoot(d => {
        const [s, _set] = createSignal(0);
        set = _set;
        const m0 = createMemo(() => (shape === "latest(s)" ? 0 : s()) + latest(s));
        const m1 = createMemo(() => {
          m0();
          return new Promise<number>(r => resolvers.push(() => r(0)));
        });
        const view = createLoadingBoundary(
          () => {
            createRenderEffect(
              () => `lm1:${latest(m1)}`,
              v => void seen.push(v)
            );
            return "content";
          },
          () => "[L]"
        );
        createRenderEffect(view, v => void seen.push(`view=${v}`));
        return d;
      });
      flush();
      expect(seen).toEqual(["view=[L]"]);
      set(3);
      flush();
      await tick();
      expect(seen).toEqual(["view=[L]"]);
      // Settle the flights so no transaction outlives the test.
      resolvers.forEach(r => r());
      await tick();
      dispose();
    });
});

// C4: a render effect created by a held pass (ruling A: the transaction's,
// it computes) beside the committed frame's effect, both reading
// `[s(), L()]`. The committed frame's effect, a zombie of the parked frame
// that read a verdict, re-runs at the park seam as the verdict lane's work
// and tears (`v:0 l:1`, D-26) — inline as through a memo. Before, inline, its
// run waited in a verdict lane born at that seam, which the seam did not
// judge: it never ran during the hold (`l:0`). (The effect the held pass
// created is not pinned here: inline it reads its transaction's values
// (#4010); through a memo, with the guess engine installed, it is verdict
// lane work re-derived on the screen.)
describe("C4: a render effect born in a held pass beside the committed frame's [s(), L()]", () => {
  for (const via of ["inline", "memo"] as const)
    it(`${via}: the committed frame's effect tears beside the hold`, async () => {
      const log: string[] = [];
      let done!: () => void;
      let set!: (v: number) => void;
      const dispose = createRoot(d => {
        const [s, _set] = createSignal(0);
        set = _set;
        const L = via === "memo" ? createMemo(() => latest(s)) : () => latest(s);
        const outer = createMemo(() => {
          const v = s();
          createRenderEffect(
            () => `born@${v} v:${s()} l:${L()}`,
            x => void log.push(x)
          );
          return v;
        });
        createRenderEffect(outer, x => void log.push(`o:${x}`));
        return d;
      });
      flush();
      expect(log).toEqual(["born@0 v:0 l:0", "o:0"]);
      log.length = 0;
      action(function* () {
        set(1);
        yield new Promise<void>(r => (done = r));
      })();
      flush();
      await tick();
      // The committed frame's effect: one run, the tear. The held pass's
      // effect runs once (its seam re-derive would repeat its transaction's
      // values).
      expect(log.filter(x => x.startsWith("born@0"))).toEqual(["born@0 v:0 l:1"]);
      expect(log.filter(x => x.startsWith("born@1")).length).toBe(1);
      expect(log).not.toContain("o:1");
      log.length = 0;
      done();
      await tick();
      // The landing disposes it; the outer commits.
      expect(log.filter(x => x.startsWith("born@0"))).toEqual([]);
      expect(log).toContain("o:1");
      dispose();
    });
});
