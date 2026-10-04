// L2 — implicit transition = zombie. The four contracts, in ruling order
// (documentation/plans/size-reduction-carve-step1.md §8):
//
//   1. ownership invariant — every node, parked or live, is reachable from a
//      live owner at every instant; owner disposal is total.
//   2. the tab test — the old frame keeps reacting until the new one lands;
//      one atomic swap; the old cleanups run at the swap.
//   3. O2 under ruling A — children created during a parked pass belong to
//      the parked frame's owner: they compute, they do not effect until the
//      swap, they die only by a later pass of their parent or by owner
//      disposal from the live graph.
//   4. transactions — a write that reaches a held node joins its transaction,
//      a write that does not publishes live; one total landing per
//      transaction; a superseded flight's answer is dropped as convergence,
//      not as a frame.
//   5. render effects are the frame, not the transaction (SPEC-ASYNC-SEMANTICS
//      A15, shared-hole and reveal corollaries; #3322, #3407, #3412) — a
//      render effect reading a held node and a live one does not pull the
//      live write into the hold: the write commits, the effect re-runs on
//      committed values (a stale reader — of a held flight too), and is
//      re-derived once the future lands. A reveal of a flight whose inputs
//      are already visible observes it instead: it holds and lands with it.
//   6. independent transactions (A15: "writes on fully disjoint graphs keep
//      independent transitions and settle independently"; maintainer
//      2026-10-01) — a hold that overlaps nothing lands on its own; overlap
//      along dependencies merges two into one; a mount's pending observers
//      are one transaction, and a flight started in that frame resumes it
//      when it lands (#3461).
//
// Fixture: a tab view. Tab 1 is sync and owns a counter. Tabs 2 and 3 each
// own an async memo read by a render effect (the node that parks is a leaf,
// as in a routed component — the memo pass itself stays sync). Tab 3 also
// creates a render effect BEFORE its async read, to show a frame born into a
// future that is already known to be pending. At the root: a header memo
// (a derivation of the route) under a render effect, and a `panel` render
// effect in the compiled shape — one effect reading the route, a live
// toggle and the counter directly.
//
// On the s4 floor every test fails at its first L2 assertion: a recompute
// disposes the previous frame on the spot, and nothing is held.

import {
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  DEV,
  flush,
  getOwner,
  isDisposed,
  onCleanup,
  type Owner
} from "../src/index.js";

const created = new Set<Owner>();
/** Extra roots a test mounts beside the fixture's; walked with it. */
const extraRoots = new Set<Owner>();

beforeEach(() => {
  created.clear();
  extraRoots.clear();
  DEV!.hooks.onOwner = o => void created.add(o);
});

afterEach(() => {
  DEV!.hooks.onOwner = undefined;
  flush();
});

/** Every owner reachable from `root` through the live chain and the parked
 * (zombie) chain. Internal layout: `_firstChild`/`_nextSibling` is the live
 * frame, `_x._pendingFirstChild` the frame parked for the node's next commit. */
function reachable(root: Owner): Set<Owner> {
  const seen = new Set<Owner>();
  const visit = (o: Owner) => {
    if (seen.has(o)) return;
    seen.add(o);
    for (let c = o._firstChild; c; c = c._nextSibling) visit(c);
    for (let c = ((o as any)._x?._pendingFirstChild ?? null) as Owner | null; c; c = c._nextSibling)
      visit(c);
  };
  visit(root);
  return seen;
}

/** Contract 1 as a flush-end walk: live ⇔ reachable, for every owner created. */
function assertOwnership(root: Owner): void {
  const live = reachable(root);
  for (const r of extraRoots) for (const o of reachable(r)) live.add(o);
  for (const o of created) {
    const name = (o as any)._name ?? "owner";
    if (isDisposed(o)) expect(live.has(o), `disposed ${name} still owned`).toBe(false);
    else expect(live.has(o), `live ${name} unreachable from a live owner`).toBe(true);
  }
}

function count(log: string[], entry: string): number {
  return log.filter(e => e === entry).length;
}

function tabs() {
  const [tab, setTab] = createSignal(1);
  const [counter, setCounter] = createSignal(0);
  const [label, setLabel] = createSignal("a");
  const [theme, setTheme] = createSignal("light");
  const [show, setShow] = createSignal(true);
  const log: string[] = [];
  const runs = { upper: 0 };
  const resolvers: Record<number, (v: string) => void> = {};
  let root!: Owner;
  let view!: Owner;
  let tick!: Owner;
  const owners: Record<number, Owner> = {};

  const dispose = createRoot(d => {
    root = getOwner()!;
    const viewMemo = createMemo(() => {
      view = getOwner()!;
      const t = tab();
      onCleanup(() => void log.push(`tab${t}:cleanup`));
      if (t === 1) {
        createRenderEffect(
          () => ((tick = getOwner()!), counter()),
          c => void log.push(`tab1:tick:${c}`),
          undefined,
          { name: "tick" }
        );
        return "tab1";
      }
      const upper = createMemo(
        () => ((owners[t] = getOwner()!), runs.upper++, label().toUpperCase()),
        undefined,
        { name: `upper${t}` }
      );
      createEffect(upper, u => void log.push(`tab${t}:effect:${u}`), undefined, {
        name: `effect${t}`
      });
      // Tab 3 is only ever entered from a parked tab 2 — its pass is born
      // into a future already known to be pending, so a render effect
      // created BEFORE the async read must stay cold until the swap (O2/A).
      if (t === 3)
        createRenderEffect(label, l => void log.push(`tab3:shell:${l}`), undefined, {
          name: "shell3"
        });
      const data = createMemo(() => new Promise<string>(r => (resolvers[t] = r)), undefined, {
        name: `data${t}`
      });
      createRenderEffect(data, v => void log.push(`tab${t}:data:${v}`), undefined, {
        name: `dataEffect${t}`
      });
      return `tab${t}`;
    });
    createRenderEffect(viewMemo, v => void log.push(`render:${v}`), undefined, { name: "render" });
    // A derivation of the route: a write that reaches it reaches the future.
    const header = createMemo(() => `${theme()}/${tab()}`, undefined, { name: "header" });
    createRenderEffect(header, v => void log.push(`header:${v}`), undefined, {
      name: "headerEffect"
    });
    // The frame itself, in the compiled shape: one render effect over the
    // route, a live toggle and the live counter (rule 3).
    createRenderEffect(
      () => (show() ? `panel:${tab()}/${counter()}` : "panel:hidden"),
      v => void log.push(v),
      undefined,
      { name: "panel" }
    );
    return d;
  });
  flush();
  assertOwnership(root);

  const land = async (t: number, value: string) => {
    resolvers[t](value);
    await Promise.resolve();
    flush();
    assertOwnership(root);
  };
  const tickFlush = () => {
    flush();
    assertOwnership(root);
  };
  /** The frame-level entries: tab 1's lifecycle and the view's renders. */
  const frames = () => log.filter(e => /^(tab1:|render:)/.test(e));
  const panel = () => log.filter(e => e.startsWith("panel:"));

  return {
    tab,
    setTab,
    counter,
    setCounter,
    setLabel,
    theme,
    setTheme,
    show,
    setShow,
    log,
    frames,
    panel,
    runs,
    owners,
    root: () => root,
    view: () => view,
    tick: () => tick,
    land,
    flush: tickFlush,
    dispose
  };
}

describe("L2 contract 1 — ownership invariant", () => {
  it("keeps the parked frame owned and alive, and disposes everything exactly once", () => {
    const t = tabs();
    expect(t.frames()).toEqual(["tab1:tick:0", "render:tab1"]);

    t.setTab(2);
    t.flush();
    // The old frame is parked, not torn down: tab 1's counter is still a
    // live node, owned by the view.
    expect(isDisposed(t.tick())).toBe(false);
    expect(reachable(t.view()).has(t.tick())).toBe(true);
    expect(count(t.log, "tab1:cleanup")).toBe(0);
    // The new frame is owned by the same node (ruling A).
    expect(t.owners[2]._parent).toBe(t.view());
    expect(reachable(t.view()).has(t.owners[2])).toBe(true);

    // Owner disposal from the live graph is total: both frames die, each
    // cleanup runs once, nothing stays reachable.
    t.dispose();
    for (const o of created) expect(isDisposed(o), (o as any)._name).toBe(true);
    expect(count(t.log, "tab1:cleanup")).toBe(1);
    expect(count(t.log, "tab2:cleanup")).toBe(1);
    expect(reachable(t.root()).size).toBe(1);
  });
});

describe("L2 contract 2 — the tab test", () => {
  it("keeps tab 1 ticking until tab 2 lands, then swaps atomically with tab 1's cleanups at the swap", async () => {
    const t = tabs();
    expect(t.frames()).toEqual(["tab1:tick:0", "render:tab1"]);

    t.setTab(2);
    t.flush();
    // Nothing visible changed: no cleanup, no render of the new frame.
    expect(t.frames()).toEqual(["tab1:tick:0", "render:tab1"]);

    // The displayed frame keeps reacting to live writes.
    t.setCounter(1);
    t.flush();
    t.setCounter(2);
    t.flush();
    expect(t.frames()).toEqual(["tab1:tick:0", "render:tab1", "tab1:tick:1", "tab1:tick:2"]);

    // One atomic swap: the old cleanups run at the swap, before the new
    // frame's effects.
    await t.land(2, "D");
    expect(t.frames()).toEqual([
      "tab1:tick:0",
      "render:tab1",
      "tab1:tick:1",
      "tab1:tick:2",
      "tab1:cleanup",
      "render:tab2"
    ]);
    expect(t.log.indexOf("tab2:data:D")).toBeGreaterThan(t.log.indexOf("tab1:cleanup"));

    // The old frame is gone.
    t.setCounter(3);
    t.flush();
    expect(count(t.log, "tab1:tick:3")).toBe(0);
    expect(isDisposed(t.tick())).toBe(true);

    t.dispose();
  });
});

describe("L2 contract 3 — O2 under ruling A (parked-frame ownership)", () => {
  it("children of a parked pass compute but do not effect until the swap", async () => {
    const t = tabs();

    t.setTab(2);
    t.flush();
    expect(t.owners[2]._parent).toBe(t.view());
    expect(t.runs.upper).toBe(1);
    // The user effect created in the parked pass has not run.
    expect(t.log.some(e => e.startsWith("tab2:effect:"))).toBe(false);

    // Live writes keep the parked frame's nodes current (they compute)…
    t.setLabel("b");
    t.flush();
    expect(t.runs.upper).toBe(2);
    // …but nothing in it effects.
    expect(t.log.some(e => e.startsWith("tab2:effect:"))).toBe(false);
    expect(count(t.log, "tab1:cleanup")).toBe(0);

    t.dispose();
  });

  it("a later pass of the parent within the same future disposes them, with cleanups; a frame born into the future is cold", async () => {
    const t = tabs();
    t.setTab(2);
    t.flush();

    // Tab 3 is async too: the future continues, converged onto tab 3.
    t.setTab(3);
    t.flush();
    expect(count(t.log, "tab2:cleanup")).toBe(1);
    expect(isDisposed(t.owners[2])).toBe(true);
    expect(t.log.some(e => e.startsWith("tab2:effect:"))).toBe(false);
    // Born into a known future: the render effect created before the async
    // read has not run either.
    expect(t.log.some(e => e.startsWith("tab3:shell:"))).toBe(false);
    expect(t.log.some(e => e.startsWith("tab3:effect:"))).toBe(false);
    // The live frame is untouched.
    expect(count(t.log, "tab1:cleanup")).toBe(0);
    expect(count(t.log, "render:tab3")).toBe(0);

    // Still computing, still cold.
    t.setLabel("c");
    t.flush();
    expect(t.log.some(e => e.startsWith("tab3:"))).toBe(false);

    await t.land(3, "E");
    const swap = t.log.indexOf("tab1:cleanup");
    expect(swap).toBeGreaterThan(-1);
    for (const entry of ["render:tab3", "tab3:shell:c", "tab3:data:E", "tab3:effect:C"]) {
      expect(count(t.log, entry), entry).toBe(1);
      expect(t.log.indexOf(entry), entry).toBeGreaterThan(swap);
    }
    // User effects after render effects.
    expect(t.log.indexOf("tab3:effect:C")).toBeGreaterThan(t.log.indexOf("tab3:shell:c"));
    expect(t.log.some(e => e.startsWith("tab2:effect:"))).toBe(false);
    expect(t.log.some(e => e === "render:tab2")).toBe(false);

    t.dispose();
  });
});

describe("L2 contract 4 — transactions", () => {
  it("a write that reaches the future joins it, one that does not publishes live; one total landing", async () => {
    const t = tabs();
    expect(t.log).toContain("header:light/1");

    t.setTab(2);
    t.flush();
    // The route write parked the flush: it is the future's, not the frame's.
    expect(t.tab()).toBe(1);
    expect(count(t.log, "header:light/2")).toBe(0);
    expect(t.panel()).toEqual(["panel:1/0"]);

    // A write whose propagation touches nothing pending publishes live. It
    // reaches the panel — a render effect that also reads the held route —
    // and that holds nothing (rule 3): the panel re-runs on the committed
    // route.
    t.setCounter(1);
    t.flush();
    expect(t.counter()).toBe(1);
    expect(count(t.log, "tab1:tick:1")).toBe(1);
    expect(t.panel()).toEqual(["panel:1/0", "panel:1/1"]);

    // A write whose propagation reaches a derivation of the future joins it.
    t.setTheme("dark");
    t.flush();
    expect(t.theme()).toBe("light");
    expect(t.log.filter(e => e.startsWith("header:"))).toEqual(["header:light/1"]);

    // Live writes still publish live beside the held ones.
    t.setCounter(2);
    t.flush();
    expect(t.counter()).toBe(2);
    expect(count(t.log, "tab1:tick:2")).toBe(1);
    expect(t.panel()).toEqual(["panel:1/0", "panel:1/1", "panel:1/2"]);

    // Exactly one landing, total: both held writes publish together, the
    // header shows neither intermediate frame; the panel is re-derived on
    // the landed world, once.
    await t.land(2, "D");
    expect(t.tab()).toBe(2);
    expect(t.theme()).toBe("dark");
    expect(t.log.filter(e => e.startsWith("header:"))).toEqual(["header:light/1", "header:dark/2"]);
    expect(t.panel()).toEqual(["panel:1/0", "panel:1/1", "panel:1/2", "panel:2/2"]);
    expect(count(t.log, "render:tab2")).toBe(1);
    expect(count(t.log, "tab1:cleanup")).toBe(1);

    t.dispose();
  });

  it("a superseded flight's answer is convergence, not a competing frame", async () => {
    const t = tabs();
    t.setTab(2);
    t.flush();
    t.setTab(3);
    t.flush();
    expect(t.tab()).toBe(1);

    // Tab 2's answer arrives for a question nobody asks any more: dropped,
    // nothing lands, the future is still tab 3's.
    await t.land(2, "D");
    expect(t.tab()).toBe(1);
    expect(count(t.log, "render:tab2")).toBe(0);
    expect(count(t.log, "tab1:cleanup")).toBe(0);

    await t.land(3, "E");
    expect(t.tab()).toBe(3);
    expect(count(t.log, "render:tab2")).toBe(0);
    expect(count(t.log, "render:tab3")).toBe(1);
    expect(count(t.log, "tab1:cleanup")).toBe(1);
    expect(count(t.log, "tab2:cleanup")).toBe(1);

    t.dispose();
  });

  it("a mount during the hold that reads the future is born into it; one that does not is live", async () => {
    const t = tabs();
    t.setTab(2);
    t.flush();
    expect(t.tab()).toBe(1);

    // From an event handler, outside any pass: a new root. Its memo derives
    // from the future (tab = 2 there) — it must not show beside a frame
    // that still says 1 (A29: born held, cold until the landing). A sibling
    // reading only the committed world is nobody's frame and publishes now.
    let mounted!: () => void;
    createRoot(d => {
      mounted = d;
      extraRoots.add(getOwner()!);
      const m = createMemo(() => t.tab() * 10);
      createRenderEffect(m, v => {
        t.log.push(`mount:${v}`);
      });
      createRenderEffect(t.counter, v => {
        t.log.push(`mount-counter:${v}`);
      });
    });
    t.flush();
    expect(t.log.filter(e => e.startsWith("mount:"))).toEqual([]);
    expect(t.log.filter(e => e.startsWith("mount-counter:"))).toEqual(["mount-counter:0"]);

    // Another tick, another mount: a render effect reading the route
    // DIRECTLY is the frame (rule 3) — it shows the committed route now and
    // catches up at the landing. (In the tick above it would have been born
    // into the batch the memo's join opened: membership is the tick's.)
    let mountedFrame!: () => void;
    createRoot(d => {
      mountedFrame = d;
      extraRoots.add(getOwner()!);
      createRenderEffect(t.tab, v => {
        t.log.push(`mount-tab:${v}`);
      });
    });
    t.flush();
    expect(t.log.filter(e => e.startsWith("mount-tab:"))).toEqual(["mount-tab:1"]);
    expect(t.tab()).toBe(1);

    await t.land(2, "D");
    expect(t.tab()).toBe(2);
    expect(t.log.filter(e => e.startsWith("mount:"))).toEqual(["mount:20"]);
    expect(t.log.filter(e => e.startsWith("mount-tab:"))).toEqual(["mount-tab:1", "mount-tab:2"]);

    mounted();
    mountedFrame();
    t.dispose();
  });
});

describe("L2 contract 5 — render effects are the frame, not the transaction", () => {
  it("a live write that reaches a render effect in the hold commits; the effect re-runs on committed values and is re-derived at the landing", async () => {
    const t = tabs();
    expect(t.panel()).toEqual(["panel:1/0"]);

    t.setTab(2);
    t.flush();
    // The panel computed `2/0` with the batch: held, not shown.
    expect(t.tab()).toBe(1);
    expect(t.panel()).toEqual(["panel:1/0"]);

    // The toggle reaches the panel only. Its own transaction: it commits,
    // the panel re-runs mainline, the hold is untouched.
    t.setShow(false);
    t.flush();
    expect(t.show()).toBe(false);
    expect(t.panel()).toEqual(["panel:1/0", "panel:hidden"]);
    expect(t.tab()).toBe(1);

    // Back on: the panel reads the route as committed (1), not the future's
    // (2) — two worlds, one frame.
    t.setShow(true);
    t.flush();
    expect(t.show()).toBe(true);
    expect(t.panel()).toEqual(["panel:1/0", "panel:hidden", "panel:1/0"]);
    expect(t.tab()).toBe(1);
    expect(count(t.log, "render:tab2")).toBe(0);

    // The landing re-derives the frame on the landed world, once; the value
    // it staged with the batch (`2/0`) is not replayed.
    await t.land(2, "D");
    expect(t.tab()).toBe(2);
    expect(t.panel()).toEqual(["panel:1/0", "panel:hidden", "panel:1/0", "panel:2/0"]);
    expect(count(t.log, "render:tab2")).toBe(1);

    // Quiet after: nothing else is owed.
    t.flush();
    expect(t.panel()).toHaveLength(4);
    t.dispose();
  });

  it("a reveal of a held flight is a stale reader: committed value, no entanglement, re-derived at the landing (A15)", async () => {
    const [show, setShow] = createSignal(false);
    const [go, setGo] = createSignal(false);
    let resolve!: (v: string) => void;
    const log: string[] = [];
    let root!: Owner;
    const dispose = createRoot(d => {
      root = getOwner()!;
      const data = createMemo(() => (go() ? new Promise<string>(r => (resolve = r)) : "idle"));
      // The observer that holds (the only mechanism that reports).
      createRenderEffect(data, v => void log.push(`data:${v}`));
      createRenderEffect(
        () => (show() ? `open:${data()}` : "closed"),
        v => void log.push(`panel:${v}`)
      );
      createRenderEffect(show, v => void log.push(`show:${v}`));
      return d;
    });
    flush();
    expect(log).toEqual(["data:idle", "panel:closed", "show:false"]);

    // The flight: `go` is held with it — the flight's inputs are unpublished.
    setGo(true);
    flush();
    expect(go()).toBe(false);

    // Opening the panel reveals the flight whose inputs are held: a stale
    // reader. It shows data's committed value — coherent with the frame,
    // whose `go` is the committed false too — pends on nothing and holds
    // nothing: `show` commits.
    setShow(true);
    flush();
    expect(show()).toBe(true);
    expect(log).toContain("show:true");
    expect(log.filter(e => e.startsWith("panel:"))).toEqual(["panel:closed", "panel:open:idle"]);
    expect(go()).toBe(false);
    assertOwnership(root);

    // The landing re-derives the panel on the landed world, once.
    resolve("D");
    await Promise.resolve();
    flush();
    expect(go()).toBe(true);
    expect(log).toContain("data:D");
    expect(log.filter(e => e.startsWith("panel:"))).toEqual([
      "panel:closed",
      "panel:open:idle",
      "panel:open:D"
    ]);
    assertOwnership(root);
    dispose();
  });

  it("a reveal of a flight whose inputs are visible observes it: the reveal holds and lands with the flight (A15)", async () => {
    const [show, setShow] = createSignal(false);
    const [go, setGo] = createSignal(false);
    let resolve!: (v: string) => void;
    const log: string[] = [];
    const dispose = createRoot(d => {
      // Nobody renders `data`: its flight holds nothing, and `go` commits.
      const data = createMemo(() => (go() ? new Promise<string>(r => (resolve = r)) : "idle"));
      createRenderEffect(
        () => (show() ? `open:${data()}` : "closed"),
        v => void log.push(`panel:${v}`)
      );
      createRenderEffect(show, v => void log.push(`show:${v}`));
      return d;
    });
    flush();
    setGo(true);
    flush();
    expect(go()).toBe(true);

    // The panel's reveal is the flight's first observer. Its inputs are on
    // screen (`go` is true): showing `idle` beside them would tear, so the
    // reveal holds — `show` waits for the flight — and lands with it.
    setShow(true);
    flush();
    expect(show()).toBe(false);
    expect(log.filter(e => e.startsWith("show:"))).toEqual(["show:false"]);
    expect(log.filter(e => e.startsWith("panel:"))).toEqual(["panel:closed"]);

    resolve("D");
    await Promise.resolve();
    flush();
    expect(show()).toBe(true);
    expect(log.filter(e => e.startsWith("show:"))).toEqual(["show:false", "show:true"]);
    expect(log.filter(e => e.startsWith("panel:"))).toEqual(["panel:closed", "panel:open:D"]);
    dispose();
  });
});

async function settled() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  flush();
}

/** Two flights, each behind its own signal and rendered by its own effect. */
function pair(shared = false) {
  const [a, setA] = createSignal(0);
  const [b, setB] = createSignal(0);
  let resolveA!: (v: string) => void;
  let resolveB!: (v: string) => void;
  const log: string[] = [];
  let root!: Owner;
  const dispose = createRoot(d => {
    root = getOwner()!;
    const da = createMemo(() => (a() ? new Promise<string>(r => (resolveA = r)) : "a0"));
    const db = createMemo(() => (b() ? new Promise<string>(r => (resolveB = r)) : "b0"));
    createRenderEffect(da, v => void log.push(`A:${v}`));
    createRenderEffect(db, v => void log.push(`B:${v}`));
    createRenderEffect(a, v => void log.push(`a:${v}`));
    createRenderEffect(b, v => void log.push(`b:${v}`));
    if (shared) {
      // A user derivation of both: the async work is shared (A15).
      const both = createMemo(() => `${da()}|${db()}`);
      createRenderEffect(both, v => void log.push(`both:${v}`));
    }
    return d;
  });
  flush();
  return {
    a,
    b,
    setA,
    setB,
    log,
    root,
    dispose,
    landA: (v: string) => (resolveA(v), settled()),
    landB: (v: string) => (resolveB(v), settled())
  };
}

describe("L2 — a re-asked flight whose only reader is a zombie (A15 #3463, the compiled <Show> shape of #3372)", () => {
  // The compiled `<Show>`: the child is created in the pass, so a re-pass
  // parks it as a zombie of a pass the transaction holds. `mounted=false`
  // re-asks `details` (held with the flight the child observes) and unmounts
  // the child in the same frame: the zombie's say is moot for the
  // transaction staging its removal — the hold lands, the commit disposes it.
  it("the unmount frame lands at once; the held write reveals with it", async () => {
    const [mounted, setMounted] = createSignal(false);
    const [show, setShow] = createSignal(false);
    let resolve!: (v: boolean) => void;
    const log: string[] = [];
    const dispose = createRoot(d => {
      const details = createMemo(() =>
        mounted() ? new Promise<boolean>(r => (resolve = r)) : false
      );
      createRenderEffect(show, v => void log.push(`show:${v}`));
      createRenderEffect(
        () => {
          if (!mounted()) return "unmounted";
          // The child, created in the pass.
          createRenderEffect(
            () => (show() ? `details:${details()}` : "hidden"),
            v => void log.push(v)
          );
          return "mounted";
        },
        v => void log.push(v)
      );
      return d;
    });
    flush();
    expect(log).toEqual(["show:false", "unmounted"]);

    setMounted(true);
    flush();
    expect(log.slice(2).sort()).toEqual(["hidden", "mounted"]);

    // The child reads the pending flight: show=true is held with it.
    setShow(true);
    flush();
    expect(show()).toBe(false);
    expect(log.length).toBe(4);

    // Unmount: the child — the hold's only reader — is a zombie of this
    // pass; its say is moot. The frame lands now.
    setMounted(false);
    flush();
    expect(mounted()).toBe(false);
    expect(show()).toBe(true);
    expect(log.slice(4).sort()).toEqual(["show:true", "unmounted"]);

    resolve(true);
    await settled();
    expect(log.length).toBe(6);
    dispose();
  });
});

describe("L2 contract 6 — independent transactions", () => {
  it("holds that overlap nothing land on their own, in landing order", async () => {
    const p = pair();
    expect(p.log).toEqual(["A:a0", "B:b0", "a:0", "b:0"]);

    // Two ticks, two flights, nothing in common: two transactions.
    p.setA(1);
    flush();
    p.setB(1);
    flush();
    expect([p.a(), p.b()]).toEqual([0, 0]);
    expect(p.log.length).toBe(4);
    assertOwnership(p.root);

    // The later flight lands first and reveals alone: `b` with `B`, `a`
    // still held.
    await p.landB("b1");
    expect([p.a(), p.b()]).toEqual([0, 1]);
    expect(p.log.slice(4).sort()).toEqual(["B:b1", "b:1"]);
    assertOwnership(p.root);

    await p.landA("a1");
    expect([p.a(), p.b()]).toEqual([1, 1]);
    expect(p.log.slice(6).sort()).toEqual(["A:a1", "a:1"]);
    assertOwnership(p.root);
    p.dispose();
  });

  it("overlap along dependencies merges two holds into one reveal (A15, #3443)", async () => {
    const p = pair(true);
    p.setA(1);
    flush();
    // `both` re-derives for `b`'s flight and reads `da`, held by the first
    // transaction: the second write's async work flows into a memo the first
    // holds, so the two are one.
    p.setB(1);
    flush();
    expect([p.a(), p.b()]).toEqual([0, 0]);

    await p.landB("b1");
    expect([p.a(), p.b()]).toEqual([0, 0]);
    expect(p.log.filter(e => e.startsWith("B:") || e.startsWith("b:"))).toEqual(["B:b0", "b:0"]);

    await p.landA("a1");
    expect([p.a(), p.b()]).toEqual([1, 1]);
    expect(p.log.filter(e => e.startsWith("both:"))).toEqual(["both:a0|b0", "both:a1|b1"]);
    p.dispose();
  });

  it("a flight started in the mount frame resumes it: its landing waits for the frame's other flights (#3461)", async () => {
    let resolveSlow!: (v: string) => void;
    const log: string[] = [];
    const dispose = createRoot(d => {
      const slow = createMemo(() => new Promise<string>(r => (resolveSlow = r)));
      // Resolves on its own, in a microtask — the same synchronous frame as
      // `slow`'s flight.
      const quick = createMemo(async () => "q");
      const [x] = createSignal(0);
      createRenderEffect(x, v => void log.push(`x:${v}`));
      createRenderEffect(slow, v => void log.push(`slow:${v}`));
      createRenderEffect(quick, v => void log.push(`quick:${v}`));
      return d;
    });
    flush();
    // What the mount could show, it showed.
    expect(log).toEqual(["x:0"]);

    // `quick` lands: part of the mount's transaction, not its own — it waits
    // for `slow`.
    await settled();
    expect(log).toEqual(["x:0"]);

    resolveSlow("s");
    await settled();
    expect(log.slice(1).sort()).toEqual(["quick:q", "slow:s"]);
    dispose();
  });

  it("an unrelated flight after the mount is its own transaction", async () => {
    let resolveSlow!: (v: string) => void;
    let resolveOther!: (v: string) => void;
    const [go, setGo] = createSignal(false);
    const log: string[] = [];
    const dispose = createRoot(d => {
      const slow = createMemo(() => new Promise<string>(r => (resolveSlow = r)));
      const other = createMemo(() => (go() ? new Promise<string>(r => (resolveOther = r)) : "o0"));
      createRenderEffect(slow, v => void log.push(`slow:${v}`));
      createRenderEffect(other, v => void log.push(`other:${v}`));
      createRenderEffect(go, v => void log.push(`go:${v}`));
      return d;
    });
    flush();
    expect(log).toEqual(["other:o0", "go:false"]);

    // A later tick: a flight the mount frame knows nothing about.
    setGo(true);
    flush();
    expect(go()).toBe(false);
    resolveOther("o1");
    await settled();
    expect(go()).toBe(true);
    expect(log.slice(2).sort()).toEqual(["go:true", "other:o1"]);

    resolveSlow("s");
    await settled();
    expect(log.slice(4)).toEqual(["slow:s"]);
    dispose();
  });
});
