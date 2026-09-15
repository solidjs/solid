/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * spread() reads a merge() proxy DIRECTLY through its sources (later sources
 * override earlier — merge's own contract) instead of through the proxy;
 * every other source goes through the shared one-trap enumeration
 * (`ownKeys`). Semantics pinned here are the ones the old `for…in` + `hasOwn`
 * enumeration had: own string keys only, `children` and `ref` excluded,
 * symbol keys ignored, omit() still opaque.
 */
import { describe, expect, test } from "vitest";
import { render, spread } from "@solidjs/web";
import { createSignal, createStore, flush, merge, omit } from "solid-js";

const mount = (el: () => any) => {
  const container = document.createElement("div");
  const dispose = render(el, container);
  flush();
  return { container, dispose, el: () => container.firstElementChild as HTMLElement };
};

describe("spread over merge() sources", () => {
  test("later sources override earlier ones; statics mixed with a reactive spread", () => {
    const [attrs, setAttrs] = createSignal<Record<string, any>>({
      "data-a": "1",
      title: "from-spread"
    });
    const m = mount(() => <div title="static" data-s="s" {...attrs()} />);
    // Compiled: spread(el, merge({title, "data-s"}, () => attrs())) — the
    // spread source is LAST, so it wins on `title`.
    expect(m.el().getAttribute("title")).toBe("from-spread");
    expect(m.el().getAttribute("data-s")).toBe("s");
    expect(m.el().getAttribute("data-a")).toBe("1");
    setAttrs({ "data-a": "2" }); // title dropped from the spread → static value returns
    flush();
    expect(m.el().getAttribute("data-a")).toBe("2");
    expect(m.el().getAttribute("title")).toBe("static");
    m.dispose();
  });

  test("children and ref are never applied as attributes; symbol keys are ignored", () => {
    const sym = Symbol("s");
    let refd: any = null;
    const [attrs] = createSignal<any>({
      "data-x": "x",
      children: "not-an-attr",
      ref: (el: any) => (refd = el),
      [sym]: "never"
    });
    const m = mount(() => <div {...attrs()} />);
    expect(m.el().getAttribute("data-x")).toBe("x");
    expect(m.el().getAttribute("children")).toBeNull();
    expect(m.el().getAttribute("ref")).toBeNull();
    expect(m.el().hasAttribute("Symbol(s)")).toBe(false);
    expect(refd).toBe(m.el()); // ref is honored through the ref path, not as an attribute
    m.dispose();
  });

  test("omit() inside a merge stays opaque: omitted keys never reach the element", () => {
    const [props] = createSignal({ id: "keep", "data-drop": "d", title: "t" });
    const m = mount(() => {
      const rest = omit(props(), "data-drop");
      return <div class="c" {...rest} />;
    });
    expect(m.el().id).toBe("keep");
    expect(m.el().getAttribute("title")).toBe("t");
    expect(m.el().getAttribute("data-drop")).toBeNull();
    expect(m.el().className).toBe("c");
    m.dispose();
  });

  test("a lone omit() spread (no merge) is enumerated through omit's own filter", () => {
    const [props] = createSignal({ id: "keep", "data-drop": "d" });
    const m = mount(() => <div {...omit(props(), "data-drop")} />);
    expect(m.el().id).toBe("keep");
    expect(m.el().getAttribute("data-drop")).toBeNull();
    m.dispose();
  });

  test("an omit() view of a plain object stays reactive and never reads hidden getters", () => {
    const [title, setTitle] = createSignal("t1");
    let hiddenReads = 0;
    const props = {
      id: "keep",
      get title() {
        return title();
      },
      get isActive() {
        hiddenReads++;
        return true;
      },
      children: "kid"
    };
    const m = mount(() => <div {...omit(props, "isActive")} />);
    expect(m.el().getAttribute("title")).toBe("t1");
    expect(m.el().textContent).toBe("kid");
    setTitle("t2");
    flush();
    expect(m.el().getAttribute("title")).toBe("t2");
    expect(m.el().hasAttribute("isActive")).toBe(false);
    expect(hiddenReads).toBe(0);
    m.dispose();
  });

  test("a predicate omit() hides by rule through the spread", () => {
    const m = mount(() => (
      <div {...omit({ $props: "x", $theme: "y", id: "a" }, k => String(k)[0] === "$")} />
    ));
    expect(m.el().id).toBe("a");
    expect(m.el().hasAttribute("$props")).toBe(false);
    m.dispose();
  });

  test("omit() views and a merge() inside a sources array follow later-wins", () => {
    let typeReads = 0;
    const rest = {
      id: "from-rest",
      get type() {
        typeReads++;
        return "submit";
      },
      isActive: true
    };
    const merged = merge({ "data-a": "1" }, () => ({ "data-b": "2" }));
    const m = mount(() => {
      const el = document.createElement("button");
      spread(el, [omit(rest, "isActive"), merged, { type: "button" }]);
      return el;
    });
    expect(m.el().id).toBe("from-rest");
    expect(m.el().getAttribute("type")).toBe("button");
    expect(m.el().getAttribute("data-a")).toBe("1");
    expect(m.el().getAttribute("data-b")).toBe("2");
    expect(m.el().hasAttribute("isActive")).toBe(false);
    expect(typeReads).toBe(0);
    m.dispose();
  });

  test("children flow from an omit() view", () => {
    const [kid, setKid] = createSignal("a");
    const props = {
      get children() {
        return kid();
      },
      hidden: true
    };
    const m = mount(() => <div {...omit(props, "hidden")} />);
    expect(m.el().textContent).toBe("a");
    expect(m.el().hasAttribute("hidden")).toBe(false);
    setKid("b");
    flush();
    expect(m.el().textContent).toBe("b");
    m.dispose();
  });
});

describe("spread over a store proxy", () => {
  test("keys are tracked: adding and removing a key on the store re-applies the spread", () => {
    const [state, setState] = createStore<{ attrs: Record<string, string> }>({
      attrs: { "data-a": "1" }
    });
    const m = mount(() => <div class="k" {...state.attrs} />);
    expect(m.el().getAttribute("data-a")).toBe("1");
    setState(s => {
      s.attrs["data-b"] = "2";
    });
    flush();
    expect(m.el().getAttribute("data-b")).toBe("2");
    setState(s => {
      delete s.attrs["data-a"];
    });
    flush();
    expect(m.el().getAttribute("data-a")).toBeNull();
    expect(m.el().getAttribute("data-b")).toBe("2");
    expect(m.el().className).toBe("k");
    m.dispose();
  });

  test("replacing the whole attrs object swaps the attribute set", () => {
    const [state, setState] = createStore<{ attrs: Record<string, string> }>({
      attrs: { "data-kind": "a", "data-flow": "f0" }
    });
    const m = mount(() => <path {...state.attrs} />);
    expect(m.el().getAttribute("data-flow")).toBe("f0");
    setState(s => {
      s.attrs = { "data-kind": "a", "data-flow": "f1" };
    });
    flush();
    expect(m.el().getAttribute("data-flow")).toBe("f1");
    setState(s => {
      s.attrs = { "data-other": "o" };
    });
    flush();
    expect(m.el().getAttribute("data-kind")).toBeNull();
    expect(m.el().getAttribute("data-flow")).toBeNull();
    expect(m.el().getAttribute("data-other")).toBe("o");
    m.dispose();
  });
});

describe("style() with an object", () => {
  test("store-backed style object: properties set, changed, and removed", () => {
    const [state, setState] = createStore<{ style: Record<string, string> }>({
      style: { "stroke-width": "1", "stroke-opacity": "0.5" }
    });
    const m = mount(() => <div style={state.style} />);
    expect(m.el().style.getPropertyValue("stroke-width")).toBe("1");
    setState(s => {
      s.style = { "stroke-width": "3" };
    });
    flush();
    expect(m.el().style.getPropertyValue("stroke-width")).toBe("3");
    expect(m.el().style.getPropertyValue("stroke-opacity")).toBe("");
    // (The binding tracks the style OBJECT: replacing it re-applies; in-place
    // key mutation on the store object is not tracked — unchanged contract.)
    m.dispose();
  });

  test("a copy of a merge() result is a plain object: the spread reads the copy, not the sources", () => {
    // merge() is a view; writes to it are no-ops. A caller that needs its own
    // object copies it (`{...merged}`), and the copy carries no $SOURCES — the
    // spread must read what is on the copy, never tunnel back (#3384).
    const merged: any = merge({ class: "base", id: "base-id" }, { class: "override" });
    merged.id = "ignored";
    const props = { ...merged, id: "final-id", class: "final" };
    const m = mount(() => <div {...props} />);
    expect(m.el().className).toBe("final");
    expect(m.el().id).toBe("final-id");
    m.dispose();
  });

  test("plain object with inherited enumerable props: only OWN properties apply", () => {
    const base = { color: "blue" };
    const obj = Object.create(base);
    obj["font-size"] = "12px";
    const [style] = createSignal<any>(obj);
    const m = mount(() => <div style={style()} />);
    expect(m.el().style.getPropertyValue("font-size")).toBe("12px");
    expect(m.el().style.getPropertyValue("color")).toBe("");
    m.dispose();
  });
});
