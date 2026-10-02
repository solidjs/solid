/** @jsxImportSource @solidjs/web */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createSignal,
  createStore,
  flush,
  For,
  isPending,
  Show
} from "solid-js";
import { render } from "../src/index.js";

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe("mount propagation seams in compiled control flow", () => {
  it("repeatedly mounts For/Show previews without holding their visibility behind a row update", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let setDrag!: (id: string | undefined) => void;
    let drag!: () => string | undefined;
    let release!: () => void;
    let move!: () => Promise<void>;
    function App() {
      const [rows, setRows] = createSignal([
        { id: "A", failed: false },
        { id: "B", failed: false }
      ]);
      const server = createMemo(rows);
      const [local] = createStore(server, []);
      const [cards] = createOptimisticStore(local);
      [drag, setDrag] = createSignal<string>();
      move = action(function* () {
        setRows([
          { id: "A", failed: true },
          { id: "B", failed: false }
        ]);
        yield new Promise<void>(resolve => {
          release = resolve;
        });
      });
      return (
        <>
          <p data-server>{rows()[0].failed ? "failed" : "saved"}</p>
          <Show when={drag()}>
            {id => (
              <For each={cards.filter(card => card.id === id())} keyed={card => card.id}>
                {card => (
                  <p data-preview>
                    Dragging {card().id}
                    <Show when={card().failed}> failed</Show>
                  </p>
                )}
              </For>
            )}
          </Show>
        </>
      );
    }
    const dispose = render(() => <App />, container);
    flush();
    const pending = move();
    await tick();
    for (const id of ["A", "B", "A", "B", "A"]) {
      setDrag(id);
      await tick();
      expect(drag()).toBe(id);
      expect(isPending(drag)).toBe(false);
      expect(container.querySelector("[data-preview]")?.textContent).toBe(`Dragging ${id}`);
      expect(container.querySelector("[data-server]")?.textContent).toBe("saved");
      setDrag(undefined);
      await tick();
      expect(container.querySelector("[data-preview]")).toBeNull();
      expect(drag()).toBeUndefined();
    }
    setDrag("A");
    await tick();
    release();
    await pending;
    await tick();
    expect(container.querySelector("[data-preview]")?.textContent).toBe("Dragging A failed");
    expect(container.querySelector("[data-server]")?.textContent).toBe("failed");
    dispose();
    container.remove();
  });
});
