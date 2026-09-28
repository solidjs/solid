/**
 * #3698 — a tracked read served an ACTIVE optimistic override is lane work,
 * not a transaction entry.
 *
 * The reader of an override is a LANE MEMBER (A17/A18, lanes stage #3479):
 * its pass publishes a derived override, displays at once, and is promoted or
 * reverted with the action (`resolveOptimisticNodes`). Membership is not
 * entry (maintainer ruling 2026-09-15, #3460: "a held lane is basically a
 * micro transition from the outside… we wouldn't hold a sync write on a
 * transition. Lanes are the same"). So an unrelated synchronous write that
 * re-runs such a reader is a plain mainline tick: it publishes at once, is
 * not pending, and the action stays open.
 *
 * The report's `Show` broke this through its children, not its reads: the
 * compiler emits a memo INSIDE the `when` getter, so `Show`'s condition memo
 * owns a child. A lane pass over a memo that owns children parked the
 * previous children as a #3404 transaction zombie, which queued the memo as
 * a pending node of the action "for the zombies alone" and stamped it
 * (#3662's diagnosis, ruled for effects); its next mainline recompute then
 * re-entered the hold (`recompute`'s stamped-memo arm) and adopted the
 * unrelated write. A memo's lane pass now parks a LANE frame like an
 * effect's (CONFIG_LANE_FRAME): retired when the lane's queue applies the
 * pass — at once for a lane that is not held, at the release for one that is
 * — and the memo is never the transaction's pending node.
 *
 * Contrast: entry remains for a reader served HELD or SUPERSEDED truth — an
 * optimistic node whose own source landed a different value (A18, #3331) hands
 * its tracked readers the staged truth, and a tick that re-runs such a reader
 * IS held with the transaction (A29).
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  onCleanup
} from "../src/index.js";

async function settle() {
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flush();
  }
}

/** The report, primitives only. `shown` is `Show`'s condition memo in the
 * compiler's shape: its pass creates a child memo over the override. */
function reportGraph(opts: { confirm?: boolean; heldLane?: boolean } = {}) {
  const log: string[] = [];
  const cleanups: string[] = [];
  const outside: string[] = [];
  let setDrag!: (v: boolean) => void;
  let drag!: () => boolean;
  let optimistic!: () => boolean;
  let move!: () => Promise<void>;
  let resolveMove!: () => void;
  let resolveDetails!: () => void;
  let gen = 0;
  createRoot(() => {
    const [src, setSrc] = createSignal(false);
    const [opt, setOptimistic] = createOptimistic(() => src());
    const [d, sd] = createSignal(false);
    optimistic = opt;
    drag = d;
    setDrag = sd;
    move = action(function* () {
      setOptimistic(true);
      yield new Promise<void>(r => (resolveMove = r));
      if (opts.confirm) setSrc(true);
    });
    const shown = createMemo(() => {
      const g = ++gen;
      onCleanup(() => cleanups.push(`cleanup ${g}`));
      return createMemo(() => !!optimistic())() ? !drag() : optimistic();
    });
    createRenderEffect(shown, v => {
      log.push(v ? "shown" : "hidden");
    });
    if (opts.heldLane) {
      // An async memo derived from the override: its flight holds the lane.
      const details = createMemo(() =>
        optimistic() ? new Promise<string>(r => (resolveDetails = () => r("d1"))) : "d0"
      );
      createRenderEffect(details, () => {});
    }
    // A render effect OFF the lane — re-run by the sync write alone.
    createRenderEffect(
      () => `drag=${drag()} opt=${optimistic()}`,
      v => {
        outside.push(v);
      }
    );
  });
  flush();
  return {
    log,
    cleanups,
    outside,
    drag,
    optimistic,
    setDrag,
    move,
    resolveMove: () => resolveMove(),
    resolveDetails: () => resolveDetails()
  };
}

describe("#3698 a read served an active override is lane work, not a transaction entry", () => {
  it("an unrelated sync write that re-runs the Show's memo publishes at once; the action stays open; the revert leaves it alone", async () => {
    const g = reportGraph();
    expect(g.log).toEqual(["hidden"]);

    const done = g.move();
    await settle();
    expect(g.optimistic()).toBe(true);
    expect(g.log).toEqual(["hidden", "shown"]);
    expect(g.outside.at(-1)).toBe("drag=false opt=true");

    // The independent synchronous write, while the action is still open.
    g.setDrag(true);
    await settle();
    expect(g.drag()).toBe(true);
    expect(latest(g.drag)).toBe(true);
    expect(isPending(g.drag)).toBe(false);
    expect(g.log.at(-1)).toBe("hidden");
    expect(g.outside.at(-1)).toBe("drag=true opt=true");
    // Still open: the override is still displayed.
    expect(g.optimistic()).toBe(true);

    // The action completes with no truth behind the guess: the override
    // reverts. `drag` is not disturbed.
    g.resolveMove();
    await done;
    await settle();
    expect(g.optimistic()).toBe(false);
    expect(isPending(g.optimistic)).toBe(false);
    expect(g.drag()).toBe(true);
    expect(isPending(g.drag)).toBe(false);
    expect(g.log.at(-1)).toBe("hidden");
    expect(g.outside.at(-1)).toBe("drag=true opt=false");
  });

  it("…and a truth that confirms the guess promotes the override, `drag` still untouched", async () => {
    const g = reportGraph({ confirm: true });
    const done = g.move();
    await settle();
    g.setDrag(true);
    await settle();
    expect(g.drag()).toBe(true);
    expect(isPending(g.drag)).toBe(false);
    expect(g.log.at(-1)).toBe("hidden");

    g.resolveMove();
    await done;
    await settle();
    expect(g.optimistic()).toBe(true);
    expect(isPending(g.optimistic)).toBe(false);
    expect(g.drag()).toBe(true);
    expect(isPending(g.drag)).toBe(false);
    expect(g.log.at(-1)).toBe("hidden");
    expect(g.outside.at(-1)).toBe("drag=true opt=true");
  });

  it("the children a memo's lane pass replaces are a lane frame: retired when the lane applies, not at the action's commit", async () => {
    const g = reportGraph();
    expect(g.cleanups).toEqual([]);

    // The flush that carries the optimistic write runs the lane pass over
    // `shown`; the lane is not held, so its queue applies in the same flush
    // and the previous frame's cleanup runs now — the action still pends.
    const done = g.move();
    await settle();
    expect(g.cleanups).toEqual(["cleanup 1"]);
    expect(g.optimistic()).toBe(true); // the action still pends

    // The sync write's pass is a lane pass too (the memo carries a derived
    // override): same rule, retired at once.
    g.setDrag(true);
    await settle();
    expect(g.cleanups).toEqual(["cleanup 1", "cleanup 2"]);
    expect(isPending(g.drag)).toBe(false);

    g.resolveMove();
    await done;
    await settle();
    // The revert re-derives `shown` from the truth and retires the lane's
    // last frame; nothing older was waiting on the commit. (The revert
    // re-runs the memo twice on `next` today — pinned by membership, not
    // count, as lane-outside-view.test.ts does for the same re-run.)
    expect(g.cleanups.slice(0, 3)).toEqual(["cleanup 1", "cleanup 2", "cleanup 3"]);
  });

  it("held lane (#3460 shape): the sync write still publishes; the retired frame waits for the release", async () => {
    const g = reportGraph({ heldLane: true });
    const done = g.move();
    await settle();
    // The lane is held by `details`' flight: its frame is deferred — the
    // committed view is on screen and the retired children wait.
    expect(g.log).toEqual(["hidden"]);
    expect(g.cleanups).toEqual([]);
    expect(g.outside.at(-1)).toBe("drag=false opt=false");

    // A sync write is never held by a lane: it publishes at once, and the
    // outsider re-run by it sees the committed view (#3460). Its pass over
    // `shown` is a lane pass (the memo carries a derived override): the
    // never-shown live children of the deferred pass go at once, the parked
    // frame — still on screen — stays (#3662).
    g.setDrag(true);
    await settle();
    expect(g.drag()).toBe(true);
    expect(isPending(g.drag)).toBe(false);
    expect(g.outside.at(-1)).toBe("drag=true opt=false");
    expect(g.log).toEqual(["hidden"]);
    expect(g.cleanups).toEqual(["cleanup 2"]);

    // The release applies the lane's frame: the displayed frame's cleanup
    // runs now, and the outsider re-derives with the revealed view.
    g.resolveDetails();
    await settle();
    expect(g.cleanups).toEqual(["cleanup 2", "cleanup 1"]);
    expect(g.outside.at(-1)).toBe("drag=true opt=true");
    // `shown` = opt && !drag = false: still hidden, by value.
    expect(g.log.at(-1)).toBe("hidden");

    g.resolveMove();
    await done;
    await settle();
    expect(g.drag()).toBe(true);
    expect(isPending(g.drag)).toBe(false);
  });

  // from #3699 (brenelz): `Show`'s full chain in primitives — the condition
  // memo (owning the compiler's child memo) feeds a `sync: true` content memo
  // that a render effect displays, and one render effect reads the plain,
  // `latest` and `isPending` channels of `drag` together. The two writes
  // arrive in separate tasks, as in the report. Pins the show → hide sequence
  // through the sync memo and the combined channel line.
  it("publishes at once through a condition memo that owns a child memo (sync content memo chain, two tasks)", async () => {
    const tick = () => new Promise<void>(r => setTimeout(r, 0));
    let dispose!: () => void;
    let drag!: () => boolean;
    let optimistic!: () => boolean;
    let run!: () => void;
    const log: string[] = [];
    createRoot(d => {
      dispose = d;
      const [o, setOptimistic] = createOptimistic(false);
      const [dr, setDrag] = createSignal(false);
      optimistic = o;
      drag = dr;
      const move = action(function* () {
        setOptimistic(true);
        yield new Promise<void>(() => {});
      });
      run = () => {
        void move();
        setTimeout(() => setDrag(true), 0);
      };
      // Mirrors the child memo the compiler emits for `when={a() && !b()}`.
      const condition = createMemo(() => {
        const visible = createMemo(() => !!o());
        return visible() ? !dr() : o();
      });
      const value = createMemo(() => (condition() ? "child" : undefined), { sync: true });
      createRenderEffect(value, v => {
        log.push(`show:${v}`);
      });
      createRenderEffect(
        () => `drag:${dr()} latest:${latest(dr)} pending:${isPending(dr)}`,
        v => {
          log.push(v);
        }
      );
    });
    flush();
    expect(log).toEqual(["show:undefined", "drag:false latest:false pending:false"]);

    log.length = 0;
    run();
    await tick();
    await tick();
    expect(optimistic()).toBe(true);
    expect(drag()).toBe(true);
    expect(latest(drag)).toBe(true);
    expect(isPending(drag)).toBe(false);
    expect(log.at(-1)).toBe("drag:true latest:true pending:false");
    expect(log.filter(l => l.startsWith("show:"))).toEqual(["show:child", "show:undefined"]);
    dispose();
  });
});

describe("contrast: a read served SUPERSEDED truth is a staged read and enters (A18 (c), A29)", () => {
  it("a tracked reader of a superseded node re-derives held, and an unrelated tick that re-runs it is held with the transaction", async () => {
    const fetches: Array<(v: number) => void> = [];
    let double!: () => number;
    let setDouble!: (v: number) => void;
    let setValue!: (v: number) => void;
    let setOther!: (v: string) => void;
    let other!: () => string;
    let panel!: () => string;
    let resolveAction!: () => void;
    const shown: string[] = [];
    createRoot(() => {
      const [value, sv] = createSignal(0);
      setValue = sv;
      // The optimistic node's own source derives from `value`.
      [double, setDouble] = createOptimistic(() => {
        const v = value();
        return new Promise<number>(r => fetches.push(() => r(v * 2)));
      });
      const [o, so] = createSignal("x");
      other = o;
      setOther = so;
      panel = createMemo(() => `${double()} ${other()}`);
      createRenderEffect(panel, v => {
        shown.push(v);
      });
    });
    flush();
    fetches.pop()!(0);
    await settle();
    expect(shown.at(-1)).toBe("0 x");
    fetches.length = 0;

    const run = action(function* () {
      setValue(1); // new question → the source refetches
      setDouble(3); // wrong guess; the truth will be 2
      yield new Promise<void>(r => (resolveAction = r));
    });
    const done = run();
    await settle();
    expect(shown.at(-1)).toBe("3 x"); // the override displays (A17)

    // The node's own source lands 2 ≠ 3 while the action is live: the
    // override is superseded (A18). The graph derives from the staged truth,
    // the screen keeps the override until the commit.
    fetches.pop()!(0);
    await settle();
    expect(latest(double)).toBe(2);
    expect(isPending(double)).toBe(true);
    expect(shown.at(-1)).toBe("3 x");

    // The unrelated tick re-runs `panel`, which is served the superseded
    // node's staged truth: a staged read, so the pass enters and the tick
    // is held with the transaction (A29). `other` is pending, not published.
    setOther("y");
    await settle();
    expect(other()).toBe("x");
    expect(isPending(other)).toBe(true);
    expect(latest(other)).toBe("y");
    expect(shown.at(-1)).toBe("3 x");

    // The commit reveals both.
    resolveAction();
    await done;
    await settle();
    expect(other()).toBe("y");
    expect(isPending(other)).toBe(false);
    expect(double()).toBe(2);
    expect(shown.at(-1)).toBe("2 y");
  });
});
