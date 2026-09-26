/**
 * #3662 — the frame a lane pass replaces, when the lane is HELD.
 *
 * A lane pass on an effect direct-commits, but its run is the lane's:
 * `runLaneEffects` skips a lane with pending async (`laneHeld`), so the
 * effect's run waits for the lane's flight and the screen keeps the previous
 * frame meanwhile. That frame is a LANE frame (CONFIG_LANE_FRAME): it leaves
 * the screen when the run applies (A30, the #3438 point) — not at the pass,
 * and not at the action's commit as a #3404 transaction zombie would.
 *
 * Here the moved card's row reads an async memo that pends under the lane,
 * so the move's lane pass over E leaves the lane held. Two invariants:
 *
 *   1. The displayed frame's cleanups do not run before the lane's frame
 *      applies (the #3404 rule, for lanes).
 *   2. The superseded frame does not publish again over the lane's frame
 *      once the lane reveals. Parked as a transaction zombie it survived the
 *      reveal (the action still pends), reran for the lane's landing (#3444)
 *      with the rows its closure captured, and published the OLD rows beside
 *      the new detail AFTER the lane's frame. A lane frame is retired by
 *      that run, and a lane-channel dirty on its member is cancelled
 *      (`laneZombie`).
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

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  flush();
}

function setup() {
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
    // A lane member once card 0 moves: pends under the lane, so the lane is
    // held until the test resolves it.
    const detail = createMemo(() =>
      cards[0].lane === 0
        ? "d0"
        : new Promise<string>(r => {
            resolveDetail = r;
          })
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
    createRenderEffect(
      () => {
        const rows = lanes.map(lane => (lane() as (() => Card)[]).map(r => r().id));
        const g = ++gen;
        log.push(`E pass ${g}`);
        // A component mounted in the row: its `onCleanup` is the frame's.
        onCleanup(() => log.push(`cleanup ${g}`));
        createRenderEffect(
          () => ({ lanes: rows, detail: detail() }),
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
  return { frames, log, move, cards, dispose, resolveDetail: (v: string) => resolveDetail(v) };
}

async function moveAndReveal(t: ReturnType<typeof setup>) {
  expect(t.frames.at(-1)).toEqual({ lanes: [[0], [1]], detail: "d0" });
  expect(t.log).toEqual(["E pass 1", "inner run 1"]);
  // The move: a lane pass over E. The new inner effect's `detail` read pends
  // under the lane, so the lane is held and E's run is deferred.
  void t.move(0, 1);
  flush();
  expect(t.cards.map(c => c.lane)).toEqual([1, 1]);
  expect(t.frames.at(-1)).toEqual({ lanes: [[0], [1]], detail: "d0" });
  expect(t.log).toEqual(["E pass 1", "inner run 1", "E pass 2"]);
  // The lane's flight lands: the lane releases and its frame applies.
  t.resolveDetail("d1");
  await settle();
  expect(t.frames).toContainEqual({ lanes: [[], [0, 1]], detail: "d1" });
}

describe("#3662 lane pass over an effect while the lane is held", () => {
  it("does not run the displayed frame's cleanups before the lane's frame applies", async () => {
    const t = setup();
    await moveAndReveal(t);
    // Frame 1 was on screen through the held window; it is retired in the
    // flush that applies E's run, and only then.
    expect(t.log.indexOf("cleanup 1")).toBeGreaterThan(t.log.indexOf("E pass 2"));
    expect(t.log.filter(l => l === "cleanup 1")).toHaveLength(1);
    t.dispose();
  });

  it("the superseded frame does not publish again over the lane's frame after the reveal", async () => {
    const t = setup();
    await moveAndReveal(t);
    // The lane's frame is the last one published: the superseded inner effect
    // did not rerun with its captured rows.
    expect(t.frames.at(-1)).toEqual({ lanes: [[], [0, 1]], detail: "d1" });
    expect(t.log.filter(l => l === "inner run 1")).toHaveLength(1);
    t.dispose();
  });
});
