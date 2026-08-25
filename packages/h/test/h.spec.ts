import { describe, expect, test, beforeEach } from "vitest";
import { createSignal, flush, For, onCleanup } from "solid-js";
import { render } from "@solidjs/web";
import h from "@solidjs/h";

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
  return () => {
    root.remove();
  };
});

describe("@solidjs/h", () => {
  test("renders a static element", () => {
    render(() => h("div", { id: "static" }, "hello"), root);
    expect(root.innerHTML).toBe(`<div id="static">hello</div>`);
  });

  test("class shorthand parses tag.class", () => {
    render(() => h("button.btn-primary", "go"), root);
    const btn = root.querySelector("button.btn-primary");
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toBe("go");
  });

  test("reactive child accessor updates on flush", () => {
    const [count, setCount] = createSignal(0);
    render(() => h("span", () => count()), root);
    expect(root.textContent).toBe("0");

    setCount(1);
    flush();
    expect(root.textContent).toBe("1");

    setCount(2);
    flush();
    expect(root.textContent).toBe("2");
  });

  test("nested h() thunks compose without leaking the thunk into the DOM", () => {
    function Inner(props: { label: string }) {
      return h("em", props.label);
    }
    function Outer() {
      return h("div", { class: "outer" }, h(Inner, { label: "hi" }));
    }

    render(() => h(Outer), root);
    expect(root.innerHTML).toBe(`<div class="outer"><em>hi</em></div>`);
  });

  test("For with element children renders and grows correctly", () => {
    const [items, setItems] = createSignal([
      { id: 1, name: "a" },
      { id: 2, name: "b" }
    ]);

    render(
      () =>
        h(
          "ul",
          h(For, {
            each: () => items(),
            keyed: true,
            children: (item: { id: number; name: string }) => h("li", () => item.name)
          })
        ),
      root
    );

    expect(Array.from(root.querySelectorAll("li")).map(li => li.textContent)).toEqual(["a", "b"]);

    setItems(prev => [...prev, { id: 3, name: "c" }]);
    flush();

    expect(Array.from(root.querySelectorAll("li")).map(li => li.textContent)).toEqual([
      "a",
      "b",
      "c"
    ]);
  });

  // Guards against a regression in `hyper-dom-expressions` where returning a
  // `h(Comp, …)` thunk from a render-prop callback would store the thunk
  // verbatim; `mapArray`'s notification then re-flattened the array on every
  // parent change and re-invoked every thunk, re-mounting stable rows. The
  // fix wraps function props with arity ≥ 1 so any tagged thunks they return
  // are materialized at the call site (matching JSX-compiled call sites).
  test("For row component is not re-mounted when the list grows (1-arity children)", () => {
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
            children: (item: { name: string }) => h(Row, { name: () => item.name })
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

  test("For row component is not re-mounted when the list grows (2-arity (item, index) children)", () => {
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
            children: (item: { name: string }, index: () => number) =>
              h(Row, { name: () => item.name, index: () => index() })
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
