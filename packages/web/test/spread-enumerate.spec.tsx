/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * spread()'s compute half copies its source ONE layer, tracked, through a
 * single key enumeration: `Reflect.ownKeys` for a proxy (one trap; the trap
 * tracks the key set), `Object.keys` for a plain object. These pin the
 * contract that enumeration change must hold: own-enumerable string keys
 * only for plain sources, symbol keys skipped everywhere, `children`/`ref`
 * excluded, and store-record sources stay reactive to key add/remove.
 */
import { describe, expect, test } from "vitest";
import { createRoot, createSignal, createStore, flush, merge } from "solid-js";
import { spread } from "../src/index.js";

const SYM = Symbol("s");

describe("spread source enumeration", () => {
  test("plain source: own-enumerable string keys only", () => {
    const el = document.createElement("div");
    const proto = { inherited: "no" };
    const src: any = Object.create(proto);
    src.id = "a";
    src[SYM] = "no";
    Object.defineProperty(src, "hidden", { value: "no", enumerable: false });
    src.children = "no";
    src.ref = () => {};
    createRoot(() => spread(el, src, true));
    flush();
    expect(el.getAttribute("id")).toBe("a");
    expect(el.hasAttribute("inherited")).toBe(false);
    expect(el.hasAttribute("hidden")).toBe(false);
    expect(el.hasAttribute("children")).toBe(false);
    expect(el.hasAttribute("ref")).toBe(false);
  });

  test("merge proxy source: union of sources, later wins, symbols skipped, reactive", () => {
    const el = document.createElement("div");
    const [dyn, setDyn] = createSignal<Record<PropertyKey, any>>({ title: "t1", [SYM]: 1 });
    createRoot(() => spread(el, merge({ id: "a", title: "t0" }, dyn), true));
    flush();
    expect(el.getAttribute("id")).toBe("a");
    expect(el.getAttribute("title")).toBe("t1");
    setDyn({ title: "t2", "data-x": "1" });
    flush();
    expect(el.getAttribute("title")).toBe("t2");
    expect(el.getAttribute("data-x")).toBe("1");
    // A key leaving the reactive source falls back to the static one.
    setDyn({});
    flush();
    expect(el.getAttribute("title")).toBe("t0");
    expect(el.hasAttribute("data-x")).toBe(false);
  });

  test("store record source: value change, key add and key remove all re-apply", () => {
    const el = document.createElement("div");
    const [state, setState] = createStore<{ row: Record<string, any> }>({
      row: { id: "a", title: "t" }
    });
    createRoot(() => spread(el, () => state.row, true));
    flush();
    expect(el.getAttribute("title")).toBe("t");
    setState(s => {
      s.row.title = "u";
    });
    flush();
    expect(el.getAttribute("title")).toBe("u");
    setState(s => {
      s.row["data-x"] = "1";
    });
    flush();
    expect(el.getAttribute("data-x")).toBe("1");
    setState(s => {
      delete s.row["data-x"];
    });
    flush();
    expect(el.hasAttribute("data-x")).toBe(false);
    expect(el.getAttribute("id")).toBe("a");
  });

  test("store record source: nested style object is applied per key", () => {
    const el = document.createElement("div");
    const [state, setState] = createStore({ row: { style: { color: "red" } } });
    createRoot(() => spread(el, () => state.row, true));
    flush();
    expect(el.style.color).toBe("red");
    setState(s => {
      s.row.style.color = "blue";
    });
    flush();
    expect(el.style.color).toBe("blue");
  });
});
