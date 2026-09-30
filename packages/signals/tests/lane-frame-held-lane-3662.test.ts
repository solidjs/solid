/**
 * #3662 — the frame a lane pass on an effect replaces: when it leaves the
 * screen, and in what order against the new frame's effects.
 *
 * A lane pass on an effect direct-commits, but its run is the lane's:
 * `runLaneEffects` skips a lane with pending async (`laneHeld`), so the run
 * waits for the lane's flight and the screen keeps the previous frame
 * meanwhile. That frame is a LANE frame (CONFIG_LANE_FRAME): it leaves the
 * screen when the lane's queue applies the run (A30) — not at the pass, and
 * not at the action's commit as a #3404 transaction zombie would.
 *
 * Ruled order (cleanups before side effects): the retired frame's
 * `onCleanup`s run ahead of EVERY side-effect callback of the new frame —
 * the effect's own apply and any child effect's first run — in the flush that
 * applies it. Compute order is unconstrained. The drain is the lane's first
 * render entry for the pass, pushed before the pass builds the new frame.
 * Pinned for the nested-insert shape (an outer effect building an inner
 * `schedule: true` effect, `insert`'s) and the plain shape (one effect with
 * an apply), held (the run deferred to the reveal) and not held (the run
 * applies in the pass's flush).
 *
 * And the retired frame does not publish again over the lane's frame once
 * the lane reveals: parked as a transaction zombie it survived the reveal
 * (the action still pends), reran for the lane's landing (#3444) with the
 * rows its closure captured, and published the OLD rows beside the new detail
 * AFTER the lane's frame. A lane frame is retired by the run, and a
 * lane-channel dirty on its member is cancelled (`laneZombie`).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush,
  mapArray,
  onCleanup
} from "../src/index.js";

afterEach(() => flush());

interface Card {
  id: number;
  lane: number;
}

type Shape = "nested-insert" | "plain";

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  flush();
}

function setup(shape: Shape, held: boolean) {
  const frames: { lanes: number[][]; detail: string }[] = [];
  const log: string[] = [];
  let move!: (id: number, lane: number) => Promise<void>;
  let cards!: Card[];
  let dispose!: () => void;
  let resolveDetail!: (v: string) => void;
  createRoot(d => {
    dispose = d;
    const [c, setCards] = createOptimisticStore<Card[]>(
      () => [
        { id: 0, lane: 0 },
        { id: 1, lane: 1 }
      ],
      []
    );
    cards = c;
    move = action(function* (id: number, lane: number) {
      setCards(draft => {
        draft[id].lane = lane;
      });
      yield new Promise<void>(() => {});
    });
    // A lane member once card 0 moves. Held: pends under the lane until the
    // test resolves it. Not held: derives synchronously.
    const detail = createMemo(() =>
      cards[0].lane === 0
        ? "d0"
        : held
          ? new Promise<string>(r => {
              resolveDetail = r;
            })
          : "d1"
    );
    const lanes = [0, 1].map(lane =>
      mapArray(
        () => cards.filter(card => card.lane === lane),
        (card: () => Card) => card,
        {
          keyed: (c: Card) => c.id
        }
      )
    );

    let gen = 0;
    if (shape === "nested-insert") {
      createRenderEffect(
        () => {
          const rows = lanes.map(lane => (lane() as (() => Card)[]).map(r => r().id));
          const g = ++gen;
          log.push(`pass ${g}`);
          // A component mounted in the row: its `onCleanup` is the frame's.
          onCleanup(() => log.push(`cleanup ${g}`));
          createRenderEffect(
            () => ({ lanes: rows, detail: detail() }),
            f => {
              log.push(`run ${g}`);
              frames.push(f);
            },
            { schedule: true }
          );
          return rows.length;
        },
        () => {}
      );
    } else {
      createRenderEffect(
        () => {
          const g = ++gen;
          log.push(`pass ${g}`);
          onCleanup(() => log.push(`cleanup ${g}`));
          return {
            g,
            frame: {
              lanes: lanes.map(lane => (lane() as (() => Card)[]).map(r => r().id)),
              detail: detail()
            }
          };
        },
        v => {
          log.push(`run ${v.g}`);
          frames.push(v.frame);
        }
      );
    }
  });
  flush();
  return { frames, log, move, cards, dispose, resolveDetail: (v: string) => resolveDetail(v) };
}

describe("#3662 the frame a lane pass on an effect replaces", () => {
  for (const shape of ["nested-insert", "plain"] as Shape[]) {
    it(`${shape}, held lane: retired at the reveal, cleanups before the new frame's side effects`, async () => {
      const t = setup(shape, true);
      expect(t.frames.at(-1)).toEqual({ lanes: [[0], [1]], detail: "d0" });
      expect(t.log).toEqual(["pass 1", "run 1"]);

      // The move: a lane pass over E. The new frame's `detail` read pends
      // under the lane, so the lane is held and the run is deferred: frame 1
      // stays on screen, its cleanup has not run.
      void t.move(0, 1);
      flush();
      expect(t.cards.map(c => c.lane)).toEqual([1, 1]);
      expect(t.frames.at(-1)).toEqual({ lanes: [[0], [1]], detail: "d0" });
      expect(t.log).toEqual(["pass 1", "run 1", "pass 2"]);

      // The lane's flight lands: the lane releases and applies the new frame
      // (the nested shape's frame 2 — the inner effect re-derives; the plain
      // shape's frame 3 — E's own pass 2 pended, its landing re-runs E, and
      // pass 2's never-applied children die at that pass). The retired
      // frame's cleanup precedes every side-effect callback of the applied
      // frame in that flush.
      t.resolveDetail("d1");
      await settle();
      expect(t.frames.at(-1)).toEqual({ lanes: [[], [0, 1]], detail: "d1" });
      const applied = shape === "nested-insert" ? 2 : 3;
      expect(t.log.at(-1)).toBe(`run ${applied}`);
      const runs = t.log.map((l, i) => (l.startsWith("run ") ? i : -1)).filter(i => i > 1);
      expect(runs).toEqual([t.log.length - 1]);
      for (let g = 1; g < applied; g++) {
        const at = t.log.indexOf(`cleanup ${g}`);
        expect(at).toBeGreaterThan(t.log.indexOf("pass 2"));
        expect(at).toBeLessThan(runs[0]);
        expect(t.log.filter(l => l === `cleanup ${g}`)).toHaveLength(1);
      }
      t.dispose();
    });

    it(`${shape}, lane not held: retired in the pass's flush, cleanups before the new frame's side effects`, () => {
      const t = setup(shape, false);
      expect(t.log).toEqual(["pass 1", "run 1"]);
      void t.move(0, 1);
      flush();
      expect(t.frames.at(-1)).toEqual({ lanes: [[], [0, 1]], detail: "d1" });
      expect(t.log).toEqual(["pass 1", "run 1", "pass 2", "cleanup 1", "run 2"]);
      t.dispose();
    });
  }

  it("nested-insert, held lane: the retired frame does not publish again over the lane's frame after the reveal", async () => {
    const t = setup("nested-insert", true);
    void t.move(0, 1);
    flush();
    t.resolveDetail("d1");
    await settle();
    // The lane's frame is the last one published: the retired inner effect
    // did not rerun with its captured rows.
    expect(t.frames.at(-1)).toEqual({ lanes: [[], [0, 1]], detail: "d1" });
    expect(t.log.filter(l => l === "run 1")).toHaveLength(1);
    t.dispose();
  });
});
