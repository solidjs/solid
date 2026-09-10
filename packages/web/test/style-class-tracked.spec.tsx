/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Object-valued `style` / `class` bindings whose value is a PROXY (a store
 * sub-object, merged props) are read in the tracked half of their effect via
 * the compiler-emitted `readShallow()`: in-place key mutations re-apply, and no
 * leaf read happens in the untracked commit phase (no STRICT_READ_UNTRACKED).
 * Inline literals compile per property and never get here; plain objects and
 * strings pass through `readShallow()` by identity.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, readShallow } from "@solidjs/web";
import { createSignal, createStore, flush, merge } from "solid-js";

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());
const strictReads = () =>
  warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes("STRICT_READ_UNTRACKED")).length;

const mount = (el: () => any) => {
  const container = document.createElement("div");
  const dispose = render(el, container);
  flush();
  return { container, dispose, el: () => container.firstElementChild as HTMLElement };
};

describe("style={storeObject}", () => {
  test("in-place key add / change / delete re-applies; no untracked leaf reads", () => {
    const [state, setState] = createStore<{ style: Record<string, string> }>({
      style: { "stroke-width": "1" }
    });
    const m = mount(() => <div style={state.style} />);
    expect(m.el().style.getPropertyValue("stroke-width")).toBe("1");
    setState(s => {
      s.style["stroke-width"] = "3";
    });
    flush();
    expect(m.el().style.getPropertyValue("stroke-width")).toBe("3");
    setState(s => {
      s.style["color"] = "red";
    });
    flush();
    expect(m.el().style.getPropertyValue("color")).toBe("red");
    setState(s => {
      delete s.style["stroke-width"];
    });
    flush();
    expect(m.el().style.getPropertyValue("stroke-width")).toBe("");
    expect(m.el().style.getPropertyValue("color")).toBe("red");
    expect(strictReads()).toBe(0);
    m.dispose();
  });

  test("replacing the object still works (identity change)", () => {
    const [state, setState] = createStore<{ style: Record<string, string> }>({
      style: { color: "red" }
    });
    const m = mount(() => <div style={state.style} />);
    setState(s => {
      s.style = { "font-size": "12px" };
    });
    flush();
    expect(m.el().style.getPropertyValue("color")).toBe("");
    expect(m.el().style.getPropertyValue("font-size")).toBe("12px");
    expect(strictReads()).toBe(0);
    m.dispose();
  });
});

describe("class={storeObject}", () => {
  test("in-place toggles re-apply; no untracked leaf reads", () => {
    const [state, setState] = createStore<{ classes: Record<string, boolean> }>({
      classes: { a: true, b: false }
    });
    const m = mount(() => <div class={state.classes} />);
    expect(m.el().className).toBe("a");
    setState(s => {
      s.classes.b = true;
    });
    flush();
    expect(m.el().classList.contains("b")).toBe(true);
    setState(s => {
      s.classes.a = false;
    });
    flush();
    expect(m.el().classList.contains("a")).toBe(false);
    setState(s => {
      s.classes.c = true;
    });
    flush();
    expect(m.el().classList.contains("c")).toBe(true);
    expect(strictReads()).toBe(0);
    m.dispose();
  });

  test("array class value with a store element", () => {
    const [state, setState] = createStore<{ classes: Record<string, boolean> }>({
      classes: { on: false }
    });
    const m = mount(() => <div class={["base", state.classes]} />);
    expect(m.el().className).toBe("base");
    setState(s => {
      s.classes.on = true;
    });
    flush();
    expect(m.el().classList.contains("on")).toBe(true);
    expect(m.el().classList.contains("base")).toBe(true);
    expect(strictReads()).toBe(0);
    m.dispose();
  });
});

describe("spread carrying style/class objects", () => {
  test("style sub-object from a store: in-place mutation re-applies through the spread", () => {
    const [state, setState] = createStore<{
      attrs: { style: Record<string, string>; class: Record<string, boolean> };
    }>({
      attrs: { style: { color: "red" }, class: { x: true } }
    });
    const m = mount(() => <div {...state.attrs} />);
    expect(m.el().style.getPropertyValue("color")).toBe("red");
    expect(m.el().className).toBe("x");
    setState(s => {
      s.attrs.style["color"] = "blue";
      s.attrs.class.y = true;
    });
    flush();
    expect(m.el().style.getPropertyValue("color")).toBe("blue");
    expect(m.el().classList.contains("y")).toBe(true);
    expect(strictReads()).toBe(0);
    m.dispose();
  });

  test("merged props object as the style value", () => {
    const [a, setA] = createSignal<Record<string, string>>({ color: "red" });
    const m = mount(() => {
      const styles = merge(() => a(), { "font-size": "10px" });
      return <div style={styles} />;
    });
    expect(m.el().style.getPropertyValue("color")).toBe("red");
    expect(m.el().style.getPropertyValue("font-size")).toBe("10px");
    setA({ color: "green" });
    flush();
    expect(m.el().style.getPropertyValue("color")).toBe("green");
    expect(strictReads()).toBe(0);
    m.dispose();
  });
});

describe("readShallow()", () => {
  test("identity passthrough for strings and plain objects; arrays re-mapped element-wise", () => {
    const o = { a: 1 };
    const arr = ["a", o];
    expect(readShallow("x")).toBe("x");
    expect(readShallow(null)).toBe(null);
    expect(readShallow(o)).toBe(o);
    const mapped = readShallow(arr) as any[];
    expect(mapped).not.toBe(arr);
    expect(mapped).toEqual(["a", o]);
    expect(mapped[1]).toBe(o);
  });

  test("copies a store proxy's own string keys into a plain object", () => {
    const [state] = createStore<{ s: Record<string, string> }>({ s: { a: "1", b: "2" } });
    const copy = readShallow(state.s) as any;
    expect(copy).not.toBe(state.s);
    expect(copy).toEqual({ a: "1", b: "2" });
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
  });

  test("re-maps an array only when an element is a proxy", () => {
    const [state] = createStore<{ s: Record<string, boolean> }>({ s: { a: true } });
    const arr = ["k", state.s];
    const out = readShallow(arr) as any[];
    expect(out).not.toBe(arr);
    expect(out[0]).toBe("k");
    expect(out[1]).toEqual({ a: true });
    expect(out[1]).not.toBe(state.s);
  });
});
