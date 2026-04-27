import { describe, expect, test, beforeEach } from "vitest";
import { createSignal, flush, For, onCleanup } from "solid-js";
import { render } from "@solidjs/web";
import h from "@solidjs/h";

// These two cases are fixed by `hyper-dom-expressions@0.50.0-next.4` (the
// callback-prop materialization that wraps function props with arity ≥ 1 so
// any tagged thunks they return land in the consumer pre-rendered). On the
// currently-pinned `next.3`, returning `h(Row, …)` from a `For` row callback
// stores a thunk; `mapArray` notifies on each list mutation, the parent
// `insert` re-flattens, and every thunk is re-invoked — which re-mounts
// stable rows, fires their `onCleanup`s, and breaks any per-row state.
//
// They're marked `test.fails` so the suite stays green on the published
// `next.3` and starts failing the moment the dep is bumped — at which point
// we flip `test.fails` -> `test` and the regression is locked in.

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
  return () => {
    root.remove();
  };
});

describe("hyper For-row regression (pending hyper-dom-expressions@0.50.0-next.4)", () => {
  test.fails("appending an item must not dispose existing component rows", () => {
    const [items, setItems] = createSignal([
      { id: 1, name: "a" },
      { id: 2, name: "b" }
    ]);

    const disposed: string[] = [];

    function Row(props: { name: string }) {
      onCleanup(() => disposed.push(props.name));
      return h("li", () => props.name);
    }

    render(
      () =>
        h(
          "ul",
          h(For, {
            each: () => items(),
            keyed: true,
            children: (item: () => { name: string }) => h(Row, { name: () => item().name })
          })
        ),
      root
    );

    expect(Array.from(root.querySelectorAll("li")).map(li => li.textContent)).toEqual(["a", "b"]);
    expect(disposed).toEqual([]);

    setItems(prev => [...prev, { id: 3, name: "c" }]);
    flush();

    expect(Array.from(root.querySelectorAll("li")).map(li => li.textContent)).toEqual([
      "a",
      "b",
      "c"
    ]);
    expect(disposed).toEqual([]);
  });

  test.fails("appending must not re-mount existing 2-arity (item, index) rows either", () => {
    const [items, setItems] = createSignal([
      { id: 1, name: "a" },
      { id: 2, name: "b" }
    ]);

    const disposed: string[] = [];

    function Row(props: { name: string; index: number }) {
      onCleanup(() => disposed.push(props.name));
      return h("li", () => `${props.index}:${props.name}`);
    }

    render(
      () =>
        h(
          "ul",
          h(For, {
            each: () => items(),
            keyed: true,
            children: (item: () => { name: string }, index: () => number) =>
              h(Row, { name: () => item().name, index: () => index() })
          })
        ),
      root
    );

    expect(Array.from(root.querySelectorAll("li")).map(li => li.textContent)).toEqual([
      "0:a",
      "1:b"
    ]);
    expect(disposed).toEqual([]);

    setItems(prev => [...prev, { id: 3, name: "c" }]);
    flush();

    expect(Array.from(root.querySelectorAll("li")).map(li => li.textContent)).toEqual([
      "0:a",
      "1:b",
      "2:c"
    ]);
    expect(disposed).toEqual([]);
  });
});
