import * as r from "./custom.js";
import { createRenderer } from "../src/universal.js";
import { createRoot, createSignal, flush, NotReadyError, onCleanup } from "solid-js";

// Static (non-function) accessors skip the effect wiring and call
// insertExpression synchronously — exercise each branch of that path.
describe("universal insert (static values)", () => {
  it("inserts a static string", () => {
    const parent = document.createElement("div");
    r.insert(parent, "hello");
    expect(parent.innerHTML).toBe("hello");
  });

  it("inserts a static DOM node", () => {
    const parent = document.createElement("div");
    const span = document.createElement("span");
    span.textContent = "x";
    r.insert(parent, span);
    expect(parent.innerHTML).toBe("<span>x</span>");
  });

  it("inserts a static array of nodes", () => {
    const parent = document.createElement("div");
    const a = document.createElement("a");
    const b = document.createElement("b");
    r.insert(parent, [a, b]);
    expect(parent.innerHTML).toBe("<a></a><b></b>");
  });

  it("inserts nothing for a static null", () => {
    const parent = document.createElement("div");
    r.insert(parent, null);
    expect(parent.innerHTML).toBe("");
  });

  it("inserts an empty string for a static empty array", () => {
    const parent = document.createElement("div");
    r.insert(parent, []);
    expect(parent.innerHTML).toBe("");
  });
});

// Exercise insertExpression branches that are only reachable with a
// pre-existing `current` state (i.e. when the effect runs again).
describe("universal insert transitions", () => {
  it("string → node replaces existing text node via cleanChildren", () => {
    const parent = document.createElement("div");
    const [value, setValue] = createSignal("before");

    let dispose;
    createRoot(d => {
      dispose = d;
      r.insert(parent, () => value());
    });
    flush();
    expect(parent.innerHTML).toBe("before");

    const span = document.createElement("span");
    span.textContent = "after";
    setValue(span);
    flush();
    expect(parent.innerHTML).toBe("<span>after</span>");
    dispose();
  });

  it("node → string replaces existing DOM child", () => {
    const parent = document.createElement("div");
    const span = document.createElement("span");
    span.textContent = "first";
    const [value, setValue] = createSignal(span);

    let dispose;
    createRoot(d => {
      dispose = d;
      r.insert(parent, () => value());
    });
    flush();
    expect(parent.innerHTML).toBe("<span>first</span>");

    setValue("plain");
    flush();
    expect(parent.innerHTML).toBe("plain");
    dispose();
  });

  it("node → null clears children", () => {
    const parent = document.createElement("div");
    const span = document.createElement("span");
    span.textContent = "v";
    const [value, setValue] = createSignal(span);

    let dispose;
    createRoot(d => {
      dispose = d;
      r.insert(parent, () => value());
    });
    flush();
    expect(parent.innerHTML).toBe("<span>v</span>");

    setValue(null);
    flush();
    expect(parent.innerHTML).toBe("");
    dispose();
  });

  it("array → empty array clears children", () => {
    const parent = document.createElement("div");
    const a = document.createElement("a");
    const b = document.createElement("b");
    const [value, setValue] = createSignal([a, b]);

    let dispose;
    createRoot(d => {
      dispose = d;
      r.insert(parent, () => value());
    });
    flush();
    expect(parent.innerHTML).toBe("<a></a><b></b>");

    setValue([]);
    flush();
    expect(parent.innerHTML).toBe("");
    dispose();
  });

  it("node → array appends, array → node replaces via cleanChildren", () => {
    const parent = document.createElement("div");
    const solo = document.createElement("i");
    solo.textContent = "solo";
    const [value, setValue] = createSignal(solo);

    let dispose;
    createRoot(d => {
      dispose = d;
      r.insert(parent, () => value());
    });
    flush();
    expect(parent.innerHTML).toBe("<i>solo</i>");

    const a = document.createElement("a");
    const b = document.createElement("b");
    setValue([a, b]);
    flush();
    expect(parent.innerHTML).toBe("<a></a><b></b>");

    const replacement = document.createElement("em");
    replacement.textContent = "em";
    setValue(replacement);
    flush();
    expect(parent.innerHTML).toBe("<em>em</em>");
    dispose();
  });

  it("reconcileArrays: reverses elements", () => {
    const parent = document.createElement("div");
    const n1 = document.createElement("span");
    n1.textContent = "1";
    const n2 = document.createElement("span");
    n2.textContent = "2";
    const n3 = document.createElement("span");
    n3.textContent = "3";
    const n4 = document.createElement("span");
    n4.textContent = "4";

    const [list, setList] = createSignal([n1, n2, n3, n4]);

    let dispose;
    createRoot(d => {
      dispose = d;
      r.insert(parent, () => list());
    });
    flush();
    expect(parent.innerHTML).toBe("<span>1</span><span>2</span><span>3</span><span>4</span>");

    // Reverse → exercises the swap-backward and map-fallback branches.
    setList([n4, n3, n2, n1]);
    flush();
    expect(parent.innerHTML).toBe("<span>4</span><span>3</span><span>2</span><span>1</span>");

    // Rotate → common prefix / suffix branches + append path.
    setList([n3, n2, n1, n4]);
    flush();
    expect(parent.innerHTML).toBe("<span>3</span><span>2</span><span>1</span><span>4</span>");

    // Remove head and tail.
    setList([n2, n1]);
    flush();
    expect(parent.innerHTML).toBe("<span>2</span><span>1</span>");
    dispose();
  });

  it("keeps a node that replace + end-swap left detached (#574)", () => {
    const parent = document.createElement("div");
    const mk = t => {
      const s = document.createElement("span");
      s.textContent = t;
      return s;
    };
    const A = mk("i1"),
      B = mk("i3"),
      C = mk("i4"),
      D = mk("i1"),
      E = mk("i5");
    const [list, setList] = createSignal([A, B, C, D, E]);
    let dispose;
    createRoot(d => {
      dispose = d;
      r.insert(parent, () => list());
    });
    flush();
    setList([B, A, E, C, D]);
    flush();
    expect([...parent.children].map(n => n.textContent).join(",")).toBe("i3,i1,i5,i4,i1");
    expect(parent.contains(C)).toBe(true);
    dispose();
  });
});

describe("universal render()", () => {
  it("removes inserted mount nodes when disposed", () => {
    const parent = document.createElement("div");
    const span = document.createElement("span");
    span.textContent = "mounted";

    const dispose = r.render(() => span, parent);
    expect(parent.firstChild).toBe(span);

    dispose();
    expect(parent.firstChild).toBeNull();
    expect(() => dispose()).not.toThrow();
  });

  it("removes array mount nodes when disposed", () => {
    const parent = document.createElement("div");
    const first = document.createElement("span");
    const second = document.createElement("button");

    const dispose = r.render(() => [first, second], parent);
    expect(parent.childNodes.length).toBe(2);
    expect(parent.firstChild).toBe(first);
    expect(parent.lastChild).toBe(second);

    dispose();
    expect(parent.childNodes.length).toBe(0);
  });

  it("removes primitive mount nodes when disposed", () => {
    const parent = document.createElement("div");

    const dispose = r.render(() => "mounted", parent);
    expect(parent.textContent).toBe("mounted");

    dispose();
    expect(parent.firstChild).toBeNull();
  });

  it("removes dynamic mount nodes when disposed", () => {
    const parent = document.createElement("div");
    const [value, setValue] = createSignal("first");

    const dispose = r.render(() => () => value(), parent);
    flush();
    expect(parent.textContent).toBe("first");

    setValue("second");
    flush();
    expect(parent.textContent).toBe("second");

    dispose();
    expect(parent.firstChild).toBeNull();
  });

  it("does not remove mount nodes that moved to another parent", () => {
    const parent = document.createElement("div");
    const other = document.createElement("section");
    const span = document.createElement("span");

    const dispose = r.render(() => span, parent);
    expect(parent.firstChild).toBe(span);

    other.appendChild(span);
    dispose();

    expect(parent.firstChild).toBeNull();
    expect(other.firstChild).toBe(span);
  });

  it("uses renderer cleanupNodes when provided", () => {
    const cleanupNodes = vi.fn();
    const renderer = createRenderer({
      createElement(string) {
        return document.createElement(string);
      },
      createTextNode(value) {
        return document.createTextNode(value);
      },
      replaceText(textNode, value) {
        textNode.data = value;
      },
      setProperty(node, name, value) {
        if (value == null) node.removeAttribute(name);
        else node.setAttribute(name, value);
      },
      insertNode(parent, node, anchor) {
        parent.insertBefore(node, anchor);
      },
      removeNode(parent, node) {
        parent.removeChild(node);
      },
      cleanupNodes,
      isTextNode(node) {
        return node.nodeType === 3;
      },
      getParentNode(node) {
        return node.parentNode;
      },
      getFirstChild(node) {
        return node.firstChild;
      },
      getNextSibling(node) {
        return node.nextSibling;
      }
    });
    const parent = document.createElement("div");
    const span = document.createElement("span");

    const dispose = renderer.render(() => span, parent);
    dispose();

    expect(cleanupNodes).toHaveBeenCalledTimes(1);
    expect(cleanupNodes).toHaveBeenCalledWith(parent, [span]);
    expect(parent.firstChild).toBe(span);
  });
});

// Remaining insertExpression / cleanChildren edge cases in the universal
// renderer — reached only with very specific (current, value, marker)
// shapes.
describe("universal insert tail-branch coverage", () => {
  it("appends new children when the previous multi-insert was empty", () => {
    const parent = document.createElement("div");
    const marker = document.createTextNode("");
    parent.appendChild(marker);

    const [list, setList] = createSignal([]);
    let dispose;
    createRoot(d => {
      dispose = d;
      r.insert(parent, () => list(), marker);
    });
    flush();

    const a = document.createElement("a");
    const b = document.createElement("b");
    setList([a, b]);
    flush();

    // empty → non-empty with a marker hits appendNodes(parent, value, marker).
    expect(parent.firstChild).toBe(a);
    expect(a.nextSibling).toBe(b);
    expect(b.nextSibling).toBe(marker);
    dispose();
  });

  it("reconcileArrays: shift-many path via map fallback", () => {
    const parent = document.createElement("div");
    const nodes = ["x1", "x2", "y"].map(ch => {
      const el = document.createElement("span");
      el.textContent = ch;
      return el;
    });
    const [x1, x2, y] = nodes;

    const [list, setList] = createSignal([x1, x2, y]);
    let dispose;
    createRoot(d => {
      dispose = d;
      r.insert(parent, () => list());
    });
    flush();
    expect(parent.innerHTML).toBe("<span>x1</span><span>x2</span><span>y</span>");

    // [x1, x2, y] → [y, x1, x2]
    // No common prefix/suffix, no swap-backward; map fallback kicks in,
    // sees x1 + x2 as a consecutive run in b, uses the "shift many"
    // insertion loop before the aStart anchor.
    setList([y, x1, x2]);
    flush();
    expect(parent.innerHTML).toBe("<span>y</span><span>x1</span><span>x2</span>");
    dispose();
  });

  it("cleanChildren: keeps replacement present in array-current", () => {
    const parent = document.createElement("div");
    const a = document.createElement("a");
    const b = document.createElement("b");
    parent.appendChild(a);
    parent.appendChild(b);

    // b is already in current → inserted=true branch in cleanChildren.
    r.insert(parent, b, undefined, [a, b]);
    expect(parent.childNodes.length).toBe(1);
    expect(parent.firstChild).toBe(b);
  });

  it("cleanChildren: inserts single node when current is empty", () => {
    const parent = document.createElement("div");
    const span = document.createElement("span");

    // current.length === 0 with a replacement → else-if (replacement)
    // inserts without the iteration path.
    r.insert(parent, span, undefined, []);
    expect(parent.firstChild).toBe(span);
  });

  it("cleanChildren: appends replacement when the only array element is detached", () => {
    const parent = document.createElement("div");
    const detached = document.createElement("p"); // never attached
    const span = document.createElement("span");

    // Non-array value + array current of length 1 whose element isn't in
    // parent → cleanChildren hits `isParent=false` and appends via the
    // (null) marker.
    r.insert(parent, span, undefined, [detached]);
    expect(parent.childNodes.length).toBe(1);
    expect(parent.firstChild).toBe(span);
  });

  it("normalize wraps a static null into an empty text node when multi", () => {
    const parent = document.createElement("div");
    const marker = document.createTextNode("");
    parent.appendChild(marker);

    // Static null + marker → normalize's `value != null ? value : ""`
    // branch converts null to an empty string text node.
    r.insert(parent, null, marker);
    // An empty-string text node sits before the marker.
    expect(parent.firstChild.nodeType).toBe(3);
    expect(parent.firstChild.data).toBe("");
    expect(parent.firstChild.nextSibling).toBe(marker);
  });

  it("reconcileArrays: prepends a new element (no common prefix, common suffix)", () => {
    const parent = document.createElement("div");
    const a = document.createElement("span");
    a.textContent = "a";
    const b = document.createElement("span");
    b.textContent = "b";

    const [list, setList] = createSignal([a, b]);
    let dispose;
    createRoot(d => {
      dispose = d;
      r.insert(parent, () => list());
    });
    flush();
    expect(parent.innerHTML).toBe("<span>a</span><span>b</span>");

    const x = document.createElement("span");
    x.textContent = "x";
    // [a, b] → [x, a, b]: suffix matches entirely, append path runs with
    // bStart=0 and bEnd < bLength → anchor is b[bEnd - bStart].
    setList([x, a, b]);
    flush();
    expect(parent.innerHTML).toBe("<span>x</span><span>a</span><span>b</span>");
    dispose();
  });

  it("reconcileArrays: inserts in the middle (common prefix + common suffix)", () => {
    const parent = document.createElement("div");
    const a = document.createElement("span");
    a.textContent = "a";
    const b = document.createElement("span");
    b.textContent = "b";

    const [list, setList] = createSignal([a, b]);
    let dispose;
    createRoot(d => {
      dispose = d;
      r.insert(parent, () => list());
    });
    flush();

    const x = document.createElement("span");
    x.textContent = "x";
    // [a, b] → [a, x, b]: prefix matches a, suffix matches b, append path
    // runs with bStart > 0 → anchor is getNextSibling(b[bStart - 1]).
    setList([a, x, b]);
    flush();
    expect(parent.innerHTML).toBe("<span>a</span><span>x</span><span>b</span>");
    dispose();
  });
});

// applyRef is used by universal spread for the `ref` prop; nested/sparse
// ref arrays go through a flatten + forEach with a truthy guard.
describe("universal applyRef", () => {
  it("invokes a single function ref with the element", () => {
    const el = { tag: "a" };
    let seen;
    r.applyRef(e => (seen = e), el);
    expect(seen).toBe(el);
  });

  it("flattens nested arrays and skips falsy entries", () => {
    const el = { tag: "b" };
    const seen = [];
    r.applyRef([e => seen.push("a"), null, [undefined, e => seen.push("b")], false], el);
    expect(seen).toEqual(["a", "b"]);
  });
});

// spread's update effect removes dropped props and skips unchanged values —
// both branches only run on subsequent invocations of the effect.
describe("universal spread reactive updates", () => {
  it("removes dropped props and skips unchanged values across updates", () => {
    const node = document.createElement("span");

    const [state, setState] = createSignal({ class: "a", id: "first" });
    // Proxy props so for...in reflects whichever keys the signal currently
    // exposes — lets spread observe a key disappearing between renders.
    const props = new Proxy(
      {},
      {
        has: (_t, key) => key in state(),
        get: (_t, key) => state()[key],
        ownKeys: () => Object.keys(state()),
        getOwnPropertyDescriptor: (_t, key) =>
          key in state() ? { enumerable: true, configurable: true, value: state()[key] } : undefined
      }
    );

    let dispose;
    createRoot(d => {
      dispose = d;
      r.spread(node, props);
    });
    flush();
    expect(node.getAttribute("class")).toBe("a");
    expect(node.getAttribute("id")).toBe("first");

    // Drop `id`, keep `class` identical → remove-old branch + equal-value
    // continue branch both fire.
    setState({ class: "a" });
    flush();
    expect(node.hasAttribute("id")).toBe(false);
    expect(node.getAttribute("class")).toBe("a");
    dispose();
  });
});

describe("universal setProp", () => {
  it("delegates to the renderer's setProperty", () => {
    const node = document.createElement("div");
    r.setProp(node, "class", "a", undefined);
    expect(node.getAttribute("class")).toBe("a");
    r.setProp(node, "class", null, "a");
    expect(node.hasAttribute("class")).toBe(false);
  });
});

describe("universal insert caching", () => {
  it("does not re-invoke accessor when inner memo updates", () => {
    let accessorCalls = 0;
    const [count, setCount] = createSignal(0);
    const parent = document.createElement("div");
    const staticNode = document.createElement("span");
    staticNode.textContent = "static";

    createRoot(() => {
      r.insert(parent, () => {
        accessorCalls++;
        return [r.memo(() => count()), staticNode];
      });
    });
    flush();

    expect(accessorCalls).toBe(1);
    expect(parent.innerHTML).toBe("0<span>static</span>");

    setCount(1);
    flush();

    expect(accessorCalls).toBe(1);
    expect(parent.innerHTML).toBe("1<span>static</span>");
  });

  it("still updates when accessor has direct reactive deps", () => {
    const [count, setCount] = createSignal(0);
    const parent = document.createElement("div");

    createRoot(() => {
      r.insert(parent, () => count());
    });
    flush();

    expect(parent.innerHTML).toBe("0");

    setCount(1);
    flush();

    expect(parent.innerHTML).toBe("1");
  });

  it("caches array with inline reactive functions", () => {
    let accessorCalls = 0;
    const [show, setShow] = createSignal(true);
    const parent = document.createElement("div");
    const staticNode = document.createElement("span");
    staticNode.textContent = "static";

    createRoot(() => {
      r.insert(parent, () => {
        accessorCalls++;
        return [() => (show() ? "yes" : "no"), staticNode];
      });
    });
    flush();

    expect(accessorCalls).toBe(1);
    expect(parent.innerHTML).toBe("yes<span>static</span>");

    setShow(false);
    flush();

    expect(accessorCalls).toBe(1);
    expect(parent.innerHTML).toBe("no<span>static</span>");
  });

  it("does not cache when accessor returns flat static content", () => {
    let accessorCalls = 0;
    const [count, setCount] = createSignal(0);
    const parent = document.createElement("div");

    createRoot(() => {
      r.insert(parent, () => {
        accessorCalls++;
        return [count(), "text"];
      });
    });
    flush();

    expect(accessorCalls).toBe(1);
    expect(parent.innerHTML).toBe("0text");

    setCount(1);
    flush();

    expect(accessorCalls).toBe(2);
    expect(parent.innerHTML).toBe("1text");
  });

  it("preserves declaration order for pending multi inserts that resolve later", () => {
    const parent = document.createElement("div");
    const marker = document.createTextNode("");
    const [firstReady, setFirstReady] = createSignal(false);
    const [secondReady, setSecondReady] = createSignal(false);
    parent.appendChild(marker);

    createRoot(() => {
      r.insert(
        parent,
        () => {
          if (!firstReady()) throw new NotReadyError(firstReady);
          return ["A"];
        },
        marker
      );
      r.insert(
        parent,
        () => {
          if (!secondReady()) throw new NotReadyError(secondReady);
          return ["B"];
        },
        marker
      );
    });
    flush();

    setSecondReady(true);
    flush();
    expect(parent.innerHTML).toBe("B");

    setFirstReady(true);
    flush();
    expect(parent.innerHTML).toBe("AB");
  });

  it("uses a host-provided sentinel factory for pending multi inserts", () => {
    const sentinels = [];
    const renderer = createRenderer({
      createElement(string) {
        return document.createElement(string);
      },
      createTextNode(value) {
        return document.createTextNode(value);
      },
      createSentinel() {
        const sentinel = document.createComment("sentinel");
        sentinels.push(sentinel);
        return sentinel;
      },
      replaceText(textNode, value) {
        textNode.data = value;
      },
      setProperty(node, name, value) {
        if (value == null) node.removeAttribute(name);
        else node.setAttribute(name, value);
      },
      insertNode(parent, node, anchor) {
        parent.insertBefore(node, anchor);
      },
      isTextNode(node) {
        return node.nodeType === 3;
      },
      removeNode(parent, node) {
        parent.removeChild(node);
      },
      getParentNode(node) {
        return node.parentNode;
      },
      getFirstChild(node) {
        return node.firstChild;
      },
      getNextSibling(node) {
        return node.nextSibling;
      }
    });
    const parent = document.createElement("div");
    const marker = document.createComment("marker");
    const [ready, setReady] = createSignal(false);
    parent.appendChild(marker);

    createRoot(() => {
      renderer.insert(
        parent,
        () => {
          if (!ready()) throw new NotReadyError(ready);
          return ["A"];
        },
        marker
      );
    });
    flush();

    expect(sentinels).toHaveLength(1);
    expect(parent.firstChild).toBe(sentinels[0]);
    expect(sentinels[0].nextSibling).toBe(marker);

    setReady(true);
    flush();

    expect(parent.innerHTML).toBe("A<!--marker-->");
  });
});

describe("universal render error handling", () => {
  it("disposes the root scope when the init function throws", () => {
    const parent = document.createElement("div");
    const cleanup = vi.fn();
    expect(() =>
      r.render(() => {
        onCleanup(cleanup);
        throw new Error("boom");
      }, parent)
    ).toThrow("boom");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
