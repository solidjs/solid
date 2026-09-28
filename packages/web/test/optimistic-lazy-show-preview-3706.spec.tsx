/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3706, third playground: one action writes the authoritative rows before
 * yielding; a separate click sets `drag`. The preview mounts a nested <Show>
 * over `cards.find(...)` only then, so the row is first read AFTER the
 * derived store adopted the new rows under the open action. The drag write
 * must publish while the row update stays pending.
 */
import { describe, expect, test } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createSignal,
  createStore,
  flush,
  isPending,
  latest,
  Show
} from "solid-js";
import { render } from "../src/index.js";

const tick = () => new Promise<void>(r => setTimeout(r, 0));

describe("#3706 lazily mounted Show preview over an adopted row", () => {
  // `find` reads the row for the first time after the adoption inside the
  // inner Show's `when` memo; the container hold stands there (design call,
  // see the signals pin). `index` reads it from the insert's render effect,
  // a stale reader that keeps the committed frame and publishes.
  for (const preview of ["find", "index", "none"] as const) {
    (preview === "find" ? test.fails : test)(`preview=${preview}`, async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      let release!: () => void;
      let move!: () => Promise<void>;
      let setDrag!: (v: string) => void;
      function App() {
        const [rows, setRows] = createSignal([{ id: "card", version: 0 }]);
        const serverCards = createMemo(() => rows());
        const [localCards] = createStore(() => serverCards(), []);
        const [cards] = createOptimisticStore(localCards);
        const [drag, setDragFn] = createSignal<string>();
        setDrag = setDragFn;
        move = action(function* () {
          setRows([{ id: "card", version: 1 }]);
          yield new Promise<void>(r => (release = r));
        });
        return (
          <>
            <Show when={drag()}>
              {id =>
                preview === "find" ? (
                  <Show when={cards.find(card => card.id === id())}>
                    {card => <p>Dragging {card().id}</p>}
                  </Show>
                ) : preview === "index" ? (
                  <p>Dragging {cards[0].id}</p>
                ) : (
                  <p>Dragging {id()}</p>
                )
              }
            </Show>
            <pre>
              {JSON.stringify({
                drag: drag(),
                latest: latest(drag),
                pending: isPending(drag),
                serverPending: isPending(serverCards)
              })}
            </pre>
          </>
        );
      }
      const dispose = render(() => <App />, container);
      flush();
      const p = move();
      flush();
      await tick();
      setDrag("card");
      flush();
      await tick();
      flush();
      const during = container.querySelector("pre")!.textContent;
      const preview_ = container.querySelector("p")?.textContent;
      release();
      await p;
      flush();
      const after = container.querySelector("pre")!.textContent;
      dispose();
      container.remove();
      expect({ during, preview_, after }).toEqual({
        during: JSON.stringify({
          drag: "card",
          latest: "card",
          pending: false,
          serverPending: true
        }),
        preview_: "Dragging card",
        after: JSON.stringify({
          drag: "card",
          latest: "card",
          pending: false,
          serverPending: false
        })
      });
    });
  }
});
