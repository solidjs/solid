/**
 * #4648 (review of #4667). A pass that is the hold's own work (D-25: it reads
 * the hold's flight) re-runs in the flush that lands it. Its untracked probe
 * of the held write then answers for the landed world: the hold lands at
 * this seam, so the probe reads the staging and the pass is final in the
 * landing frame. The render effect and the user effect both show
 * `{0,0,false}` then `{5,5,false}` — never the stale pass first (F-1).
 *
 * If a node computed later in that flush blocks the hold again (a new
 * flight starts at the landing), the hold is up again: the pass re-runs on
 * the committed value — `inner: 0` while held (ruling on #4662) — and the
 * screen keeps the old frame until the hold that remains lands, with no
 * value shown and then retracted, and no `p: true` beside `v: 5` (D-23).
 *
 * Every case runs in both read orders.
 */
import { describe, expect, it } from "vitest";
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  flush,
  isPending,
  untrack
} from "../src/index.js";

type Row = { v: number; inner: unknown; p: unknown };
type Order = "probe after read" | "probe before read";
const orders: Order[] = ["probe after read", "probe before read"];

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r));
    flush();
  }
};

const initial = { v: 0, inner: 0, p: false };
const landed = { v: 5, inner: 5, p: false };

function probePass(order: Order, cond: () => number, after: () => void, log: Row[]) {
  return createMemo(() => {
    let v = 0,
      inner: unknown,
      p: unknown;
    const probeIt = () => (p = untrack(() => isPending(() => (inner = cond()))));
    if (order === "probe before read") probeIt();
    v = cond();
    if (order === "probe after read") probeIt();
    after();
    const r = { v, inner, p };
    log.push(r);
    return r;
  });
}

describe.each(orders)("a pass that reads the hold's flight (%s)", order => {
  for (const hold of [false, true])
    it(`lands in one frame (${hold ? "held by its own flight" : "no hold"})`, async () => {
      const screen: Row[] = [];
      const effects: Row[] = [];
      const log: Row[] = [];
      let res!: (v: number) => void;
      const [open, setOpen] = createSignal(0);
      const cond = createMemo(() => open());
      const a = createMemo(async () => {
        const v = open();
        if (v && hold) await new Promise<number>(r => (res = r));
        return v;
      });
      const pass = probePass(order, cond, () => void (hold && a()), log);
      createRenderEffect(pass, r => void screen.push(r));
      createEffect(pass, r => void effects.push(r));
      flush();
      await tick();
      setOpen(5);
      flush();
      if (hold) {
        expect(screen).toEqual([initial]);
        res(5);
      }
      await tick();
      expect(screen).toEqual([initial, landed]);
      expect(effects).toEqual([initial, landed]);
    });
});

describe.each(["same pass", "sibling", "deep sibling"] as const)(
  "a later node blocks the hold again in the landing flush (%s)",
  where => {
    describe.each(orders)("%s", order => {
      it("keeps the old frame, reads the committed value while held, and lands once", async () => {
        const screen: Row[] = [];
        const effects: Row[] = [];
        const log: Row[] = [];
        let resA!: (v: number) => void, resB!: (v: number) => void;
        const [open, setOpen] = createSignal(0);
        const cond = createMemo(() => open());
        const a = createMemo(async () => {
          const v = open();
          if (v) await new Promise<number>(r => (resA = r));
          return v;
        });
        // `deep sibling`: computed after the pass in the landing flush, so
        // the pass's probe ran while the hold was not yet blocked again.
        const m1 = createMemo(() => a());
        const m2 = createMemo(() => m1());
        const m3 = createMemo(() => m2());
        const b = createMemo(async () => {
          const v = where === "deep sibling" ? m3() : a();
          if (v) await new Promise<number>(r => (resB = r));
          return v;
        });
        const pass = probePass(
          order,
          cond,
          () => {
            a();
            if (where === "same pass") b();
          },
          log
        );
        createRenderEffect(pass, r => void screen.push(r));
        createEffect(pass, r => void effects.push(r));
        if (where !== "same pass") createRenderEffect(b, () => {});
        flush();
        await tick();
        expect(screen).toEqual([initial]);
        log.length = 0;
        setOpen(5);
        flush();
        resA(5);
        await tick();
        // `b`'s new flight holds the change: nothing shown, and the held
        // pass's last run read the committed value (D-23: final, `p: false`).
        expect(screen).toEqual([initial]);
        expect(effects).toEqual([initial]);
        if (log.length) expect(log.at(-1)).toEqual({ v: 5, inner: 0, p: false });
        resB(5);
        await tick();
        expect(screen).toEqual([initial, landed]);
        expect(effects).toEqual([initial, landed]);
      });
    });
  }
);
