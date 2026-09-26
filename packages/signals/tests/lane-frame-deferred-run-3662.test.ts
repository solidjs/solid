/**
 * #3662 — a LANE frame whose retiring run does not apply in the flush that
 * parked it.
 *
 * A lane pass on an effect parks the frame it replaces as a lane frame
 * (CONFIG_LANE_FRAME), drained when the effect's run applies (A30). The lane
 * here is HELD (the moved card's row reads an async memo that pends under the
 * lane), so that run is deferred and something else happens first:
 *
 *   1. The action's body ends while the lane's flight is up. A held lane
 *      holds its transaction (A15), so nothing reverts yet: the transaction
 *      completes at the landing, the lane's cleanup applies its queued runs
 *      (retiring the frame) before the overlay's reversion pass re-derives.
 *      Every generation's cleanup runs exactly once.
 *   2. The owner is disposed while the lane is held: the displayed frame
 *      (parked) and the never-applied frame (live) each clean up once
 *      (#3561, a parked frame dies with its owner).
 *   3. A second lane pass over the same effect supersedes the first before
 *      its run applied. The superseded pass's children were never shown and
 *      die on the spot, like held children (#3404); the displayed frame stays
 *      parked and is retired in the flush that reveals the lane.
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
  const ends: (() => void)[] = [];
  createRoot(d => {
    dispose = d;
    const [c, setCards] = createOptimisticStore<Card[]>(
      () => [
        { id: 0, lane: 0 },
        { id: 1, lane: 0 },
        { id: 2, lane: 1 }
      ],
      []
    );
    cards = c;
    move = action(function* (id: number, lane: number) {
      setCards(draft => {
        draft[id].lane = lane;
      });
      yield new Promise<void>(r => {
        ends.push(r);
      });
    });
    // Pends under the lane once card 0 leaves lane 0: the lane is held.
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
        // Frame-level accounting: one per generation, run when that
        // generation's frame is retired.
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
  const count = (entry: string) => log.filter(l => l === entry).length;
  return {
    frames,
    log,
    move,
    cards,
    dispose,
    count,
    cleanedOnce: (gens: number[]) => {
      for (const g of gens) expect(count(`cleanup ${g}`)).toBe(1);
    },
    endAction: (i: number) => ends[i](),
    resolveDetail: (v: string) => resolveDetail(v)
  };
}

describe("#3662 a lane frame whose retiring run is deferred", () => {
  it("action body ends while the lane is held: the frame is retired at the reveal, the revert re-derives, nothing leaks", async () => {
    const t = setup();
    expect(t.frames.at(-1)).toEqual({ lanes: [[0, 1], [2]], detail: "d0" });

    void t.move(0, 1);
    flush();
    // Lane held: frame 1 still displayed, its cleanup not run.
    expect(t.frames.at(-1)).toEqual({ lanes: [[0, 1], [2]], detail: "d0" });
    expect(t.log).toEqual(["E pass 1", "inner run 1", "E pass 2"]);

    // The body ends while the flight is up: the held lane holds the
    // transaction, nothing reverts, frame 1 stays.
    t.endAction(0);
    await settle();
    expect(t.cards.map(c => c.lane)).toEqual([1, 0, 1]);
    expect(t.frames.at(-1)).toEqual({ lanes: [[0, 1], [2]], detail: "d0" });
    expect(t.count("cleanup 1")).toBe(0);

    // The flight lands: the lane reveals frame 2 (retiring frame 1), the
    // transaction completes and the overlay reverts to the unchanged base —
    // the reversion pass re-derives frame 3 and retires frame 2.
    t.resolveDetail("d1");
    await settle();
    expect(t.cards.map(c => c.lane)).toEqual([0, 0, 1]);
    expect(t.frames).toContainEqual({ lanes: [[1], [0, 2]], detail: "d1" });
    expect(t.frames.at(-1)).toEqual({ lanes: [[0, 1], [2]], detail: "d0" });
    t.cleanedOnce([1, 2]);
    expect(t.count("inner run 2")).toBe(1);

    const before = t.log.length;
    t.dispose();
    // The live frame's cleanup, once; nothing again from retired frames.
    expect(t.log.slice(before)).toContain("cleanup 3");
    t.cleanedOnce([1, 2, 3]);
  });

  it("owner disposed while the lane is held: displayed and never-applied frames each clean up once", () => {
    const t = setup();
    void t.move(0, 1);
    flush();
    expect(t.count("cleanup 1")).toBe(0);
    t.dispose();
    t.cleanedOnce([1, 2]);
    // The lane's deferred run never applies: its owner is dead.
    expect(t.log.filter(l => l.startsWith("inner run"))).toEqual(["inner run 1"]);
  });

  it("a second lane pass before the first run applies: the never-applied frame dies at once, the displayed frame waits for the reveal", async () => {
    const t = setup();
    void t.move(0, 1);
    flush();
    expect(t.frames.at(-1)).toEqual({ lanes: [[0, 1], [2]], detail: "d0" });
    expect(t.log).toEqual(["E pass 1", "inner run 1", "E pass 2"]);

    // Second move while the lane is still held: a superseding lane pass.
    void t.move(1, 1);
    flush();
    expect(t.cards.map(c => c.lane)).toEqual([1, 1, 1]);
    // Frame 2 was never applied: gone on the spot. Frame 1 is still on
    // screen: still parked.
    expect(t.log).toEqual(["E pass 1", "inner run 1", "E pass 2", "cleanup 2", "E pass 3"]);
    expect(t.frames.at(-1)).toEqual({ lanes: [[0, 1], [2]], detail: "d0" });
    const heldUntil = t.log.length;

    // The flight lands: the lane reveals frame 3 and retires frame 1 in the
    // same flush.
    t.resolveDetail("d1");
    await settle();
    expect(t.frames.at(-1)).toEqual({ lanes: [[], [0, 1, 2]], detail: "d1" });
    t.cleanedOnce([1, 2]);
    expect(t.log.indexOf("cleanup 1")).toBeGreaterThanOrEqual(heldUntil);
    expect(t.count("inner run 2")).toBe(0);
    expect(t.count("inner run 3")).toBe(1);

    t.endAction(0);
    t.endAction(1);
    await settle();
    t.dispose();
    for (const g of [1, 2, 3, 4]) expect(t.count(`cleanup ${g}`)).toBeLessThanOrEqual(1);
  });
});
