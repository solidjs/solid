/**
 * An h() element is a thunk that materializes each time its consumer reads
 * it: a `Show` re-showing its children invokes the same children thunk
 * again. Materializing must not write to the caller's props, and a thunk
 * returned from an accessor must be created where JSX would create it —
 * in the insert's tracking pass, not in the pass that re-runs when the
 * component's output changes.
 */

import { createMemo, createSignal, flush, Loading, Show } from "solid-js";
import { render } from "@solidjs/web";
import h from "../src/hyperscript.js";

const settle = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};

function asyncChild() {
  let resolve;
  const promise = new Promise(r => (resolve = r));
  const child = {
    created: 0,
    resolve: v => resolve(v),
    Component() {
      child.created++;
      const value = createMemo(() => promise);
      return h("span", () => value());
    }
  };
  return child;
}

describe("re-materializing an h() element", () => {
  test("Show re-shows a component child whose children are h() elements", () => {
    const el = document.createElement("div");
    const [on, setOn] = createSignal(true);
    const Box = props => h("b", props.children);
    const boxProps = {};
    const dispose = render(h("div", h(Show, { when: on }, h(Box, boxProps, h("i", "x")))), el);
    flush();
    expect(el.innerHTML).toBe("<div><b><i>x</i></b></div>");
    setOn(false);
    flush();
    expect(el.innerHTML).toBe("<div></div>");
    setOn(true);
    flush();
    expect(el.innerHTML).toBe("<div><b><i>x</i></b></div>");
    expect(Object.keys(boxProps)).toEqual([]);
    dispose();
  });

  test("component props are not written to", () => {
    const [title, setTitle] = createSignal("a");
    const getTitle = () => title();
    const onSelect = value => value;
    const props = { title: getTitle, onSelect };
    let seen;
    const Comp = p => {
      seen = p;
      return h("p", () => p.title);
    };
    const el = document.createElement("div");
    const dispose = render(h("div", h(Comp, props, "child")), el);
    expect(el.innerHTML).toBe("<div><p>a</p></div>");
    setTitle("b");
    flush();
    expect(el.innerHTML).toBe("<div><p>b</p></div>");
    expect(seen).not.toBe(props);
    expect(seen.children).toBe("child");
    expect(Object.getOwnPropertyDescriptor(props, "title").value).toBe(getTitle);
    expect(props.onSelect).toBe(onSelect);
    expect("children" in props).toBe(false);
    dispose();
  });

  test("props needing no rewrite are passed through", () => {
    const props = { label: "x" };
    let seen;
    const Comp = p => ((seen = p), h("p", p.label));
    const dispose = render(h("div", h(Comp, props)), document.createElement("div"));
    expect(seen).toBe(props);
    dispose();
  });

  test("element props are not written to, and keep their static classes", () => {
    const [cls, setCls] = createSignal("b");
    const getCls = () => cls();
    const getTitle = () => "t";
    const props = { class: getCls, title: getTitle };
    const [on, setOn] = createSignal(true);
    const el = document.createElement("div");
    const dispose = render(h("div", h(Show, { when: on }, h("span.a", props))), el);
    flush();
    const span = () => el.querySelector("span");
    expect(span().className).toBe("a b");
    expect(span().title).toBe("t");
    setCls("c");
    flush();
    expect(span().className).toBe("a c");
    setOn(false);
    flush();
    setOn(true);
    flush();
    expect(span().className).toBe("a c");
    expect(Object.getOwnPropertyDescriptor(props, "class").value).toBe(getCls);
    expect(Object.getOwnPropertyDescriptor(props, "title").value).toBe(getTitle);
    dispose();
  });
});

describe("h() elements returned from accessors", () => {
  test("an accessor child returning h(Loading) resolves and creates its child once", async () => {
    const child = asyncChild();
    const el = document.createElement("div");
    const dispose = render(
      h("div", () => h(Loading, { fallback: "loading" }, h(child.Component))),
      el
    );
    flush();
    expect(el.innerHTML).toBe("<div>loading</div>");
    child.resolve("done");
    await settle();
    expect(el.innerHTML).toBe("<div><span>done</span></div>");
    expect(child.created).toBe(1);
    dispose();
  });

  test("an accessor child returning h(Show) toggles without re-creating it", () => {
    const [on, setOn] = createSignal(false);
    let created = 0;
    const Toggle = () => (created++, h(Show, { when: on, fallback: "no" }, h("b", "yes")));
    const el = document.createElement("div");
    const dispose = render(
      h("div", () => h(Toggle)),
      el
    );
    expect(el.innerHTML).toBe("<div>no</div>");
    setOn(true);
    flush();
    expect(el.innerHTML).toBe("<div><b>yes</b></div>");
    expect(created).toBe(1);
    dispose();
  });
});

describe("render(h(App), el)", () => {
  test("an App rooted in Loading over an async child resolves", async () => {
    const child = asyncChild();
    const App = () => h(Loading, { fallback: "loading" }, h(child.Component));
    const el = document.createElement("div");
    const dispose = render(h(App), el);
    flush();
    expect(el.innerHTML).toBe("loading");
    child.resolve("done");
    await settle();
    expect(el.innerHTML).toBe("<span>done</span>");
    expect(child.created).toBe(1);
    dispose();
  });

  test("an App rooted in Show toggles without re-creating it", () => {
    const [on, setOn] = createSignal(false);
    let created = 0;
    const App = () => (created++, h(Show, { when: on, fallback: "no" }, h("b", "yes")));
    const el = document.createElement("div");
    const dispose = render(h(App), el);
    expect(el.innerHTML).toBe("no");
    setOn(true);
    flush();
    expect(el.innerHTML).toBe("<b>yes</b>");
    expect(created).toBe(1);
    dispose();
  });
});
