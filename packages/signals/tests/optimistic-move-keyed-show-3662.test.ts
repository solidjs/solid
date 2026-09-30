/**
 * #3662 — signals-level reduction of the playground: two overlapping
 * optimistic actions move separate cards into the same filtered keyed
 * `mapArray`; each row carries a nested computation (the <Show> stand-in),
 * and the "DOM" is @solidjs/web's `insert` shape — an OUTER render effect
 * tracking the list that builds an INNER, `schedule: true` effect inside its
 * compute to unwrap the rows' accessors and publish the frame.
 *
 * The first move's lane pass parks the outer effect's previous inner effect
 * as a zombie for the first action's commit (#3404), which stamps the outer
 * effect with that transaction and sets CONFIG_HELD_CHILDREN. The second
 * move's lane pass — a direct commit applied ahead, like any lane pass —
 * then fell into the stamped transaction's same-flush refresh re-run
 * (#3412) with the flag still set: the re-run disposed the lane's freshly
 * built inner effect on the spot (its scheduled run still in the lane's
 * queue) and built a replacement whose first run was held for the first
 * action's commit. Both actions pend forever, so the optimistic frame never
 * received card 0.
 *
 * Fixed at the pass's tail: a lane pass direct-commits ahead of its
 * transaction, so like a contested mainline pass (#3322) it releases an older
 * frame's zombies instead of leaving the node flagged for a commit that is
 * not its own. The frame it parks is a lane frame (CONFIG_LANE_FRAME) —
 * `lane-frame-held-lane-3662.test.ts`, `lane-frame-deferred-run-3662.test.ts`.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush,
  mapArray
} from "../src/index.js";

afterEach(() => flush());

interface Card {
  id: number;
  lane: number;
}

type Frame = "flat" | "nested-insert";

function setup(frame: Frame) {
  const frames: { lanes: number[][]; store: number[] }[] = [];
  let move!: (id: number, lane: number) => Promise<void>;
  let cards!: Card[];
  let dispose!: () => void;
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
      yield new Promise<void>(() => {});
    });

    // Row: [<Show when={false}/>, card] — a memo chain whose leaf renders
    // nothing, beside the row accessor.
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

    if (frame === "nested-insert") {
      const laneFrames: number[][] = [[], []];
      lanes.forEach((lane, idx) =>
        createRenderEffect(
          () => {
            const rows = lane() as (() => unknown)[][];
            // The inner effect unwraps the rows' accessors and publishes; on
            // re-renders `insert` schedules its first run.
            createRenderEffect(
              () => rows.map(resolveRow),
              ids => {
                laneFrames[idx] = ids;
                frames.push({
                  lanes: laneFrames.map(l => [...l]),
                  store: cards.map(c => c.lane)
                });
              },
              { schedule: true }
            );
            return rows.length;
          },
          () => {}
        )
      );
    } else {
      createRenderEffect(
        () => ({
          lanes: lanes.map(lane => (lane() as (() => unknown)[][]).map(resolveRow)),
          store: cards.map(c => c.lane)
        }),
        f => {
          frames.push(f);
        }
      );
    }
  });
  flush();
  return { frames, move, cards, dispose };
}

describe("#3662 keyed mapArray under two overlapping optimistic moves", () => {
  for (const frame of ["nested-insert", "flat"] as Frame[]) {
    it(`renders all three cards in the target lane (${frame} frame)`, () => {
      const { frames, move, cards, dispose } = setup(frame);
      expect(frames.at(-1)!.lanes).toEqual([[0, 1], [2]]);

      void move(1, 1);
      flush();
      expect(cards.map(c => c.lane)).toEqual([0, 1, 1]);
      expect(frames.at(-1)!.lanes).toEqual([[0], [1, 2]]);

      void move(0, 1);
      flush();
      // control: the optimistic store holds all three cards in lane 1
      expect(cards.map(c => c.lane)).toEqual([1, 1, 1]);
      expect(frames.at(-1)!.lanes).toEqual([[], [0, 1, 2]]);
      dispose();
    });
  }
});
