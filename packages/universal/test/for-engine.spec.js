import * as r from "./custom.js";
import { createRoot, createSignal, flush, For, mapArray, DEV } from "solid-js";

/**
 * Unified For ENGINE through a custom renderer: `insert` engages `$for` with
 * ops built from the renderer's primitives. mapArray + insert through the
 * SAME renderer is the oracle.
 */
const stats = () => DEV.unifiedFor;

function span(text) {
  const n = r.createElement("span");
  n.textContent = text;
  return n;
}

function mount(build) {
  const parent = document.createElement("div");
  let dispose;
  createRoot(d => {
    dispose = d;
    r.insert(parent, build());
  });
  flush();
  return { parent, dispose };
}

describe("universal renderer: unified For engine", () => {
  it("engages, reorders by moving nodes, and matches the mapArray oracle", () => {
    const [list, setList] = createSignal(["a", "b", "c"]);
    const engaged0 = stats().engaged;
    const E = mount(() =>
      r.createComponent(For, {
        get each() {
          return list();
        },
        children: item => span(item)
      })
    );
    const O = mount(() => mapArray(list, item => span(item)));
    expect(stats().engaged).toBe(engaged0 + 1);
    expect(E.parent.innerHTML).toBe(O.parent.innerHTML);
    const [a, b, c] = Array.from(E.parent.children);
    for (const step of [["c", "a", "b"], ["b", "c"], ["x", "b", "c", "a"], [], ["z"], ["z", "z"]]) {
      setList(step);
      flush();
      expect(E.parent.innerHTML, step.join(",")).toBe(O.parent.innerHTML);
    }
    setList(["a", "b", "c"]);
    flush();
    expect(E.parent.innerHTML).toBe("<span>a</span><span>b</span><span>c</span>");
    // Identity through a pure move.
    const [na, nb, nc] = Array.from(E.parent.children);
    setList(["c", "b", "a"]);
    flush();
    expect(Array.from(E.parent.children)).toEqual([nc, nb, na]);
    void [a, b, c];
    E.dispose();
    O.dispose();
  });

  it("keyed={false}, keyed={fn}, index accessors, fallback — oracle-equal", () => {
    const [list, setList] = createSignal([
      { id: 1, v: "a" },
      { id: 2, v: "b" }
    ]);
    const rowIdx = (item, i) => span(`${item.v}:${i()}`);
    const rowAcc = (item, i) => span(`${item().v}:${typeof i === "function" ? i() : i}`);
    const E1 = mount(() =>
      r.createComponent(For, {
        get each() {
          return list();
        },
        children: rowIdx
      })
    );
    const O1 = mount(() => mapArray(list, rowIdx));
    const E2 = mount(() =>
      r.createComponent(For, {
        get each() {
          return list();
        },
        keyed: false,
        children: rowAcc
      })
    );
    const O2 = mount(() => mapArray(list, rowAcc, { keyed: false }));
    const key = x => x.id;
    const E3 = mount(() =>
      r.createComponent(For, {
        get each() {
          return list();
        },
        keyed: key,
        children: rowAcc
      })
    );
    const O3 = mount(() => mapArray(list, rowAcc, { keyed: key }));
    const fb = () => span("none");
    const E4 = mount(() =>
      r.createComponent(For, {
        get each() {
          return list();
        },
        get fallback() {
          return fb();
        },
        children: item => span(item.v)
      })
    );
    const O4 = mount(() => mapArray(list, item => span(item.v), { fallback: fb }));
    const pairs = [
      [E1, O1],
      [E2, O2],
      [E3, O3],
      [E4, O4]
    ];
    const check = label => {
      for (const [e, o] of pairs) expect(e.parent.innerHTML, label).toBe(o.parent.innerHTML);
    };
    check("init");
    setList([
      { id: 2, v: "B" },
      { id: 1, v: "a" },
      { id: 3, v: "c" }
    ]);
    flush();
    check("reorder + remint + add");
    setList([]);
    flush();
    check("clear → fallback");
    expect(E4.parent.innerHTML).toBe("<span>none</span>");
    setList([{ id: 3, v: "c" }]);
    flush();
    check("refill");
    for (const [e, o] of pairs) {
      e.dispose();
      o.dispose();
    }
  });

  it("engages through a component's children hole and tears down on a children change", () => {
    const [list, setList] = createSignal(["a", "b"]);
    const [show, setShow] = createSignal(true);
    const Wrap = props => {
      const div = r.createElement("div");
      r.insert(div, () => props.children);
      return div;
    };
    const engaged0 = stats().engaged;
    const { parent, dispose } = mount(() =>
      r.createComponent(Wrap, {
        get children() {
          return show()
            ? r.createComponent(For, {
                get each() {
                  return list();
                },
                children: item => span(item)
              })
            : span("none");
        }
      })
    );
    const div = parent.firstChild;
    expect(stats().engaged).toBe(engaged0 + 1);
    expect(div.innerHTML).toBe("<span>a</span><span>b</span>");
    setList(["b", "a", "c"]);
    flush();
    expect(div.innerHTML).toBe("<span>b</span><span>a</span><span>c</span>");
    setShow(false);
    flush();
    expect(div.innerHTML).toBe("<span>none</span>");
    setShow(true);
    flush();
    expect(div.innerHTML).toBe("<span>b</span><span>a</span><span>c</span>");
    dispose();
  });
});
