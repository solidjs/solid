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
  createEffect,
  createErrorBoundary,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
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

  // A plain synchronous write (no action, no async) commits at its seam: the
  // pass that read `s` before the frame had a transaction and then
  // `latest(s)` stood — one compute, one effect run — whether the reader is
  // a memo, a render effect or a user effect, of `latest(s)` or of
  // `latest(memo)`. The seam re-derives such a reader only if the frame
  // parks.
  for (const reader of ["memo", "render effect", "user effect", "render effect of latest(memo)"])
    it(`inline [s(), latest] in a flush that commits runs once: ${reader}`, () => {
      let set!: (v: number) => void;
      let passes = 0;
      const seen: string[] = [];
      const dispose = createRoot(d => {
        const [s, _set] = createSignal(0);
        set = _set;
        const m = createMemo(() => s());
        const f =
          reader === "render effect of latest(memo)"
            ? () => (passes++, `v:${s()} l:${latest(m)}`)
            : () => (passes++, `v:${s()} l:${latest(s)}`);
        if (reader === "memo") createRenderEffect(createMemo(f), v => void seen.push(v));
        else
          (reader === "user effect" ? createEffect : createRenderEffect)(
            f,
            (v: string) => void seen.push(v)
          );
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

// C4: a render effect created by a held pass beside the committed frame's
// effect, both reading `[s(), L()]`.
// - The committed frame's effect, a zombie of the parked frame that read a
//   verdict, re-runs at the park seam as the verdict lane's work and tears
//   (`v:0 l:1`, D-26). Before, inline, its run waited in a verdict lane born
//   at that seam, which the seam did not judge (`l:0` through the hold).
// - The held pass's effect was born into the frame (ruling A, #4010): it has
//   no screen, its reads are the transaction's — `v:1 l:1`, one run, inline
//   or through a memo. Before, through a memo once the guess engine had run,
//   its verdict-memo read broke it out into the verdict lane, which
//   re-derived it on the screen (`v:0 l:1`, then `v:1 l:1` at the landing).
// Both with and without an optimistic action having run first (the guess
// engine installed changes which seat a verdict-memo read takes).
describe("C4: a render effect born in a held pass beside the committed frame's [s(), L()]", () => {
  async function runGuessEngine() {
    let resolve!: () => void;
    let set!: (v: number) => void;
    const dispose = createRoot(d => {
      const [x, _set] = createOptimistic(0);
      set = _set;
      createRenderEffect(x, () => {});
      return d;
    });
    flush();
    action(function* () {
      set(1);
      yield new Promise<void>(r => (resolve = r));
    })();
    flush();
    resolve();
    await tick();
    dispose();
  }
  for (const engine of [false, true])
    for (const via of ["inline", "memo"] as const)
      it(`${via}${engine ? ", guess engine installed" : ""}: the committed frame's effect tears, the born one reads its transaction`, async () => {
        if (engine) await runGuessEngine();
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
        expect(log.filter(x => x.startsWith("born@0"))).toEqual(["born@0 v:0 l:1"]);
        expect(log.filter(x => x.startsWith("born@1"))).toEqual(["born@1 v:1 l:1"]);
        expect(log).not.toContain("o:1");
        log.length = 0;
        done();
        await tick();
        // The landing disposes the committed frame's effect; the outer
        // commits; the born effect's values did not change.
        expect(log).toEqual(["o:1"]);
        dispose();
      });
});

// E2/E3 twins of the first-load rule (async-gen seed 91501 #504): the leaf
// reads `latest(view)` where `view` is the async derivation itself, an
// identity memo of it, or a derived store's `v` over it. Its first load is
// in flight in a verdict lane and has produced nothing: loading in all three
// (D-22) — the boundary keeps its fallback. Before, the lane's dissolution
// committed the identity memo (pending on that load, no flight of its own)
// as `undefined`, and `latest()` served it.
describe("latest() of a first load in flight read through an identity memo or a derived store is loading", () => {
  for (const view of ["direct", "identity", "store"] as const)
    it(view, async () => {
      const seen: string[] = [];
      const resolvers: (() => void)[] = [];
      let set!: (v: number) => void;
      const dispose = createRoot(d => {
        const [s, _set] = createSignal(0);
        set = _set;
        const m0 = createMemo(() => 1 + latest(s) + s());
        const m1 = createMemo(() => {
          const v = 1 + latest(m0) + m0();
          return new Promise<number>(r => resolvers.push(() => r(v)));
        });
        let read: () => number | undefined = m1;
        if (view === "identity") read = createMemo(() => m1());
        else if (view === "store") {
          const [store] = createStore<{ v?: number }>(d => {
            d.v = m1();
          }, {});
          read = () => store.v;
        }
        const b = createLoadingBoundary(
          () => {
            // One hole each, as a compiled leaf has them.
            createRenderEffect(
              () => `lm1:${latest(read)}`,
              v => void seen.push(v)
            );
            createRenderEffect(s, () => {});
            createRenderEffect(
              () => latest(s),
              () => {}
            );
            return "content";
          },
          () => "[L]"
        );
        createRenderEffect(b, v => void seen.push(`view=${v}`));
        return d;
      });
      flush();
      expect(seen).toEqual(["view=[L]"]);
      set(2);
      await tick();
      expect(seen).toEqual(["view=[L]"]);
      expect(seen.some(x => x.includes("undefined"))).toBe(false);
      resolvers.forEach(r => r());
      await tick();
      expect(seen.slice(1).sort()).toEqual(["lm1:11", "view=content"]);
      dispose();
    });
});

// async-gen seed 91501 #156: `isPending(m0)` of a first load in flight in a
// verdict lane is loading, as `latest()` of it is (A19 exc. 1, D-22): the
// boundary keeps its fallback until a load lands. Before, the lane pass
// answered `true` and the boundary revealed; the pass after the lane's
// dissolution (the load kept uninitialized) threw, and the revealed leaf
// never ran.
describe("isPending() of a first load in flight in a verdict lane is loading", () => {
  it("the boundary keeps its fallback until the load lands", async () => {
    const seen: string[] = [];
    const flights: { v: number; settle: () => void }[] = [];
    let set!: (v: number) => void;
    const dispose = createRoot(d => {
      const [s, _set] = createSignal(0, { ownedWrite: true });
      set = _set;
      const m0 = createMemo(() => {
        const v = 1 + latest(s);
        return new Promise<number>((res, rej) =>
          flights.push({ v, settle: () => (v === 1 ? rej(new Error("m0:1")) : res(v)) })
        );
      });
      const b = createLoadingBoundary(
        () => {
          createRenderEffect(
            () => `ls:${latest(s)} pm:${isPending(m0)}`,
            v => void seen.push(v)
          );
          return "content";
        },
        () => "[L]"
      );
      createRenderEffect(b, v => void seen.push(`view=${v}`));
      return d;
    });
    flush();
    set(3);
    await new Promise(r => setTimeout(r, 0));
    flush();
    expect(seen).toEqual(["view=[L]"]);
    flights.shift()!.settle();
    await tick();
    expect(seen).toEqual(["view=[L]"]);
    flights.shift()!.settle();
    await tick();
    expect(seen).toEqual(["view=[L]", "ls:3 pm:false", "view=content"]);
    dispose();
  });
});

// async-gen seed 91501 #1831 (E1, grouped vs split): an error caught from an
// async memo whose source threw stays the display while that memo re-asks
// (D-39: a pending is not a value). Before, the boundary healed the moment
// the source answered, and the Loading inside — revealed behind the error,
// never shown — kept its content with its readers still loading: one
// grouped effect held every hole, split effects showed the ones that
// answered (`latest()` of the first load is loading too since D-22 here; on
// `next` it served `undefined`). Now the error stays until the re-ask lands,
// grouped or split.
describe("an error stays the display while the memo it came through re-asks", () => {
  for (const form of ["grouped", "split"] as const)
    it(form, async () => {
      const flights: { v: number; res: (v: number) => void }[] = [];
      let set!: (v: number) => void;
      const out: Record<string, string> = {};
      const screens: string[] = [];
      const dispose = createRoot(d => {
        const [s, _set] = createSignal(1);
        set = _set;
        const m0 = createMemo(() => {
          const v = 1 + s();
          if (v % 4 === 1) throw new Error("m0:" + v);
          return v;
        });
        const m1 = createMemo(() => {
          const v = 1 + m0();
          return new Promise<number>(res => flights.push({ v, res }));
        });
        const view = createErrorBoundary(
          () =>
            createLoadingBoundary(
              () => {
                if (form === "grouped")
                  createRenderEffect(
                    () => [latest(s), latest(m1)],
                    v => void ((out.a = String(v[0])), (out.b = String(v[1])))
                  );
                else {
                  createRenderEffect(
                    () => latest(s),
                    v => void (out.a = String(v))
                  );
                  createRenderEffect(
                    () => latest(m1),
                    v => void (out.b = String(v))
                  );
                }
                return "content";
              },
              () => "[L]"
            ),
          () => "[E]"
        );
        createRenderEffect(view, v => void (out.view = String(v)));
        return d;
      });
      const screen = () =>
        screens.push(out.view === "content" ? `a=${out.a} b=${out.b}` : out.view);
      flush();
      screen();
      set(0);
      await tick();
      screen();
      set(2);
      await tick();
      screen();
      expect(flights.map(f => f.v)).toEqual([3, 4]);
      flights[1].res(4);
      await tick();
      screen();
      expect(screens).toEqual(["[L]", "[E]", "[E]", "a=2 b=4"]);
      dispose();
    });
});
