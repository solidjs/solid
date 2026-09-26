/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3662 — a card disappears from a filtered keyed <For> when two optimistic
 * moves overlap and each keyed row contains an empty <Show when={false}>.
 *
 * Transcribed from the report's playground: three cards, two lanes rendered
 * as keyed <For> over `cards.filter(c => c.lane === lane)`, each row a
 * fragment `[<Show when={false}/>, <article/>]`. Two actions move card 1 and
 * then card 0 into lane 1; both stay pending. Reported: after the second move
 * card 0 is gone from the DOM although the optimistic store holds it.
 *
 * Mechanism: the row's <Show> is an accessor, so the lane's `insert` builds
 * an INNER unwrapping effect inside the outer effect's compute. The first
 * move's lane pass parked the previous inner effect as a zombie for the
 * first action's commit, stamping the outer effect with that transaction and
 * flagging CONFIG_HELD_CHILDREN. The second move's lane pass then triggered
 * the stamped transaction's same-flush refresh re-run, which disposed the
 * lane's freshly built inner effect (its run still queued) and built a
 * replacement held for a commit that never came. Any accessor in the row
 * (Switch, a memo) reproduces; a static `undefined` does not.
 */
import { describe, expect, test } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  flush,
  For,
  Match,
  Show,
  Switch
} from "solid-js";
import { render } from "../src/index.js";

interface Card {
  id: number;
  lane: number;
}

type RowVariant =
  | "show-false"
  | "no-show"
  | "switch-no-match"
  | "memo-undefined"
  | "plain-undefined"
  | "show-true";

function setup(row: RowVariant) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let move!: (id: number, lane: number) => Promise<void>;
  let cards!: Card[];

  function App() {
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

    const Row = (props: { card: Card }) => {
      const article = <article data-id={props.card.id}>Card {props.card.id}</article>;
      switch (row) {
        case "show-false":
          return (
            <>
              <Show when={false}>
                <div />
              </Show>
              {article}
            </>
          );
        case "show-true":
          return (
            <>
              <Show when={true}>
                <span data-show={props.card.id} />
              </Show>
              {article}
            </>
          );
        case "switch-no-match":
          return (
            <>
              <Switch>
                <Match when={false}>
                  <div />
                </Match>
              </Switch>
              {article}
            </>
          );
        case "memo-undefined": {
          const nothing = createMemo(() => undefined);
          return (
            <>
              {nothing()}
              {article}
            </>
          );
        }
        case "plain-undefined":
          return (
            <>
              {undefined}
              {article}
            </>
          );
        case "no-show":
        default:
          return <>{article}</>;
      }
    };

    return (
      <div style="display: flex;">
        <For each={[0, 1]}>
          {lane => (
            <div data-lane={lane}>
              <For each={cards.filter(card => card.lane === lane)} keyed={(card: Card) => card.id}>
                {card => <Row card={card()} />}
              </For>
            </div>
          )}
        </For>
      </div>
    );
  }

  const dispose = render(() => <App />, container);
  flush();
  const laneIds = (lane: number) =>
    Array.from(container.querySelectorAll(`[data-lane="${lane}"] article`)).map(a =>
      Number(a.getAttribute("data-id"))
    );
  return {
    container,
    laneIds,
    move,
    get cards() {
      return cards;
    },
    dispose: () => {
      dispose();
      container.remove();
    }
  };
}

// Rows with an accessor (Show, Switch, a memo read) reproduced; the two
// static rows are controls that never did.
const rows: RowVariant[] = [
  "show-false",
  "show-true",
  "switch-no-match",
  "memo-undefined",
  "plain-undefined",
  "no-show"
];

describe("#3662 keyed <For> loses a card under overlapping optimistic moves", () => {
  for (const row of rows) {
    test(`row=${row}: both moved cards render in lane 1 while both actions pend`, () => {
      const t = setup(row);
      expect(t.laneIds(0)).toEqual([0, 1]);
      expect(t.laneIds(1)).toEqual([2]);

      void t.move(1, 1);
      flush();
      expect(t.cards.filter(c => c.lane === 1).map(c => c.id)).toEqual([1, 2]);
      expect(t.laneIds(0)).toEqual([0]);
      expect(t.laneIds(1)).toEqual([1, 2]);

      void t.move(0, 1);
      flush();
      // control: the optimistic store holds all three cards in lane 1
      expect(t.cards.filter(c => c.lane === 1).map(c => c.id)).toEqual([0, 1, 2]);
      expect(t.laneIds(0)).toEqual([]);
      expect(t.laneIds(1)).toEqual([0, 1, 2]);
      t.dispose();
    });
  }

  test("row=show-false: a single move (no overlap) renders correctly", () => {
    const t = setup("show-false");
    void t.move(0, 1);
    flush();
    expect(t.laneIds(0)).toEqual([1]);
    expect(t.laneIds(1)).toEqual([0, 2]);
    t.dispose();
  });
});
