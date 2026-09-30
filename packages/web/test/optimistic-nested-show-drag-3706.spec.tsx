/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3706, second playground (nested <Show> preview): six overlapping
 * optimistic moves, a separate `drag` signal set and cleared between them.
 * The preview reads `cards.find(...)` under `<Show when={drag()}>`. Every
 * drag write must commit (`pending=false`) while moves are in flight.
 */
import { describe, expect, test } from "vitest";
import {
  action,
  createOptimisticStore,
  createSignal,
  createStore,
  isPending,
  latest,
  Show
} from "solid-js";
import { render } from "../src/index.js";

type Card = { id: string; column: number };
const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

describe("#3706 nested Show preview over an optimistic store", () => {
  for (const inner of ["find", "plain"] as const) {
    test(`six overlapping moves, inner=${inner}`, async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      let run!: () => Promise<string[]>;
      function App() {
        const [server, setServer] = createSignal<Card[]>(
          Array.from({ length: 2 }, (_, i) => ({ id: String(i), column: 0 }))
        );
        const [base] = createStore<Card[]>(() => server(), []);
        const [cards, setCards] = createOptimisticStore(base);
        const [drag, setDrag] = createSignal<string>();
        const move = action(function* (id: string, column: number) {
          setCards(draft => {
            draft.find(c => c.id === id)!.column = column;
          });
          yield delay(400);
          setServer(rows => rows.map(row => (row.id === id ? { ...row, column } : row)));
        });
        run = async () => {
          const rows: string[] = [];
          for (let i = 0; i < 6; i++) {
            const id = String(i % 2);
            setDrag(id);
            await delay(0);
            rows.push(
              `${i}: drag=${drag() ?? "unset"} latest=${latest(drag) ?? "unset"} pending=${isPending(drag)}`
            );
            setDrag(undefined);
            await delay(0);
            void move(id, i + 1);
            await delay(80);
          }
          await delay(500);
          return rows;
        };
        return (
          <Show when={drag()}>
            {active =>
              inner === "find" ? (
                <Show when={cards.find(card => card.id === active())}>
                  {card => <span>Preview {card().id}</span>}
                </Show>
              ) : (
                <span>Preview {active()}</span>
              )
            }
          </Show>
        );
      }
      const dispose = render(() => <App />, container);
      const rows = await run();
      dispose();
      container.remove();
      expect(rows).toEqual(
        Array.from({ length: 6 }, (_, i) => `${i}: drag=${i % 2} latest=${i % 2} pending=false`)
      );
    }, 20000);
  }
});
