/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { createSignal, flush, Show, For, children } from "solid-js";
import { render, insert } from "@solidjs/web";

describe("slot ownership in a markerless hole", () => {
  test("resolved children moved from a sibling hole to a sole-child hole are still removed", () => {
    const [items, setItems] = createSignal(["a", "b", "c"]);
    const [wide, setWide] = createSignal(true);
    const Layout = (props: { children: any }) => {
      const c = children(() => props.children);
      return (
        <Show when={wide()} fallback={<div class="stack">{c()}</div>}>
          <div class="row">
            {c()}
            <span>end</span>
          </div>
        </Show>
      );
    };
    const el = document.createElement("div");
    const dispose = render(
      () => (
        <Layout>
          <For each={items()}>{x => <i>{x}</i>}</For>
        </Layout>
      ),
      el
    );
    expect(el.innerHTML).toBe('<div class="row"><i>a</i><i>b</i><i>c</i><span>end</span></div>');
    setWide(false);
    flush();
    expect(el.innerHTML).toBe('<div class="stack"><i>a</i><i>b</i><i>c</i></div>');
    setItems(["a", "c"]);
    flush();
    expect(el.innerHTML).toBe('<div class="stack"><i>a</i><i>c</i></div>');
    dispose();
  });

  test("minimal: node from a marker hole reused in a sole-child hole", () => {
    const n1 = document.createElement("i");
    n1.textContent = "1";
    const n2 = document.createElement("i");
    n2.textContent = "2";
    const [a, setA] = createSignal<any>([n1, n2]);
    const [b, setB] = createSignal<any>([]);
    const el = document.createElement("div");
    const dispose = render(
      () => (
        <>
          <div>
            {a()}
            <hr />
          </div>
          <p>{b()}</p>
        </>
      ),
      el
    );
    setA([]);
    setB([n1, n2]);
    flush();
    expect(el.innerHTML).toBe("<div><hr></div><p><i>1</i><i>2</i></p>");
    setB([n2]);
    flush();
    expect(el.innerHTML).toBe("<div><hr></div><p><i>2</i></p>");
    dispose();
  });

  test("a slot that clears does not remove a node a markerless sibling slot claimed", () => {
    const node = document.createElement("div");
    const parent = document.createElement("div");
    const markerA = parent.appendChild(document.createTextNode(""));
    const [aVal, setAVal] = createSignal<any>(node);
    const [bVal, setBVal] = createSignal<any>(null);
    const dispose = render(() => {
      insert(parent, aVal, markerA);
      insert(parent, bVal, null);
      return parent;
    }, document.createElement("div"));
    setBVal(node);
    setAVal(null);
    flush();
    expect(node.parentNode).toBe(parent);
    dispose();
  });

  test("a slot that reconciles does not remove nodes a markerless sibling slot claimed", () => {
    const [n1, n2, n3] = ["1", "2", "3"].map(t =>
      Object.assign(document.createElement("i"), { textContent: t })
    );
    const parent = document.createElement("div");
    const markerA = parent.appendChild(document.createTextNode(""));
    const [aVal, setAVal] = createSignal<any>([n1, n2]);
    const [bVal, setBVal] = createSignal<any>([]);
    const dispose = render(() => {
      insert(parent, aVal, markerA);
      insert(parent, bVal, null);
      return parent;
    }, document.createElement("div"));
    setBVal([n2]);
    setAVal([n3]);
    flush();
    expect([...parent.children].map(n => n.textContent)).toEqual(["3", "2"]);
    expect(n1.parentNode).toBe(null);
    dispose();
  });
});
