/**
 * #3548 — overlapping optimistic moves duplicate an item across filtered
 * keyed lists.
 *
 * Reduced from the report's playground: a `createOptimisticStore` backed by
 * an async iterable (manual `publish`), two cards, three lanes each rendered
 * as a keyed `mapArray` over `cards.filter(c => c.lane === lane)`. Four
 * optimistic moves via actions overlap; the authoritative result of the FIRST
 * move is published and only that action resolves while the later ones stay
 * pending.
 *
 *   1. card 0 → lane 1 (order 1)      [action 1]
 *   2. card 0 → lane 2 (order 6)      [action 2]
 *   3. card 1 → lane 1 (order 9)      [action 3]
 *   4. publish {card0: lane 1, card1: lane 0}; resolve action 1 only; task turn
 *   5. card 1 within lane 1 (order 3) [action 4]
 *
 * Reported: after step 5 lane 1 renders cards 0 and 1 AND lane 2 renders
 * card 0 — card 0 is on screen twice although the store places it once (lane
 * 2). Expected: lane 1 = [1], lane 2 = [0], lane 0 = [].
 *
 * The invariant pinned: in every frame the lanes publish, no card id appears
 * in two lanes, and the rendered placement equals the store's own placement.
 */
import {
  action,
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
  order: number;
  version: number;
}
interface Source {
  cards: Card[];
}

describe("#3548 overlapping optimistic moves across filtered keyed lists", () => {
  it("never renders a card in two lanes while an older move lands under newer pending moves", async () => {
    let source: Source = {
      cards: [0, 1].map(id => ({ id, lane: 0, order: 0, version: 0 }))
    };
    let publish!: (value: Source) => void;
    async function* stream() {
      yield source;
      while (true) yield await new Promise<Source>(resolve => (publish = resolve));
    }

    const pending = new Map<number, () => void>();
    const frames: { lanes: number[][]; store: number[] }[] = [];
    let view!: Source;
    let dispose!: () => void;

    createRoot(d => {
      dispose = d;
      const [v, setView] = createOptimisticStore<Source>(stream, source);
      view = v;

      const move = action(function* (id: number, lane: number, order: number, version: number) {
        setView(state => {
          const card = state.cards.find(card => card.id === id)!;
          Object.assign(card, { lane, order, version });
        });
        yield new Promise<void>(resolve => pending.set(version, resolve));
      });
      (globalThis as any).__move3548 = move;

      // Three lanes, each a keyed `<For>` over the filtered+sorted store —
      // the `each` getter runs inside mapArray's own computation, as in
      // `<For each={view.cards.filter(...).sort(...)} keyed={c => c.id}>`.
      const lanes = [0, 1, 2].map(lane =>
        mapArray(
          () => view.cards.filter(c => c.lane === lane).sort((a, b) => a.order - b.order),
          card => card,
          { keyed: (c: Card) => c.id }
        )
      );

      // The DOM stand-in: one frame per flush, each lane's rendered ids.
      createRenderEffect(
        () => ({
          lanes: lanes.map(lane => lane().map(card => card().id)),
          store: view.cards.map(c => c.lane)
        }),
        frame => {
          frames.push(frame);
        }
      );
    });

    const move = (globalThis as any).__move3548 as (
      id: number,
      lane: number,
      order: number,
      version: number
    ) => Promise<void>;
    const start = (id: number, lane: number, order: number, version: number) => {
      void move(id, lane, order, version);
      flush();
    };
    // First yield lands.
    flush();
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(frames.at(-1)!.lanes).toEqual([[0, 1], [], []]);

    start(0, 1, 1, 1); // 1. card 0 → lane 1
    start(0, 2, 6, 2); // 2. card 0 → lane 2
    start(1, 1, 9, 3); // 3. card 1 → lane 1
    expect(frames.at(-1)!.lanes).toEqual([[], [1], [0]]);

    // 4. authoritative result of action 1 lands; only action 1 resolves.
    // Mainline provenance: it supersedes card 0's newer override for the
    // graph (A18), while the screen keeps the override until the merged
    // transaction (actions 2–4) commits (A18 (c)).
    source = {
      cards: [
        { id: 0, lane: 1, order: 1, version: 1 },
        { id: 1, lane: 0, order: 0, version: 0 }
      ]
    };
    publish(source);
    pending.get(1)!();
    await new Promise(resolve => setTimeout(resolve, 0));
    flush();

    // 5. card 1 within lane 1 — a fresh lane reaching lane 1's list, which
    // also derives from card 0's superseded field.
    start(1, 1, 3, 4);

    const last = frames.at(-1)!;
    // Store's own placement: card 0 in lane 2, card 1 in lane 1.
    expect(view.cards.map(c => c.lane)).toEqual([2, 1]);

    // No frame ever shows a card in two lanes, and every frame's rendering
    // agrees with the store's placement read in the same effect.
    for (const frame of frames) {
      const seen = new Map<number, number[]>();
      frame.lanes.forEach((ids, lane) =>
        ids.forEach(id => seen.set(id, [...(seen.get(id) ?? []), lane]))
      );
      for (const [id, inLanes] of seen) {
        expect(
          inLanes,
          `card ${id} rendered in lanes ${inLanes} — frame ${JSON.stringify(frame)}`
        ).toHaveLength(1);
      }
      const fromStore = [[], [], []] as number[][];
      frame.store.forEach((lane, id) => fromStore[lane].push(id));
      expect(
        frame.lanes.map(l => [...l].sort()),
        `rendered lanes disagree with the store — frame ${JSON.stringify(frame)}`
      ).toEqual(fromStore);
    }
    expect(last.lanes).toEqual([[], [1], [0]]);

    // Settle the remaining actions: the merged transaction commits, the
    // overrides drop, and the published truth (card 0 in lane 1, card 1 in
    // lane 0) reveals to every reader — the lane-pass readers replayed at the
    // commit included.
    pending.get(2)!();
    pending.get(3)!();
    pending.get(4)!();
    await new Promise(resolve => setTimeout(resolve, 0));
    flush();
    expect(view.cards.map(c => c.lane)).toEqual([1, 0]);
    expect(frames.at(-1)!).toEqual({ lanes: [[1], [0], []], store: [1, 0] });
    dispose();
    delete (globalThis as any).__move3548;
  });
});
