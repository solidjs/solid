import * as r from "./custom.js";
import { createRoot, createSignal, flush, onCleanup } from "solid-js";

// The renderer's spread() follows @solidjs/web's contract (#3388, #3419): at
// most two reactive nodes per element, `ref` folded into the props effect,
// children kept in their own owned insert, and an array of sources read
// directly — later sources win per key, only the winner read, function
// sources called inline with no merge and no memo.

function mount(fn) {
  let dispose;
  createRoot(d => {
    dispose = d;
    fn();
  });
  flush();
  return dispose;
}

describe("universal spread: ref folds into the props effect", () => {
  it("applies the ref once, then only when its identity changes", () => {
    const node = document.createElement("div");
    const [title, setTitle] = createSignal("a");
    const refA = vi.fn();
    const refB = vi.fn();
    // Boxed: createSignal(fn) would make a derived signal of the ref itself.
    const [current, setCurrent] = createSignal({ fn: refA });
    const dispose = mount(() =>
      r.spread(node, {
        get title() {
          return title();
        },
        get ref() {
          return current().fn;
        }
      })
    );
    expect(refA).toHaveBeenCalledTimes(1);
    expect(refA.mock.calls[0][0]).toBe(node);
    expect(node.getAttribute("ref")).toBeNull();

    // An unrelated prop change reruns the effect; the same ref stays applied.
    setTitle("b");
    flush();
    expect(node.getAttribute("title")).toBe("b");
    expect(refA).toHaveBeenCalledTimes(1);

    setCurrent({ fn: refB });
    flush();
    expect(refB).toHaveBeenCalledTimes(1);
    expect(refA).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("does not dispose what a ref created when other props change", () => {
    const node = document.createElement("div");
    const [title, setTitle] = createSignal("a");
    const cleanup = vi.fn();
    const dispose = mount(() =>
      r.spread(node, {
        get title() {
          return title();
        },
        ref: () => onCleanup(cleanup)
      })
    );
    setTitle("b");
    flush();
    // A ref runs with no owner: onCleanup inside it registers nowhere the
    // props effect can dispose.
    expect(cleanup).not.toHaveBeenCalled();
    dispose();
  });

  it("applies an array of refs", () => {
    const node = document.createElement("div");
    const seen = [];
    const dispose = mount(() =>
      r.spread(node, { ref: [el => seen.push(["a", el]), null, [el => seen.push(["b", el])]] })
    );
    expect(seen).toEqual([
      ["a", node],
      ["b", node]
    ]);
    dispose();
  });
});

describe("universal spread: children keep their own owned insert", () => {
  it("does not rebuild children when a prop changes", () => {
    const node = document.createElement("div");
    const [title, setTitle] = createSignal("a");
    const [text, setText] = createSignal("hello");
    const childRuns = vi.fn();
    const dispose = mount(() =>
      r.spread(node, {
        get title() {
          return title();
        },
        get children() {
          childRuns();
          return text();
        }
      })
    );
    expect(childRuns).toHaveBeenCalledTimes(1);
    const textNode = node.firstChild;
    setTitle("b");
    flush();
    expect(childRuns).toHaveBeenCalledTimes(1);
    expect(node.firstChild).toBe(textNode);
    setText("bye");
    flush();
    expect(childRuns).toHaveBeenCalledTimes(2);
    expect(node.textContent).toBe("bye");
    dispose();
  });

  it("inserts a plain data-property child with no effect and skips children under skipChildren", () => {
    const node = document.createElement("div");
    const dispose = mount(() => r.spread(node, { children: "static", title: "t" }));
    expect(node.textContent).toBe("static");
    expect(node.getAttribute("title")).toBe("t");

    const skipped = document.createElement("div");
    const dispose2 = mount(() => r.spread(skipped, { children: "nope" }, true));
    expect(skipped.textContent).toBe("");
    dispose();
    dispose2();
  });
});

describe("universal spread: sources array", () => {
  it("later sources win and shadowed getters are never read", () => {
    const node = document.createElement("div");
    const shadowed = vi.fn(() => "old");
    const dispose = mount(() =>
      r.spread(node, [
        {
          get title() {
            return shadowed();
          },
          id: "a"
        },
        { title: "new", class: "c" }
      ])
    );
    expect(node.getAttribute("title")).toBe("new");
    expect(node.getAttribute("id")).toBe("a");
    expect(node.getAttribute("class")).toBe("c");
    expect(shadowed).not.toHaveBeenCalled();
    dispose();
  });

  it("calls a function source inline and tracks it, with nullish sources skipped", () => {
    const node = document.createElement("div");
    const [dyn, setDyn] = createSignal({ title: "one" });
    const calls = vi.fn(() => dyn());
    const dispose = mount(() => r.spread(node, [{ id: "x" }, null, calls, undefined], true));
    expect(node.getAttribute("title")).toBe("one");
    expect(node.getAttribute("id")).toBe("x");
    const before = calls.mock.calls.length;
    setDyn({ title: "two", "data-extra": "y" });
    flush();
    expect(node.getAttribute("title")).toBe("two");
    expect(node.getAttribute("data-extra")).toBe("y");
    expect(calls.mock.calls.length).toBe(before + 1);
    // A key that disappears from the winning source is removed.
    setDyn({ title: "three" });
    flush();
    expect(node.hasAttribute("data-extra")).toBe(false);
    dispose();
  });

  it("takes children from the last source that has them", () => {
    const node = document.createElement("div");
    const dispose = mount(() => r.spread(node, [{ children: "first" }, { children: "second" }]));
    expect(node.textContent).toBe("second");
    dispose();
  });

  it("carries ref through the sources", () => {
    const node = document.createElement("div");
    const seen = vi.fn();
    const dispose = mount(() => r.spread(node, [{ ref: seen }, { title: "t" }]));
    expect(seen.mock.calls[0][0]).toBe(node);
    expect(node.getAttribute("ref")).toBeNull();
    dispose();
  });
});

describe("universal spread: single reactive and nullish sources", () => {
  it("resolves a lone accessor inside its own scopes", () => {
    const node = document.createElement("div");
    const [props, setProps] = createSignal({ title: "a", children: "kid" });
    const dispose = mount(() => r.spread(node, props));
    expect(node.getAttribute("title")).toBe("a");
    expect(node.textContent).toBe("kid");
    setProps({ title: "b", children: "kid2" });
    flush();
    expect(node.getAttribute("title")).toBe("b");
    expect(node.textContent).toBe("kid2");
    dispose();
  });

  it("treats a nullish source as an empty spread", () => {
    const node = document.createElement("div");
    const [props, setProps] = createSignal({ title: "a" });
    const dispose = mount(() => r.spread(node, props));
    expect(node.getAttribute("title")).toBe("a");
    setProps(null);
    flush();
    expect(node.hasAttribute("title")).toBe(false);
    const bare = document.createElement("div");
    const dispose2 = mount(() => r.spread(bare, undefined));
    expect(bare.attributes.length).toBe(0);
    dispose();
    dispose2();
  });
});
