/**
 * Contract tests for how `h(Component, …)` collects and exposes
 * `props.children` under the lazy / tagged-thunk design.
 *
 *   - `props.children` mirrors the caller's input. A scalar stays a
 *     scalar, a Node (or a tagged thunk) stays whatever the caller
 *     passed. Multiple positional children become an array.
 *   - Zero-arity function props go through `dynamicProperty` so
 *     attributes/props stay reactive.
 *   - Function props with arity ≥ 1 (render-callback shape:
 *     `children: row => h(Row, …)`, `header: tab => h(…)`, a `mapArray`
 *     `(item, index) => h(Row, …)` row callback, etc.) are wrapped so
 *     any tagged `h(...)` thunks in the callback's return value are
 *     materialized at the call site. This matches what JSX-compiled
 *     call sites store and prevents render-prop consumers (including
 *     `mapArray`-style `For`/`Index` and any third-party JSX-compiled
 *     component that re-invokes a callback with arguments) from
 *     re-running stable children on parent updates. Arity (so consumers
 *     that introspect `cb.length` see the original signature),
 *     `this`-binding, and identity within the rest of the tree are
 *     preserved.
 *   - Consumers insert children by placing them inside another `h(…)`
 *     call; tagged thunks auto-invoke at consumption, user accessors
 *     route through `r.insert`.
 *   - JSX-compiler output (eagerly-evaluated arrays / scalars / Nodes
 *     passed as children) continues to work.
 */

import { createRoot, createSignal, flush } from "solid-js";
import { createHyperScript } from "../src/hyperscript.js";
import * as r from "../../web/src/client.js";

const h = createHyperScript(r);

const mount = fn => createRoot(() => fn()());

describe("component children contract", () => {
  test("static string child flows through untouched", () => {
    const Comp = props => {
      expect(typeof props.children).toBe("string");
      return h("p", props.children);
    };
    const el = mount(() => h(Comp, null, "hello"));
    expect(el.outerHTML).toBe("<p>hello</p>");
  });

  test("static Node child flows through untouched", () => {
    const inner = document.createElement("span");
    inner.textContent = "inner";
    const Comp = props => {
      expect(props.children).toBe(inner);
      return h("p", props.children);
    };
    const el = mount(() => h(Comp, null, inner));
    expect(el.firstChild).toBe(inner);
  });

  test("multiple children collected as an array", () => {
    const Comp = props => {
      expect(Array.isArray(props.children)).toBe(true);
      expect(props.children).toHaveLength(3);
      return h("ul", props.children);
    };
    const el = mount(() => h(Comp, null, h("li", "a"), h("li", "b"), h("li", "c")));
    expect(el.children[0].textContent).toBe("a");
    expect(el.children[2].textContent).toBe("c");
  });

  test("zero-arity function child is exposed as a reactive getter", () => {
    // Same shape Solid's JSX compiler uses: reading `props.children`
    // invokes the accessor and returns the current value. That means a
    // naive `h("p", props.children)` consumer is a one-shot read — for
    // reactivity the consumer wraps in its own thunk.
    const [text, setText] = createSignal("one");
    let seenType;
    const Comp = props => {
      seenType = typeof props.children;
      return h("p", () => props.children);
    };
    const el = mount(() => h(Comp, null, () => text()));
    expect(seenType).toBe("string");
    expect(el.textContent).toBe("one");
    setText("two");
    flush();
    expect(el.textContent).toBe("two");
  });

  test("function child reactive only when consumer thunks the read", () => {
    const [value, setValue] = createSignal("A");
    const Raw = props => h("div", props.children);
    const Thunk = props => h("div", () => props.children);

    const host = createRoot(() => [h(Raw, null, () => value())(), h(Thunk, null, () => value())()]);

    expect(host[0].textContent).toBe("A");
    expect(host[1].textContent).toBe("A");

    setValue("B");
    flush();
    // Raw read `props.children` once at render time, so no update.
    expect(host[0].textContent).toBe("A");
    // Thunk wraps the read in an accessor, which r.insert tracks.
    expect(host[1].textContent).toBe("B");
  });

  test("nested component passes its accessor result as a function child", () => {
    const [value, setValue] = createSignal("x");
    // `value` is a zero-arity prop, so dynamicProperty turns reads
    // into evaluated values. Inner returns a zero-arity accessor
    // around it, which becomes Outer's function child.
    const Inner = props => () => props.value;
    const Outer = props => h("section", props.children);

    const el = mount(() => h(Outer, null, h(Inner, { value: () => value() })));

    expect(el.textContent).toBe("x");
    setValue("y");
    flush();
    expect(el.textContent).toBe("y");
  });

  test("component that returns its children fragment-style preserves them", () => {
    const Pass = props => props.children;
    const inner = document.createElement("span");
    expect(mount(() => h(Pass, null, inner))).toBe(inner);
    expect(mount(() => h(Pass, null, "text"))).toBe("text");

    // Zero-arity function children are wrapped by `dynamicProperty`,
    // so reading `props.children` returns the call's result. The
    // consumer sees the value, not the original function identity.
    const fn = () => "dynamic";
    expect(mount(() => h(Pass, null, fn))).toBe("dynamic");
  });

  test("higher-arity render function as children (For-like pattern)", () => {
    const [items] = createSignal(["a", "b"]);
    // A naive `List` component that maps statically — we're only
    // checking that the render function reaches the component's body
    // unchanged (not wrapped by dynamicProperty).
    const List = props => {
      expect(typeof props.children).toBe("function");
      expect(props.children.length).toBe(1);
      return h(
        "ul",
        items().map(v => props.children(v))
      );
    };
    const el = mount(() => h(List, { items: () => items() }, v => h("li", v)));
    expect(el.outerHTML).toBe("<ul><li>a</li><li>b</li></ul>");
  });

  test("children explicitly set via props wins over positional args", () => {
    const Comp = props => h("p", props.children);
    const el = mount(() => h(Comp, { children: "from-prop" }));
    expect(el.textContent).toBe("from-prop");
  });
});

describe("dynamicProperty wrapping regression guard", () => {
  test("non-children zero-arity function props are still reactive", () => {
    const [label, setLabel] = createSignal("first");

    const Comp = props => h("button", { title: () => props.label });

    const el = mount(() => h(Comp, { label: () => label() }));
    expect(el.getAttribute("title")).toBe("first");

    setLabel("second");
    flush();
    expect(el.getAttribute("title")).toBe("second");
  });

  test("higher-arity function props are wrapped but preserve arity and forward all args", () => {
    let received;
    const Comp = props => {
      received = props.onUse;
      return h("div");
    };
    const handler = (a, b) => a + b;
    mount(() => h(Comp, { onUse: handler }));
    expect(received).not.toBe(handler);
    expect(received.length).toBe(2);
    expect(received(2, 3)).toBe(5);
  });

  test("getter-backed props still route through spread and stay reactive", () => {
    const [v, setV] = createSignal("a");
    const props = {};
    Object.defineProperty(props, "data-x", {
      enumerable: true,
      configurable: true,
      get() {
        return v();
      }
    });
    const el = mount(() => h("div", props));
    expect(el.getAttribute("data-x")).toBe("a");
    setV("b");
    flush();
    expect(el.getAttribute("data-x")).toBe("b");
  });
});

describe("JSX-compiler output compatibility", () => {
  test("children passed as eagerly-evaluated array-of-Nodes renders statically", () => {
    // Mirrors what Solid's JSX compiler emits for
    // `<Comp>{items.map(i => <span>{i}</span>)}</Comp>` after running
    // the component — the children arg is already a real array of
    // Nodes by the time `h` sees it.
    const items = ["a", "b", "c"].map(v => {
      const span = document.createElement("span");
      span.textContent = v;
      return span;
    });
    const Comp = props => h("section", props.children);
    const el = mount(() => h(Comp, null, items));
    expect(el.outerHTML).toBe("<section><span>a</span><span>b</span><span>c</span></section>");
  });

  test("eagerly-evaluated scalar expression children render as text", () => {
    const [count] = createSignal(42);
    const Comp = props => h("p", props.children);
    const el = mount(() => h(Comp, null, count()));
    expect(el.textContent).toBe("42");
  });

  test("children prop provided as scalar via props object (not positional)", () => {
    const Comp = props => h("p", props.children);
    expect(mount(() => h(Comp, { children: "lit" })).textContent).toBe("lit");
    expect(mount(() => h(Comp, { children: 7 })).textContent).toBe("7");
  });
});

describe("callback prop wrap", () => {
  test("preserves arity so consumers can introspect props.cb.length", () => {
    let observed1, observed2, observed3;
    const Comp = props => {
      observed1 = props.cb1.length;
      observed2 = props.cb2.length;
      observed3 = props.cb3.length;
      return h("span", "x");
    };
    mount(() =>
      h(Comp, {
        cb1: x => x,
        cb2: (x, y) => x + y,
        cb3: (a, b, c) => a + b + c
      })
    );
    expect(observed1).toBe(1);
    expect(observed2).toBe(2);
    expect(observed3).toBe(3);
  });

  test("forwards all arguments through the wrap (2-arity row callback shape)", () => {
    // `mapArray` invokes its row callback as `cb(item, index)` (or
    // with an index signal). The wrap mustn't drop the second arg.
    let seen;
    const Comp = props => {
      seen = props.cb("item", 7);
      return h("span", "x");
    };
    mount(() => h(Comp, { cb: (a, b) => `${a}:${b}` }));
    expect(seen).toBe("item:7");
  });

  test("is idempotent across nested components (passing through doesn't re-wrap)", () => {
    // The wrap exists only to materialize tagged thunks at the
    // boundary; threading a wrapped callback through more layers must
    // not nest further wrappers (that would erode identity unbounded).
    const orig = a => a;
    let received1, received2;

    const Inner = props => {
      received2 = props.cb;
      return h("span", "x");
    };
    const Outer = props => {
      received1 = props.cb;
      return h(Inner, { cb: props.cb });
    };

    mount(() => h(Outer, { cb: orig }));

    expect(received1).not.toBe(orig);
    expect(received1).toBe(received2);
  });

  test("preserves `this` binding when the callback is forwarded as a DOM event handler", () => {
    // Any-arity event handler routed through a component prop hits
    // the wrap, so we have to forward `this` explicitly.
    // dom-expressions binds `this` to the element when invoking
    // delegated handlers — that contract has to survive the wrap.
    let observedThis = null;
    const handler = function (e) {
      observedThis = this;
    };

    const Button = props => h("button", { onClick: props.onClick }, "Go");

    const root = document.createElement("div");
    document.body.appendChild(root);
    const dispose = r.render(() => h(Button, { onClick: handler }), root);
    try {
      const btn = root.querySelector("button");
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(observedThis).toBe(btn);
    } finally {
      dispose();
      document.body.removeChild(root);
    }
  });
});

describe("control-flow shapes via function children", () => {
  test("Show-like branching via a function child inside a host element", () => {
    const [on, setOn] = createSignal(true);
    const el = mount(() => h("div", () => (on() ? h("span", "yes")() : h("span", "no")())));
    expect(el.textContent).toBe("yes");
    setOn(false);
    flush();
    expect(el.textContent).toBe("no");
  });

  test("component with a conditional function child stays reactive when thunked at consumption", () => {
    const [on, setOn] = createSignal(false);
    // Box consumes `props.children` via a thunk so each call is tracked
    // by r.insert's effect. Without the thunk the value would be read
    // once at render time and never again.
    const Box = props => h("aside", () => props.children);
    const el = mount(() => h(Box, null, () => (on() ? "A" : "B")));
    expect(el.textContent).toBe("B");
    setOn(true);
    flush();
    expect(el.textContent).toBe("A");
  });
});
