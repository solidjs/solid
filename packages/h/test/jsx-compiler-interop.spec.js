/**
 * Interop test: consume components shaped the way
 * `babel-plugin-jsx-dom-expressions` compiles them from within
 * `h(...)`. The components below are **hand-written to match the
 * compiler's output shape** — `template(...)` + `cloneNode` + `insert`
 * + `effect(setAttribute(…))` — rather than wired through the actual
 * plugin, so this suite stays self-contained. The point is to pin the
 * `props` shape hyper hands a compiled component: getters for dynamic
 * props, plain values for static props, and `children` matching what
 * hyper's tagged-thunk consumption produces.
 */

import { createRoot, createSignal, flush } from "solid-js";
import { createHyperScript } from "../src/hyperscript.js";
import * as r from "../../web/src/client.js";

const h = createHyperScript(r);

// -- precanned compiler-output components ------------------------------

// Shape of what Solid 2.0's JSX compiler produces for:
//   function Link(props) { return <a href={props.to}>{props.children}</a>; }
// `template(...)` returns a factory function; invoking it yields a
// cloned DOM node. Dynamic attributes compile to a split-phase
// `effect(compute, apply)`: `compute` reads the source value, `apply`
// pushes it onto the node, receiving the previous value as its second
// arg.
const _linkTpl = r.template(`<a></a>`);
function Link(props) {
  const el = _linkTpl();
  r.effect(
    () => props.to,
    (v, p) => v !== p && r.setAttribute(el, "href", v)
  );
  r.insert(el, () => props.children);
  return el;
}

// Shape for:
//   function Panel(props) {
//     return <div class={props.class}><h1>{props.title}</h1>{props.children}</div>;
//   }
const _panelTpl = r.template(`<div><h1></h1></div>`);
function Panel(props) {
  const el = _panelTpl();
  const h1 = el.firstChild;
  r.effect(
    () => props.class,
    (v, p) => r.className(el, v, p)
  );
  r.insert(h1, () => props.title);
  r.insert(el, () => props.children, null);
  return el;
}

// Shape for:
//   function Outer(props) { return <section>{props.children}</section>; }
// — children consumed reactively via `insert(el, () => props.children)`.
const _outerTpl = r.template(`<section></section>`);
function Outer(props) {
  const el = _outerTpl();
  r.insert(el, () => props.children);
  return el;
}

// --------------------------------------------------------------------

describe("JSX-compiler output consumed from h(...)", () => {
  test("static string prop + string child round-trip", () => {
    const host = createRoot(() => h(Link, { to: "/about" }, "About")());
    expect(host.outerHTML).toBe('<a href="/about">About</a>');
  });

  test("dynamic prop threaded through dynamicProperty stays reactive", () => {
    const [to, setTo] = createSignal("/home");
    const dispose = [];
    const host = createRoot(d => {
      dispose.push(d);
      return h(Link, { to: () => to() }, "Go")();
    });

    expect(host.getAttribute("href")).toBe("/home");
    setTo("/profile");
    flush();
    expect(host.getAttribute("href")).toBe("/profile");
    dispose[0]();
  });

  test("dynamic child accessor stays reactive inside a compiled component", () => {
    const [label, setLabel] = createSignal("one");
    const dispose = [];
    const host = createRoot(d => {
      dispose.push(d);
      return h(Link, { to: "/x" }, () => label())();
    });

    expect(host.textContent).toBe("one");
    setLabel("two");
    flush();
    expect(host.textContent).toBe("two");
    dispose[0]();
  });

  test("hyper element child passes into a compiled component", () => {
    // The caller passes a tagged thunk as a child; the compiled
    // component's `insert(el, () => props.children)` is what actually
    // invokes the thunk via r.insert's effect wrapping.
    const host = createRoot(() => h(Link, { to: "/a" }, h("strong", "Bold"))());
    expect(host.outerHTML).toBe('<a href="/a"><strong>Bold</strong></a>');
  });

  test("multiple hyper children become an array children prop", () => {
    const host = createRoot(() => h(Outer, null, h("span", "a"), h("span", "b"), h("span", "c"))());
    expect(host.outerHTML).toBe("<section><span>a</span><span>b</span><span>c</span></section>");
  });

  test("compiled Panel with title + class + children composes under hyper", () => {
    const [title, setTitle] = createSignal("first");
    const [variant, setVariant] = createSignal("primary");

    const dispose = [];
    const host = createRoot(d => {
      dispose.push(d);
      return h(Panel, { class: () => variant(), title: () => title() }, h("p", "body"))();
    });

    expect(host.outerHTML).toBe('<div class="primary"><h1>first</h1><p>body</p></div>');

    setTitle("second");
    setVariant("secondary");
    flush();
    expect(host.outerHTML).toBe('<div class="secondary"><h1>second</h1><p>body</p></div>');

    dispose[0]();
  });

  test("hyper composition nests compiled components", () => {
    const [to, setTo] = createSignal("/a");
    const dispose = [];
    const host = createRoot(d => {
      dispose.push(d);
      return h(Outer, null, h(Link, { to: () => to() }, "one"), h(Link, { to: "/b" }, "two"))();
    });

    expect(host.outerHTML).toBe('<section><a href="/a">one</a><a href="/b">two</a></section>');

    setTo("/c");
    flush();
    expect(host.firstChild.getAttribute("href")).toBe("/c");
    dispose[0]();
  });

  test("compiled component consumed with a user function child", () => {
    // Mimics a compiled consumer that receives a user's accessor —
    // same shape as when someone writes `{signal()}` in JSX.
    const [sig, setSig] = createSignal("hello");
    const dispose = [];
    const host = createRoot(d => {
      dispose.push(d);
      return h(Outer, null, () => sig())();
    });

    expect(host.textContent).toBe("hello");
    setSig("world");
    flush();
    expect(host.textContent).toBe("world");
    dispose[0]();
  });
});
