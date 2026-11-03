/**
 * #4648 (replaces #4662). An untracked `isPending()` probe inside a pass the
 * hold runs — the pass read the hold's staging plainly — reads the committed
 * value: "during the hold, reads outside latest() get the committed value"
 * (maintainer ruling on #4662). So `inner: 0` beside `v: 5` in the held pass
 * is correct and pinned here. Two gaps around it:
 *
 * 1. The pass is a stale reader of what its probe was served (A15): it
 *    re-derives at the landing, so the hold ends with one frame on the
 *    landed world (F-1), and its probe never answers `true` beside the fresh
 *    value its plain read saw (D-23). Three shapes: a pass re-run while the
 *    hold is up ("re-run in the hold"; it landed `{ v: 5, inner: 0, p: true }`),
 *    one that first reads the held node in a later flush ("first read in the
 *    hold"; same), and one that probed only in the flush that staged the
 *    write, before the hold existed ("staging flush only"; it landed
 *    `{ v: 5, inner: 0, p: false }` and stayed there). The staging flush is a
 *    normal flush, not the hold (ruled 2026-11-03): an untracked probe there
 *    reads the staging, as its plain read does (F-10, D-24) — with no hold
 *    at all too, where it read the committed value and stayed stale.
 * 2. A probe of a first value staged this flush does what its plain read
 *    does (D-23 exc. 1, F-9): the node has no committed value, only the
 *    staging. It read the empty committed slot (`undefined`).
 *
 * Every case runs in both read orders: the order never changes the result.
 */
import { describe, expect, it } from "vitest";
import {
  createEffect,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  untrack
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

type Row = { v: number; inner: unknown; p: unknown };
type Order = "probe after read" | "probe before read";
const orders: Order[] = ["probe after read", "probe before read"];

type Shape = "re-run in the hold" | "first read in the hold" | "staging flush only";
const shapes: Shape[] = ["re-run in the hold", "first read in the hold", "staging flush only"];

function setup(probe: "isPending" | "latest", order: Order, shape: Shape = "re-run in the hold") {
  const [open, setOpen] = createSignal(0);
  const [other, setOther] = createSignal(0);
  let release = () => {};
  const log: Row[] = [];
  const screen: (Row | null)[] = [];
  const effects: (Row | null)[] = [];
  createRoot(() => {
    // Read by a render effect outside any boundary: a write to `open` is
    // held until this lands (F-2).
    const data = createMemo(() => {
      const o = open();
      return new Promise<number>(r => (release = () => r(o)));
    });
    const cond = createMemo(() => open());
    const pass = createMemo(() => {
      if (!other() && shape === "first read in the hold") return null;
      let v = 0,
        inner: unknown,
        p: unknown;
      const probeIt = () =>
        (p = untrack(() =>
          probe === "isPending" ? isPending(() => (inner = cond())) : (inner = latest(cond))
        ));
      if (order === "probe before read") probeIt();
      v = cond();
      if (order === "probe after read") probeIt();
      const r = { v, inner, p };
      log.push(r);
      return r;
    });
    createRenderEffect(data, () => {});
    createRenderEffect(pass, r => void screen.push(r));
    createEffect(pass, r => void effects.push(r));
  });
  flush();
  release();
  return { setOpen, setOther, release: () => release(), log, screen, effects };
}

describe.each(shapes)("an untracked isPending probe of a held write (%s)", shape => {
  describe.each(orders)("%s", order => {
    it("reads the committed value while held, and the hold ends on the landed world", async () => {
      const { setOpen, setOther, release, log, screen, effects } = setup("isPending", order, shape);
      await tick();
      log.length = 0;
      const first = shape === "first read in the hold" ? null : { v: 0, inner: 0, p: false };
      expect(screen).toEqual([first]);
      expect(effects).toEqual([first]);
      setOpen(5);
      flush();
      // The staging flush is a normal flush: its probe reads the staging.
      for (const r of log) expect(r).toEqual({ v: 5, inner: 5, p: false });
      const staged = log.length;
      if (shape !== "staging flush only") {
        setOther(1);
        flush();
        // The ruling: during the hold the probe reads the committed value;
        // the pass's plain read is the frame's staging. The held pass
        // answers final, never `true` beside it (D-23).
        expect(log.at(-1)).toEqual({ v: 5, inner: 0, p: false });
        for (const r of log.slice(staged)) expect(r.inner).toBe(0);
      } else for (const r of log) expect(r.p).toBe(false);
      expect(screen).toEqual([first]);
      expect(effects).toEqual([first]);
      release();
      await tick();
      // The pass re-derives at the landing (A15): the probe's value is the
      // landed one, final (F-1, D-23). The hold ends with one frame — the
      // held runs wait for the re-derivation — for render and user effects.
      expect(log.at(-1)).toEqual({ v: 5, inner: 5, p: false });
      expect(screen).toEqual([first, { v: 5, inner: 5, p: false }]);
      expect(effects).toEqual([first, { v: 5, inner: 5, p: false }]);
    });
  });
});

describe.each(orders)("an untracked isPending probe with no hold (%s)", order => {
  it("reads the flush's staging, as its plain read does (F-10, D-24)", () => {
    const [open, setOpen] = createSignal(0);
    const screen: Row[] = [];
    const effects: Row[] = [];
    createRoot(() => {
      const cond = createMemo(() => open());
      const pass = createMemo(() => {
        let v = 0,
          inner: unknown,
          p: unknown;
        const probeIt = () => (p = untrack(() => isPending(() => (inner = cond()))));
        if (order === "probe before read") probeIt();
        v = cond();
        if (order === "probe after read") probeIt();
        return { v, inner, p };
      });
      createRenderEffect(pass, r => void screen.push(r));
      createEffect(pass, r => void effects.push(r));
    });
    flush();
    setOpen(5);
    flush();
    const frames = [
      { v: 0, inner: 0, p: false },
      { v: 5, inner: 5, p: false }
    ];
    expect(screen).toEqual(frames);
    expect(effects).toEqual(frames);
  });
});

describe.each(orders)("latest() in the same position (%s, control)", order => {
  it("serves the staging in the held pass (D-22)", async () => {
    const { setOpen, setOther, release, log, screen } = setup("latest", order);
    await tick();
    log.length = 0;
    setOpen(5);
    flush();
    setOther(1);
    flush();
    expect(log.map(r => r.inner)).toEqual([5, 5]);
    release();
    await tick();
    expect(screen.at(-1)).toEqual({ v: 5, inner: 5, p: 5 });
  });
});

describe.each(orders)("a probe of a first value staged this flush (%s)", order => {
  it("reads that value, as its plain read does (D-23 exc. 1)", async () => {
    // `<Loading><Show when={job()}>{j => <Show when={isPending(() => j().id)}/>}</Show></Loading>`
    // with `job` an async first load: in the landing flush the narrowed
    // condition has no committed value, only the staging the branch mounted
    // on — its plain read's value.
    const seen: unknown[] = [];
    let screen: unknown;
    createRoot(() => {
      const job = createMemo(() => Promise.resolve({ id: 2 }));
      const cv = createMemo(() => job());
      const out = createLoadingBoundary(
        () => {
          const branch = createMemo(() => {
            if (!cv()) return null;
            return untrack(() =>
              createMemo(() => {
                let inner: unknown, plain: unknown, p: unknown;
                if (order === "probe after read") plain = cv();
                p = isPending(() => (inner = cv()));
                if (order === "probe before read") plain = cv();
                seen.push(inner);
                return { inner, plain, p };
              })
            );
          });
          return () => branch()?.();
        },
        () => "loading"
      );
      createRenderEffect(
        () => {
          const v = out();
          return typeof v === "function" ? v() : v;
        },
        v => void (screen = v)
      );
    });
    flush();
    expect(screen).toBe("loading");
    await tick();
    expect(seen).not.toContain(undefined);
    expect(screen).toEqual({ inner: { id: 2 }, plain: { id: 2 }, p: false });
  });
});

describe.each(orders)("an untracked isPending probe in a held async memo (%s)", order => {
  it("is not asked again at the landing (F-9)", async () => {
    // A router-style query: it reads the held navigation plainly, probes it
    // untracked, and fetches. Re-run during the hold by another write, its
    // flight answers the hold's question: the landing must not ask it again.
    const [open, setOpen] = createSignal(0);
    const [other, setOther] = createSignal(0);
    let release = () => {};
    let flights = 0;
    createRoot(() => {
      const data = createMemo(() => {
        const o = open();
        return new Promise<number>(r => (release = () => r(o)));
      });
      const cond = createMemo(() => open());
      const query = createMemo(() => {
        other();
        let v = 0;
        if (order === "probe before read") untrack(() => isPending(() => cond()));
        v = cond();
        if (order === "probe after read") untrack(() => isPending(() => cond()));
        flights++;
        return Promise.resolve(v);
      });
      createRenderEffect(data, () => {});
      createRenderEffect(query, () => {});
    });
    flush();
    release();
    await tick();
    flights = 0;
    setOpen(5);
    flush();
    await tick();
    setOther(1);
    flush();
    await tick();
    release();
    await tick();
    expect(flights).toBe(2);
  });
});
