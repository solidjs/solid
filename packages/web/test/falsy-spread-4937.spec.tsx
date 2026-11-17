/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4937: a reactive spread that evaluates to a falsy value (`{...(c() && { k: 1 })}`)
// contributes no props, as `{}` does — on a component and on an element, at
// mount and when the condition turns false.
import { test, expect } from "vitest";
import { createSignal, flush, merge } from "solid-js";
import { render } from "../src/index.js";

function Child(props: { k?: number }) {
  return <i>{props.k ?? "none"}</i>;
}
function mount(fn: () => any) {
  const root = document.createElement("div");
  const dispose = render(fn, root);
  flush();
  return { root, dispose };
}

test("#4937 component, condition false from the start", () => {
  const [on] = createSignal(false);
  const { root, dispose } = mount(() => <Child {...(on() && { k: 1 })} />);
  expect(root.innerHTML).toBe("<i>none</i>");
  dispose();
});

test("#4937 intrinsic element, condition false from the start", () => {
  const [on] = createSignal(false);
  const { root, dispose } = mount(() => <b {...(on() && { title: "x" })}>hi</b>);
  expect(root.innerHTML).toBe("<b>hi</b>");
  dispose();
});

test("#4937 component and element, condition turns false and back", () => {
  const [on, setOn] = createSignal(true);
  const { root, dispose } = mount(() => (
    <>
      <Child {...(on() && { k: 1 })} />
      <b {...(on() && { title: "x" })}>hi</b>
    </>
  ));
  expect(root.innerHTML).toBe('<i>1</i><b title="x">hi</b>');
  setOn(false);
  flush();
  expect(root.innerHTML).toBe("<i>none</i><b>hi</b>");
  setOn(true);
  flush();
  expect(root.innerHTML).toBe('<i>1</i><b title="x">hi</b>');
  dispose();
});

test("#4937 merge() with a function source returning a falsy value", () => {
  for (const v of [false, 0, "", null, undefined]) {
    const m: any = merge({ a: 1 }, () => v as any);
    expect(m.a).toBe(1);
    expect("k" in m).toBe(false);
    expect(Object.keys(m)).toEqual(["a"]);
  }
});
