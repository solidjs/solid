/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { createRoot, createStore, flush, For } from "solid-js";

describe("<For keyed={false}> backed by a store (#2687)", () => {
  test("item() and store[i()] both reflect per-index store writes", () => {
    let div!: HTMLDivElement;
    let setStoreRef!: any;

    const dispose = createRoot(d => {
      const [store, setStore] = createStore<string[]>(["a", "b", "c"]);
      setStoreRef = setStore;

      void (
        <div ref={div}>
          <For each={store} keyed={false}>
            {(item, i) => (
              <div>
                <span class="item">{item()}</span>
                <span class="store">{store[i()]}</span>
              </div>
            )}
          </For>
        </div>
      );

      return d;
    });

    const items = () => Array.from(div.querySelectorAll(".item")).map(n => n.textContent);
    const stores = () => Array.from(div.querySelectorAll(".store")).map(n => n.textContent);

    flush();
    expect({ items: items(), stores: stores() }).toEqual({
      items: ["a", "b", "c"],
      stores: ["a", "b", "c"]
    });

    setStoreRef((x: string[]) => {
      x[0] = "x";
    });
    flush();
    expect({ items: items(), stores: stores() }).toEqual({
      items: ["x", "b", "c"],
      stores: ["x", "b", "c"]
    });

    setStoreRef((x: string[]) => {
      x[0] = "xy";
    });
    flush();
    expect({ items: items(), stores: stores() }).toEqual({
      items: ["xy", "b", "c"],
      stores: ["xy", "b", "c"]
    });

    dispose();
  });
});
