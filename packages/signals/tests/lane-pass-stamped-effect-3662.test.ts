/**
 * #3662 — a lane pass over an effect that a held, non-lane transaction
 * legitimately stamped.
 *
 * In the report the `insert` effect E was stamped only because a lane pass
 * parked the previous frame as #3404 zombies. Here E is stamped by a real
 * hold: a plain `action` writes `sel`, E's pass under it rebuilds the inner
 * effect, and that inner effect reads an async memo now in flight — T1 holds
 * on the flight, E's previous frame is parked for T1's commit, E carries
 * CONFIG_HELD_CHILDREN. Then an optimistic action moves a row in a store E
 * also reads: a lane pass over E while T1 still holds it.
 *
 * The lane pass direct-commits ahead of T1 (A15 lanes corollary), so its
 * children are the frame's: the tail releases the older zombies rather than
 * leaving the flag set for T1's commit, and the #3412 refresh re-run no
 * longer disposes the lane's freshly built inner effect. The move reaches the
 * frame beside the committed `sel`/`detail` (a stale read of T1's held work);
 * T1's own frame reveals when it commits.
 *
 * The lane-frame lifetime alone does not cover this shape — the zombies were
 * parked by T1's plain pass, not by a lane pass — which is why the tail's
 * release gate is part of the fix.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  onCleanup
} from "../src/index.js";

afterEach(() => flush());

interface Card {
  id: number;
  lane: number;
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  flush();
}

function setup() {
  const frames: { lanes: number[][]; sel: number; detail: string }[] = [];
  const log: string[] = [];
  let move!: (id: number, lane: number) => Promise<void>;
  let select!: (n: number) => Promise<void>;
  let cards!: Card[];
  let dispose!: () => void;
  let resolveDetail!: (v: string) => void;
  let endSelect!: () => void;
  createRoot(d => {
    dispose = d;
    const [sel, setSel] = createSignal(0);
    const [c, setCards] = createOptimisticStore<Card[]>(
      () => [
        { id: 0, lane: 0 },
        { id: 1, lane: 0 },
        { id: 2, lane: 1 }
      ],
      []
    );
    cards = c;
    // T1: a plain action whose derived async work is a real flight.
    select = action(function* (n: number) {
      setSel(n);
      yield new Promise<void>(r => {
        endSelect = r;
      });
    });
    // T2: the optimistic move (a lane).
    move = action(function* (id: number, lane: number) {
      setCards(draft => {
        draft[id].lane = lane;
      });
      yield new Promise<void>(() => {});
    });
    // Synchronous for sel=0, a flight for sel=1 until the test resolves it.
    const detail = createMemo(() =>
      sel() === 0
        ? "d0"
        : new Promise<string>(r => {
            resolveDetail = r;
          })
    );

    const row = (card: () => Card) => {
      const cond = createMemo(() => false);
      const show = createMemo(() => (cond() ? "child" : undefined));
      return [show, card];
    };
    const lanes = [0, 1].map(lane =>
      mapArray(() => cards.filter(card => card.lane === lane), row, {
        keyed: (c: Card) => c.id
      })
    );
    const resolveRow = (parts: (() => unknown)[]) => (parts.at(-1)!() as Card).id;

    // E: the outer `insert`-shaped effect. Reads T1's signal and the lanes;
    // builds an INNER scheduled effect whose compute reads the async `detail`.
    let gen = 0;
    createRenderEffect(
      () => {
        const s = sel();
        const rows = lanes.map(lane => lane() as (() => unknown)[][]);
        const g = ++gen;
        log.push(`E pass ${g} sel=${s}`);
        onCleanup(() => log.push(`E cleanup ${g}`));
        createRenderEffect(
          () => ({ lanes: rows.map(r => r.map(resolveRow)), sel: s, detail: detail() }),
          f => {
            log.push(`inner run ${g}`);
            frames.push(f);
          },
          { schedule: true }
        );
        return rows.length;
      },
      () => {}
    );
  });
  flush();
  return {
    frames,
    log,
    move,
    select,
    cards,
    dispose,
    resolveDetail: (v: string) => resolveDetail(v),
    endSelect: () => endSelect()
  };
}

describe("#3662 lane pass over an effect stamped by a held transaction", () => {
  it("the optimistic move reaches the frame while the stamped transaction still holds", async () => {
    const t = setup();
    expect(t.frames.at(-1)).toEqual({ lanes: [[0, 1], [2]], sel: 0, detail: "d0" });
    expect(t.log).toEqual(["E pass 1 sel=0", "inner run 1"]);

    // T1 holds on the inner effect's flight: E's previous frame is parked
    // for T1's commit, E is stamped T1. Nothing observable changes.
    void t.select(1);
    flush();
    expect(t.frames.at(-1)).toEqual({ lanes: [[0, 1], [2]], sel: 0, detail: "d0" });
    expect(t.log).toEqual(["E pass 1 sel=0", "inner run 1", "E pass 2 sel=1"]);

    // T2: a lane pass over E while T1 still holds it.
    void t.move(0, 1);
    flush();
    expect(t.cards.map(c => c.lane)).toEqual([1, 0, 1]);
    expect(t.frames.at(-1)).toEqual({ lanes: [[1], [0, 2]], sel: 0, detail: "d0" });

    // T1's flight lands and its body ends: its frame reveals over the (still
    // optimistic) rows.
    t.resolveDetail("d1");
    await settle();
    t.endSelect();
    await settle();
    expect(t.frames.at(-1)).toEqual({ lanes: [[1], [0, 2]], sel: 1, detail: "d1" });
    t.dispose();
  });
});
