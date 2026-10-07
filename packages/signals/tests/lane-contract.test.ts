// Lanes — the rulings of 2026-10-01 (maintainer), on top of L2/C:
//
//   1. a lane is a sub-frame of the transition of the frame the optimistic
//      write is made in ("a new base of a transition"): it reads the parent's
//      staged world through, breaks out of the parent's hold (shows now), and
//      holds itself if its own derivations hit async. It ends when the parent
//      ends: the guess reverts to the base, or lands as the truth.
//   2. no parent — a frame that does not park — and the write is as if it
//      never happened.
//   3. the truth is whatever recomputes the node (A18): equal to the guess it
//      confirms silently (nothing re-runs); different, it re-derives the
//      graph under the parent and reveals at the parent's commit while the
//      display keeps the guess.
//   4. direct reads see the guess throughout — unblocked ("direct read shows
//      optimistic, effect waits") and blocked ("the optimistic write is the
//      pending value of that sub transition").
//   5. a render effect off the lane re-run mid-hold is a stale reader of a
//      blocked lane (#3460); a never-shown guess that is superseded is void.
//   6. nesting: an optimistic write whose frame's transaction is a lane has
//      that lane as its parent.

import { afterEach, describe, expect, it } from "vitest";
import {
  createEffect,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  DEV,
  flush
} from "../src/index.js";

afterEach(() => flush());

async function settled() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  flush();
}

/** `src` drives an async `truth`; `opt` is the writable optimistic memo over
 * it; `dbl` a derivation of the guess; render effects on each. The `truth:`
 * effect is the observer that holds the parent transaction. */
function fixture() {
  const [src, setSrc] = createSignal(0);
  let resolve!: (v: number) => void;
  const log: string[] = [];
  let opt!: () => number;
  let setOpt!: (v: number | ((p: number) => number)) => void;
  let dbl!: () => number;
  const dispose = createRoot(d => {
    const truth = createMemo(() => (src() ? new Promise<number>(r => (resolve = r)) : 0));
    [opt, setOpt] = createOptimistic(() => truth());
    dbl = createMemo(() => opt() * 2);
    createRenderEffect(opt, v => void log.push(`opt:${v}`));
    createRenderEffect(dbl, v => void log.push(`dbl:${v}`));
    createRenderEffect(truth, v => void log.push(`truth:${v}`));
    return d;
  });
  flush();
  return {
    src,
    setSrc,
    opt,
    setOpt,
    dbl,
    log,
    dispose,
    land: (v: number) => (resolve(v), settled())
  };
}

describe("lane contract 1 — a guess breaks out of its parent's hold and ends with it", () => {
  it("shows while the parent holds; a confirming truth is silent; one frame at the landing", async () => {
    const f = fixture();
    expect(f.log).toEqual(["opt:0", "dbl:0", "truth:0"]);

    // One frame: the input change (held — truth goes pending) and the guess.
    f.setSrc(1);
    f.setOpt(5);
    flush();
    expect(f.src()).toBe(0);
    expect(f.opt()).toBe(5);
    expect(f.dbl()).toBe(10);
    expect(f.log.slice(3)).toEqual(["opt:5", "dbl:10"]);

    // The truth equals the guess: nothing re-runs; the parent lands.
    await f.land(5);
    expect(f.src()).toBe(1);
    expect(f.opt()).toBe(5);
    expect(f.log.slice(5)).toEqual(["truth:5"]);
    f.dispose();
  });

  it("a differing truth re-derives under the parent and reveals at its commit; the display keeps the guess until then", async () => {
    const f = fixture();
    f.setSrc(1);
    f.setOpt(5);
    flush();
    expect(f.log.slice(3)).toEqual(["opt:5", "dbl:10"]);

    await f.land(7);
    expect(f.src()).toBe(1);
    expect(f.opt()).toBe(7);
    expect(f.dbl()).toBe(14);
    // One reveal: the truth and everything derived from it, never a frame
    // mixing the guess and the truth.
    expect(f.log.slice(5).sort()).toEqual(["dbl:14", "opt:7", "truth:7"]);
    f.dispose();
  });

  it("a plain optimistic signal reverts to the value it covered when the parent lands", async () => {
    const [src, setSrc] = createSignal(0);
    let resolve!: (v: number) => void;
    const log: string[] = [];
    let setO!: (v: number) => void;
    let o!: () => number;
    const dispose = createRoot(d => {
      const data = createMemo(() => (src() ? new Promise<number>(r => (resolve = r)) : 0));
      [o, setO] = createOptimistic(0);
      createRenderEffect(o, v => void log.push(`o:${v}`));
      createRenderEffect(data, v => void log.push(`data:${v}`));
      return d;
    });
    flush();
    setSrc(1);
    setO(5);
    flush();
    expect(o()).toBe(5);
    expect(log).toEqual(["o:0", "data:0", "o:5"]);

    resolve(1);
    await settled();
    expect(o()).toBe(0);
    expect(log.slice(3).sort()).toEqual(["data:1", "o:0"]);
    dispose();
  });

  it("a second guess in the same transition replaces the first; the base is unchanged", async () => {
    const f = fixture();
    f.setSrc(1);
    f.setOpt(5);
    flush();
    f.setOpt(6);
    flush();
    expect(f.opt()).toBe(6);
    expect(f.log.slice(3)).toEqual(["opt:5", "dbl:10", "opt:6", "dbl:12"]);
    // The truth lands at its committed value: `truth` itself re-runs nothing;
    // the guess reverts.
    await f.land(0);
    expect(f.opt()).toBe(0);
    expect(f.log.slice(7).sort()).toEqual(["dbl:0", "opt:0"]);
    f.dispose();
  });
});

describe("lane contract 2 — no parent, no write", () => {
  it("an optimistic write in a frame that does not park is as if it never happened", () => {
    const f = fixture();
    f.setOpt(5);
    flush();
    expect(f.opt()).toBe(0);
    expect(f.dbl()).toBe(0);
    expect(f.log.length).toBe(3);

    // Beside a plain write that commits: the plain write lands, the guess
    // does not.
    const [x, setX] = createSignal(0);
    createRoot(() => createRenderEffect(x, v => void f.log.push(`x:${v}`)));
    flush();
    setX(1);
    f.setOpt(5);
    flush();
    expect(x()).toBe(1);
    expect(f.opt()).toBe(0);
    expect(f.log.filter(e => e.startsWith("opt:"))).toEqual(["opt:0"]);
    f.dispose();
  });
});

describe("lane contract 3 — a lane holds itself", () => {
  function blockedFixture() {
    const f = fixture();
    let resolveSlow!: (v: string) => void;
    let slow!: () => string;
    createRoot(() => {
      // A derivation of the guess that hits async: the lane's own flight.
      slow = createMemo(() => (f.opt() ? new Promise<string>(r => (resolveSlow = r)) : "none"));
      createRenderEffect(slow, v => void f.log.push(`slow:${v}`));
    });
    flush();
    expect(f.log.slice(3)).toEqual(["slow:none"]);
    return {
      ...f,
      slow,
      landSlow: (v: string) => (resolveSlow(v), settled()),
      slowResolver: () => resolveSlow
    };
  }

  it("a derivation of the guess hitting async holds the lane's frame, not the parent's; direct reads see the guess; the lane reveals at its own flight", async () => {
    const f = blockedFixture();
    f.setSrc(1);
    f.setOpt(5);
    flush();
    // Nothing of the lane shows yet; direct reads see the guess (ruling 4).
    expect(f.log.length).toBe(4);
    expect(f.opt()).toBe(5);
    expect(f.dbl()).toBe(10);
    expect(f.src()).toBe(0);

    // The lane's flight lands: the lane reveals as one frame. The parent is
    // still held (truth in flight).
    await f.landSlow("s5");
    expect(f.src()).toBe(0);
    expect(f.log.slice(4).sort()).toEqual(["dbl:10", "opt:5", "slow:s5"]);

    await f.land(5);
    expect(f.src()).toBe(1);
    expect(f.log.slice(7)).toEqual(["truth:5"]);
    f.dispose();
  });

  it("a render effect off the lane re-run mid-hold is a stale reader of a blocked lane (#3460)", async () => {
    const f = blockedFixture();
    const [tick, setTick] = createSignal(0);
    createRoot(() =>
      createRenderEffect(
        () => `${tick()}:${f.opt()}`,
        v => void f.log.push(`both:${v}`)
      )
    );
    flush();
    f.setSrc(1);
    f.setOpt(5);
    flush();
    expect(f.log.at(-1)).toBe("both:0:0");

    // An unrelated write re-runs it: committed guess (0), published now.
    setTick(1);
    flush();
    expect(tick()).toBe(1);
    expect(f.log.at(-1)).toBe("both:1:0");

    // The lane reveals: it catches up.
    await f.landSlow("s5");
    expect(f.log.slice(-4).sort()).toEqual(["both:1:5", "dbl:10", "opt:5", "slow:s5"]);
    f.dispose();
  });

  // Maintainer, 2026-10-01: a blocked lane blocks its parent. The lane's
  // pending work derives from the frame's write through the guess, so the
  // frame is not complete without it (A15): landing it would commit `src`
  // beside `slow` still showing the derivation of the old one. (This
  // contract's first form let the parent land and the lane continue alone —
  // reversed by the maintainer's own createOptimistic pin, "pending source
  // does not leak".)
  it("a confirm while the lane is still blocked: the parent waits for the lane's flight; one frame when it lands", async () => {
    const f = blockedFixture();
    f.setSrc(1);
    f.setOpt(5);
    flush();
    await f.land(5);
    // The truth confirms the guess, but the lane's flight is up: nothing
    // lands, nothing shows.
    expect(f.src()).toBe(0);
    expect(f.log.slice(4)).toEqual([]);

    await f.landSlow("s5");
    expect(f.src()).toBe(1);
    expect(f.opt()).toBe(5);
    expect(f.log.slice(4).sort()).toEqual(["dbl:10", "opt:5", "slow:s5", "truth:5"]);
    f.dispose();
  });

  it("a never-shown guess that is superseded is void: the truth's derivation is what lands", async () => {
    const f = blockedFixture();
    f.setSrc(1);
    f.setOpt(5);
    flush();
    expect(f.log.length).toBe(4);
    const guessFlight = f.slowResolver();

    // The truth differs while the lane is blocked. The guess is dropped, the
    // graph re-derives from 7 — slow re-asks for 7 — and the parent waits
    // for that; the truth is the parent's held write meanwhile.
    await f.land(7);
    expect(f.src()).toBe(0);
    expect(f.opt()).toBe(0);
    expect(f.log.length).toBe(4);
    expect(f.slowResolver()).not.toBe(guessFlight);

    // The guess's flight landing is inert.
    guessFlight("s5");
    await settled();
    expect(f.log.length).toBe(4);

    await f.landSlow("s7");
    expect(f.src()).toBe(1);
    expect(f.log.slice(4).sort()).toEqual(["dbl:14", "opt:7", "slow:s7", "truth:7"]);
    f.dispose();
  });
});

describe("lane hardening — errors, disposal, nesting, growth", () => {
  it("a first user-effect failure in a shown lane publishes without waiting for its parent", async () => {
    const f = fixture();
    const errors: string[] = [];
    f.setSrc(1);
    f.setOpt(5);
    flush();
    const dispose = createRoot(d => {
      createEffect(
        () => {
          if (f.opt() === 5) throw new Error("boom");
          return "ok";
        },
        { effect: () => {}, error: (e: any) => void errors.push(e.message) }
      );
      return d;
    });
    flush();
    expect(errors).toEqual(["boom"]);
    await f.land(5);
    expect(errors).toEqual(["boom"]);
    dispose();
    f.dispose();
  });

  it("a lane pass that throws errors its node like any pass — contained by a user effect's error arm; the lane and the parent are unaffected", async () => {
    const f = fixture();
    const errors: string[] = [];
    createRoot(() => {
      const bad = createMemo(() => {
        if (f.opt() === 5) throw new Error("boom");
        return "ok";
      });
      createEffect(bad, {
        effect: v => void f.log.push(`bad:${v}`),
        error: (e: any) => void errors.push(e.message)
      });
    });
    flush();
    expect(f.log.at(-1)).toBe("bad:ok");
    f.setSrc(1);
    f.setOpt(5);
    flush();
    // The guess shows; the erroring derivation takes its reader's error arm.
    expect(f.opt()).toBe(5);
    expect(f.log.slice(-2).sort()).toEqual(["dbl:10", "opt:5"]);
    expect(errors).toEqual(["boom"]);
    await f.land(5);
    expect(f.src()).toBe(1);
    // Confirmed: the guess is the truth; `bad` is not re-run (nothing
    // changed for it), so no second error.
    expect(f.log.at(-1)).toBe("truth:5");
    expect(errors).toEqual(["boom"]);
    f.dispose();
  });

  it("disposing the root mid-lane disposes everything once; the parent's landing finds nothing to land", async () => {
    const f = fixture();
    f.setSrc(1);
    f.setOpt(5);
    flush();
    expect(f.opt()).toBe(5);
    f.dispose();
    const len = f.log.length;
    // Nothing runs after disposal: not the lane's end, not the landing.
    await f.land(5);
    expect(f.log.length).toBe(len);
    f.setOpt(6);
    flush();
    expect(f.log.length).toBe(len);
  });

  it("disposing the roots while the lane is blocked: no reveal, no landing, no runs", async () => {
    const f = fixture();
    let resolveSlow!: (v: string) => void;
    const dispose2 = createRoot(d => {
      const slow = createMemo(() =>
        f.opt() ? new Promise<string>(r => (resolveSlow = r)) : "none"
      );
      createRenderEffect(slow, v => void f.log.push(`slow:${v}`));
      return d;
    });
    flush();
    f.setSrc(1);
    f.setOpt(5);
    flush();
    const len = f.log.length;
    f.dispose();
    dispose2();
    resolveSlow("s5");
    await settled();
    await f.land(5);
    expect(f.log.length).toBe(len);
  });

  it("a nested guess (written in a lane's own frame) has the lane as its parent and ends with it", async () => {
    // Blocked lane: its flight's landing is the lane's own frame. A write
    // made in that frame's pure phase (an owned write in a derivation) is
    // the lane's; one made in an effect callback would be the next round's.
    const f = fixture();
    let resolveSlow!: (v: string) => void;
    let inner!: () => string;
    let setInner!: (v: string) => void;
    createRoot(() => {
      [inner, setInner] = createOptimistic("base", { ownedWrite: true } as any);
      const slow = createMemo(() =>
        f.opt() ? new Promise<string>(r => (resolveSlow = r)) : "none"
      );
      createMemo(() => {
        const v = slow();
        if (v === "s5") setInner("guess");
        return v;
      });
      createRenderEffect(slow, v => void f.log.push(`slow:${v}`));
      createRenderEffect(inner, v => void f.log.push(`inner:${v}`));
    });
    flush();
    f.setSrc(1);
    f.setOpt(5);
    flush();
    resolveSlow("s5");
    await settled();
    expect(f.log.slice(-4).sort()).toEqual(["dbl:10", "inner:guess", "opt:5", "slow:s5"]);
    expect(inner()).toBe("guess");

    // The outer lane ends with its parent; the nested one with the outer.
    await f.land(5);
    expect(f.src()).toBe(1);
    expect(inner()).toBe("base");
    expect(f.log.slice(-2).sort()).toEqual(["inner:base", "truth:5"]);
    f.dispose();
  });

  it("a long-lived lane does not grow its bookkeeping with every pass", async () => {
    const owners = new Set<any>();
    DEV!.hooks.onOwner = o => void owners.add(o);
    try {
      const f = fixture();
      const [tick, setTick] = createSignal(0);
      createRoot(() =>
        createRenderEffect(
          () => `${f.opt()}/${tick()}`,
          () => {}
        )
      );
      flush();
      f.setSrc(1);
      f.setOpt(5);
      flush();
      // Internal layout: the guess node carries its lane on `_x._transaction`;
      // the lane's `_nodes` is bounded by distinct nodes, not by passes.
      const guess = [...owners].find(o => o._x?._transaction?._lane);
      expect(guess).toBeDefined();
      const lane = guess._x._transaction;
      const before = lane._nodes.length;
      for (let i = 1; i <= 50; i++) {
        setTick(i);
        flush();
      }
      expect(lane._nodes.length).toBe(before);
      await f.land(5);
      f.dispose();
    } finally {
      DEV!.hooks.onOwner = undefined;
    }
  });
});

describe("lane contract 4 — a lane sees the screen plus its own guesses (maintainer, 2026-10-01)", () => {
  // A held write is held because showing it would tear against the rest of
  // its frame; a lane revealing a derivation of it would show it anyway,
  // beside inputs still committed elsewhere on the page. The guess is the
  // one value the user opted into predicting. So lane work reading a node
  // the parent holds is a stale reader of it: the committed value now, a
  // re-derivation at the parent's landing. (Replaces this contract's first
  // form, read-through — `view:5/b` — which leaked `label`'s held write.)
  it("a lane pass reading the parent's held write derives from the committed value; the landing re-derives it", async () => {
    const [src, setSrc] = createSignal(0);
    const [label, setLabel] = createSignal("a");
    let resolve!: (v: number) => void;
    const log: string[] = [];
    let setO!: (v: number) => void;
    const dispose = createRoot(d => {
      const data = createMemo(() => (src() ? new Promise<number>(r => (resolve = r)) : 0));
      const [o, s] = createOptimistic(0);
      setO = s;
      createRenderEffect(data, v => void log.push(`data:${v}`));
      createRenderEffect(label, v => void log.push(`label:${v}`));
      // One hole reading the guess and a held plain write.
      createRenderEffect(
        () => `${o()}/${label()}`,
        v => void log.push(`view:${v}`)
      );
      return d;
    });
    flush();
    expect(log).toEqual(["data:0", "label:a", "view:0/a"]);

    // The frame: a plain write (held with the flight), a guess.
    setSrc(1);
    setLabel("b");
    setO(5);
    flush();
    // `label` is held: the screen still says `a` everywhere, the lane's view
    // included. The guess shows.
    expect(label()).toBe("a");
    expect(log.slice(3)).toEqual(["view:5/a"]);

    resolve(1);
    await settled();
    expect(label()).toBe("b");
    expect(log.slice(4).sort()).toEqual(["data:1", "label:b", "view:0/b"]);
    dispose();
  });

  // The case read-through was built for, and why it needs none of it. The
  // parent holds two flights; the guess over one of them has a downstream
  // async of its own, so the lane is blocked on it. The guessed-over flight
  // lands first and differs: the lane dissolves into the parent, and the
  // downstream refetch — now the parent's own work, reading the truth as a
  // member — starts at once, held off screen with everything else. It does
  // not wait for the parent's other flight, and nothing shows until the
  // parent lands as one frame.
  it("async → optimistic → async: a corrected guess refetches downstream at once, without waiting for the parent's other flight", async () => {
    const [src, setSrc] = createSignal(0);
    let resolveTruth!: (v: number) => void;
    let resolveOther!: (v: number) => void;
    const detailResolvers = new Map<number, (v: number) => void>();
    const fetched: number[] = [];
    const log: string[] = [];
    let setOpt!: (v: number) => void;
    const dispose = createRoot(d => {
      const truth = createMemo(() => (src() ? new Promise<number>(r => (resolveTruth = r)) : 0));
      const other = createMemo(() => (src() ? new Promise<number>(r => (resolveOther = r)) : 0));
      const [opt, s] = createOptimistic(() => truth());
      setOpt = s;
      const detail = createMemo(() => {
        const v = opt();
        fetched.push(v);
        return v === 0 ? 0 : new Promise<number>(r => detailResolvers.set(v, r));
      });
      createRenderEffect(
        () => `${opt()}|${detail()}|${other()}`,
        v => void log.push(v)
      );
      return d;
    });
    flush();
    expect(log).toEqual(["0|0|0"]);

    setSrc(1); // the parent: `truth` and `other` in flight
    setOpt(5); // the guess over `truth`; `detail` refetches with it
    flush();
    expect(fetched).toEqual([0, 5]);
    expect(log).toEqual(["0|0|0"]); // the lane is blocked on `detail`

    resolveTruth(7); // lands first, and differs
    await settled();
    expect(fetched).toEqual([0, 5, 7]); // the refetch with the truth, now — `other` is still up
    expect(log).toEqual(["0|0|0"]);

    detailResolvers.get(7)!(70);
    await settled();
    expect(log).toEqual(["0|0|0"]); // held: the parent still waits on `other`

    resolveOther(1);
    await settled();
    expect(log).toEqual(["0|0|0", "7|70|1"]); // one frame
    dispose();
  });
});
