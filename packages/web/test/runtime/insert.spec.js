import * as r from "../../src/client.js";
import reconcileArrays from "../../src/reconcile.js";
import { createRoot, createSignal, flush, onCleanup } from "solid-js";

describe("r.insert", () => {
  // <div><!-- insert --></div>
  const container = document.createElement("div");

  it("inserts nothing for null", () => {
    const res = insert(null);
    expect(res.innerHTML).toBe("");
    expect(res.childNodes.length).toBe(0);
  });

  it("inserts html", () => {
    const parent = container.cloneNode(true);
    r.setProperty(parent, "innerHTML", "<div />");
    expect(parent.innerHTML).toBe("<div></div>");
  });

  it("inserts nothing for undefined", () => {
    const res = insert(undefined);
    expect(res.innerHTML).toBe("");
    expect(res.childNodes.length).toBe(0);
  });

  it("inserts nothing for false", () => {
    const res = insert(false);
    expect(res.innerHTML).toBe("");
    expect(res.childNodes.length).toBe(0);
  });

  it("inserts nothing for true", () => {
    const res = insert(true);
    expect(res.innerHTML).toBe("");
    expect(res.childNodes.length).toBe(0);
  });

  it("inserts nothing for null in array", () => {
    const res = insert(["a", null, "b"]);
    expect(res.innerHTML).toBe("ab");
    expect(res.childNodes.length).toBe(2);
  });

  it("inserts nothing for undefined in array", () => {
    const res = insert(["a", undefined, "b"]);
    expect(res.innerHTML).toBe("ab");
    expect(res.childNodes.length).toBe(2);
  });

  it("inserts nothing for false in array", () => {
    const res = insert(["a", false, "b"]);
    expect(res.innerHTML).toBe("ab");
    expect(res.childNodes.length).toBe(2);
  });

  it("inserts nothing for true in array", () => {
    const res = insert(["a", true, "b"]);
    expect(res.innerHTML).toBe("ab");
    expect(res.childNodes.length).toBe(2);
  });

  it("can insert strings", () => {
    const res = insert("foo");
    expect(res.innerHTML).toBe("foo");
    expect(res.childNodes.length).toBe(1);
  });

  it("can insert a node", () => {
    const node = document.createElement("span");
    node.textContent = "foo";
    expect(insert(node).innerHTML).toBe("<span>foo</span>");
  });

  it("can re-insert a node, thereby moving it", () => {
    const node = document.createElement("span");
    node.textContent = "foo";

    const first = insert(node),
      second = insert(node);

    expect(first.innerHTML).toBe("");
    expect(second.innerHTML).toBe("<span>foo</span>");
  });

  it("can spread over element", () => {
    const node = document.createElement("span");
    createRoot(() => {
      r.spread(node, {
        href: "/",
        for: "id",
        class: { danger: true },
        on: { custom: e => e },
        style: { color: "red" },
        notProp: "good"
      });
    });
    expect(node.getAttribute("href")).toBe("/");
    expect(node.getAttribute("for")).toBe("id");
    expect(node.className).toBe("danger");
    expect(node.style.color).toBe("red");
    expect(node.notProp).toBeUndefined();
    expect(node.getAttribute("notprop")).toBe("good");
  });

  it("can insert an array of strings", () => {
    expect(insert(["foo", "bar"]).innerHTML).toBe("foobar", "array of strings");
  });

  it("can insert an array of nodes", () => {
    const nodes = [document.createElement("span"), document.createElement("div")];
    nodes[0].textContent = "foo";
    nodes[1].textContent = "bar";
    expect(insert(nodes).innerHTML).toBe("<span>foo</span><div>bar</div>");
  });

  it("can insert a changing array of nodes", () => {
    let parent = document.createElement("div"),
      current,
      n1 = document.createElement("span"),
      n2 = document.createElement("div"),
      n3 = document.createElement("span"),
      n4 = document.createElement("div"),
      orig = [n1, n2, n3, n4];

    n1.textContent = "1";
    n2.textContent = "2";
    n3.textContent = "3";
    n4.textContent = "4";

    var origExpected = expected(orig);

    // identity
    test([n1, n2, n3, n4]);

    // 1 missing
    test([n2, n3, n4]);
    test([n1, n3, n4]);
    test([n1, n2, n4]);
    test([n1, n2, n3]);

    // 2 missing
    test([n3, n4]);
    test([n2, n4]);
    test([n2, n3]);
    test([n1, n4]);
    test([n1, n3]);
    test([n1, n2]);

    // 3 missing
    test([n1]);
    test([n2]);
    test([n3]);
    test([n4]);

    // all missing
    test([]);

    // swaps
    test([n2, n1, n3, n4]);
    test([n3, n2, n1, n4]);
    test([n4, n2, n3, n1]);

    // rotations
    test([n2, n3, n4, n1]);
    test([n3, n4, n1, n2]);
    test([n4, n1, n2, n3]);

    // reversal
    test([n4, n3, n2, n1]);

    function test(array) {
      r.insert(parent, array, undefined, current);
      expect(parent.innerHTML).toBe(expected(array));
      current = array;
      r.insert(parent, orig, undefined, current);
      expect(parent.innerHTML).toBe(origExpected);
      current = [...orig];
    }

    function expected(array) {
      return array.map(n => n.outerHTML).join("");
    }
  });

  it("can insert nested arrays", () => {
    expect(insert(["foo", ["bar", "blech"]]).innerHTML).toBe(
      "foobarblech",
      "array of array of strings"
    );
  });

  it("can insert and clear strings", () => {
    var parent = document.createElement("div");
    r.insert(parent, "foo");
    expect(parent.innerHTML).toBe("foo");
    expect(parent.childNodes.length).toBe(1);
    r.insert(parent, "", undefined, "foo");
    expect(parent.innerHTML).toBe("");
  });

  function insert(val) {
    const parent = container.cloneNode(true);
    r.insert(parent, val);
    return parent;
  }
});

describe("r.insert with Markers", () => {
  // <div>before<!-- insert -->after</div>
  var container = document.createElement("div");
  container.appendChild(document.createTextNode("before"));
  container.appendChild(document.createTextNode("after"));

  it("inserts nothing for null", () => {
    const res = insert(null);
    expect(res.innerHTML).toBe("beforeafter");
    expect(res.childNodes.length).toBe(3);
  });

  it("inserts nothing for undefined", () => {
    const res = insert(undefined);
    expect(res.innerHTML).toBe("beforeafter");
    expect(res.childNodes.length).toBe(3);
  });

  it("inserts nothing for false", () => {
    const res = insert(false);
    expect(res.innerHTML).toBe("beforeafter");
    expect(res.childNodes.length).toBe(3);
  });

  it("inserts nothing for true", () => {
    const res = insert(true);
    expect(res.innerHTML).toBe("beforeafter");
    expect(res.childNodes.length).toBe(3);
  });

  it("inserts nothing for null in array", () => {
    const res = insert(["a", null, "b"]);
    expect(res.innerHTML).toBe("beforeabafter");
    expect(res.childNodes.length).toBe(4);
  });

  it("inserts nothing for undefined in array", () => {
    const res = insert(["a", undefined, "b"]);
    expect(res.innerHTML).toBe("beforeabafter");
    expect(res.childNodes.length).toBe(4);
  });

  it("inserts nothing for false in array", () => {
    const res = insert(["a", false, "b"]);
    expect(res.innerHTML).toBe("beforeabafter");
    expect(res.childNodes.length).toBe(4);
  });

  it("inserts nothing for true in array", () => {
    const res = insert(["a", true, "b"]);
    expect(res.innerHTML).toBe("beforeabafter");
    expect(res.childNodes.length).toBe(4);
  });

  it("can insert strings", () => {
    const res = insert("foo");
    expect(res.innerHTML).toBe("beforefooafter");
    expect(res.childNodes.length).toBe(3);
  });

  it("can insert a node", () => {
    const node = document.createElement("span");
    node.textContent = "foo";
    expect(insert(node).innerHTML).toBe("before<span>foo</span>after");
  });

  it("can re-insert a node, thereby moving it", () => {
    var node = document.createElement("span");
    node.textContent = "foo";

    const first = insert(node),
      second = insert(node);

    expect(first.innerHTML).toBe("beforeafter");
    expect(second.innerHTML).toBe("before<span>foo</span>after");
  });

  it("can insert an array of strings", () => {
    expect(insert(["foo", "bar"]).innerHTML).toBe("beforefoobarafter", "array of strings");
  });

  it("can insert an array of nodes", () => {
    const nodes = [document.createElement("span"), document.createElement("div")];
    nodes[0].textContent = "foo";
    nodes[1].textContent = "bar";
    expect(insert(nodes).innerHTML).toBe("before<span>foo</span><div>bar</div>after");
  });

  it("can insert a changing array of nodes", () => {
    let container = document.createElement("div"),
      marker = container.appendChild(document.createTextNode("")),
      span1 = document.createElement("span"),
      div2 = document.createElement("div"),
      span3 = document.createElement("span"),
      temp,
      current;
    span1.textContent = "1";
    div2.textContent = "2";
    span3.textContent = "3";

    r.insert(container, (temp = []), marker, current);
    expect(container.innerHTML).toBe("");
    current = temp;

    r.insert(container, (temp = [span1, div2, span3]), marker, current);
    expect(container.innerHTML).toBe("<span>1</span><div>2</div><span>3</span>");
    current = temp;

    r.insert(container, (temp = [div2, span3]), marker, current);
    expect(container.innerHTML).toBe("<div>2</div><span>3</span>");
    current = temp;

    r.insert(container, (temp = [div2, span3]), marker, current);
    expect(container.innerHTML).toBe("<div>2</div><span>3</span>");
    current = temp;

    r.insert(container, (temp = [span3, div2]), marker, current);
    expect(container.innerHTML).toBe("<span>3</span><div>2</div>");
    current = temp;

    r.insert(container, (temp = []), marker, current);
    expect(container.innerHTML).toBe("");
    current = temp;

    r.insert(container, (temp = [span3]), marker, current);
    expect(container.innerHTML).toBe("<span>3</span>");
    current = temp;

    r.insert(container, (temp = [div2]), marker, current);
    expect(container.innerHTML).toBe("<div>2</div>");
    current = temp;
  });

  it("can insert nested arrays", () => {
    expect(insert(["foo", ["bar", "blech"]]).innerHTML).toBe(
      "beforefoobarblechafter",
      "array of array of strings"
    );
  });

  it("can insert and clear strings with marker", () => {
    var parent = document.createElement("div");
    parent.innerHTML = " bar";
    var marker = parent.firstChild;
    r.insert(parent, "foo", marker);
    expect(parent.innerHTML).toBe("foo bar");
    expect(parent.childNodes.length).toBe(2);
    r.insert(parent, "", marker, [parent.childNodes[0]]);
    expect(parent.innerHTML).toBe(" bar");
  });

  it("can insert and clear strings with null marker", () => {
    var parent = document.createElement("div");
    parent.innerHTML = "hello ";
    r.insert(parent, "foo", null);
    expect(parent.innerHTML).toBe("hello foo");
    expect(parent.childNodes.length).toBe(2);
    r.insert(parent, "", null, [parent.childNodes[1]]);
    expect(parent.innerHTML).toBe("hello ");
  });

  function insert(val) {
    const parent = container.cloneNode(true);
    r.insert(parent, val, parent.childNodes[1]);
    return parent;
  }
});

describe("r.insert edge cases", () => {
  // insertExpression: value has nodeType, current is not an array and
  // childRoot.firstChild exists → hit the replaceChild branch.
  it("replaces existing firstChild with a DOM node", () => {
    const parent = document.createElement("div");
    parent.appendChild(document.createTextNode("old"));
    const span = document.createElement("span");
    span.textContent = "new";

    r.insert(parent, span, undefined, "old");
    expect(parent.innerHTML).toBe("<span>new</span>");
  });

  // insertExpression: value has nodeType, current is an array → routes
  // through cleanChildren with the marker branch.
  it("replaces an array-current with a single node via cleanChildren", () => {
    const parent = document.createElement("div");
    const marker = document.createTextNode("");
    const existing = document.createTextNode("p1");
    parent.appendChild(existing);
    parent.appendChild(marker);

    const span = document.createElement("span");
    span.textContent = "x";
    r.insert(parent, span, marker, [existing]);
    expect(parent.innerHTML).toBe("<span>x</span>");
  });

  // cleanChildren: replacement matches a member of current → sets the
  // `inserted` flag so the remainder of the pass only removes siblings.
  it("keeps replacement node in place when it is already part of current", () => {
    const parent = document.createElement("div");
    const marker = document.createTextNode("");
    const n1 = document.createElement("span");
    n1.textContent = "1";
    const n2 = document.createElement("span");
    n2.textContent = "2";
    parent.appendChild(n1);
    parent.appendChild(n2);
    parent.appendChild(marker);

    // Move from [n1, n2] to just n2 (reused, so hits the `inserted = true`
    // branch). The other element should be removed.
    r.insert(parent, n2, marker, [n1, n2]);
    expect(parent.childNodes.length).toBe(2);
    expect(parent.firstChild).toBe(n2);
  });

  // insertExpression dev warning for unrecognized value types.
  it("warns for unrecognized value shapes in DEV", () => {
    const parent = document.createElement("div");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    r.insert(parent, { unknown: true });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// insertExpression takes the nodeType/Array.isArray(current) branch only
// when the accessor is passed without a marker — normalize only wraps in
// an array when multi=true, so these cases need marker=undefined.
describe("r.insert with no marker + array current", () => {
  it("replaces array-current with a single node via cleanChildren", () => {
    const parent = document.createElement("div");
    const old = document.createTextNode("old");
    parent.appendChild(old);

    const span = document.createElement("span");
    span.textContent = "new";
    r.insert(parent, span, undefined, [old]);
    expect(parent.childNodes.length).toBe(1);
    expect(parent.firstChild).toBe(span);
  });

  it("keeps replacement already present in array-current and drops the rest", () => {
    const parent = document.createElement("div");
    const a = document.createElement("a");
    const b = document.createElement("b");
    parent.appendChild(a);
    parent.appendChild(b);

    // b is a member of current [a, b] → hits `inserted = true` at i=1;
    // a is removed at i=0 since `inserted` is already true.
    r.insert(parent, b, undefined, [a, b]);
    expect(parent.childNodes.length).toBe(1);
    expect(parent.firstChild).toBe(b);
  });

  it("appends replacement when the current element is detached from parent", () => {
    const parent = document.createElement("div");
    const detached = document.createElement("p"); // never attached
    const span = document.createElement("span");
    span.textContent = "x";

    // cleanChildren hits isParent=false → insertBefore(span, null) appends.
    r.insert(parent, span, undefined, [detached]);
    expect(parent.childNodes.length).toBe(1);
    expect(parent.firstChild).toBe(span);
  });

  it("replaces array-current whose element is a child via replaceChild", () => {
    const parent = document.createElement("div");
    const child = document.createElement("p");
    parent.appendChild(child);
    const span = document.createElement("span");

    // isParent=true at i=0 → replaceChild(span, child).
    r.insert(parent, span, undefined, [child]);
    expect(parent.childNodes.length).toBe(1);
    expect(parent.firstChild).toBe(span);
  });
});

describe("r.render error handling", () => {
  it("throws when element argument is missing", () => {
    expect(() => r.render(() => document.createElement("div"), null)).toThrow(
      /element.*doesn't exist/i
    );
  });

  it("disposes the root scope when the init function throws", () => {
    const container = document.createElement("div");
    const cleanup = vi.fn();
    expect(() =>
      r.render(() => {
        onCleanup(cleanup);
        throw new Error("boom");
      }, container)
    ).toThrow("boom");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("unregisters the delegated root when init throws", () => {
    const container = document.createElement("div");
    expect(() =>
      r.render(() => {
        throw new Error("boom");
      }, container)
    ).toThrow("boom");
    expect(r.getDelegatedRoot(container)).toBeUndefined();
  });

  it("does not wipe pre-existing element content on failed init", () => {
    const container = document.createElement("div");
    container.innerHTML = "<span>fallback</span>";
    expect(() =>
      r.render(() => {
        throw new Error("boom");
      }, container)
    ).toThrow("boom");
    expect(container.innerHTML).toBe("<span>fallback</span>");
  });
});

describe("r.insert caching", () => {
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
});

describe("r.insert with migrating nodes", () => {
  // Coverage for nodes that have been moved out of the slot they were
  // inserted into — by user code, by JSX wrapping, or by an adjacent slot
  // claiming them — before the next render. The runtime must not throw
  // and must not destroy the migrated node when cleaning up the source
  // slot. Tests drive the reactive path (createSignal + createRoot) so the
  // `current` array is threaded through the insert effect and migration
  // branches in `cleanChildren` / `reconcileArrays` are actually exercised.

  it("does not throw when a new value wraps the current node (#2030 v1)", () => {
    // Slot A holds `stage`. Slot B's new value is a wrapper containing `stage`.
    // JSX construction migrates stage into wrapper before the insert effect
    // runs, so by the time insertExpression sees value=wrapper and
    // current=stage, stage has been moved away. The replaceChild on stale
    // firstChild used to throw "new child contains the parent".
    const stage = document.createElement("div");
    stage.textContent = "stage";
    const parent = document.createElement("div");
    const marker = parent.appendChild(document.createTextNode(""));

    let current = r.insert(parent, stage, marker);
    flush();
    expect(parent.querySelector("div")).toBe(stage);

    // Simulate: wrapper is constructed with stage as a child (JSX appendChild)
    const wrapper = document.createElement("section");
    wrapper.appendChild(stage); // migrates stage out of parent into wrapper

    expect(() => {
      current = r.insert(parent, wrapper, marker, current);
      flush();
    }).not.toThrow();
    expect(parent.querySelector("section")).toBe(wrapper);
    expect(wrapper.querySelector("div")).toBe(stage);
  });

  it("does not destroy a node when its source slot clears after migration (#2030 v2)", () => {
    // Two slots in the same parent. Slot B claims the node first, then slot
    // A re-renders with `null`. The reconcile in slot A must NOT yank the
    // node from slot B — it should leave it alone and only replace its own
    // marker-anchored content.
    const node = document.createElement("div");
    node.textContent = "alive";
    const parent = document.createElement("div");
    const markerA = parent.appendChild(document.createTextNode(""));
    const markerB = parent.appendChild(document.createTextNode(""));

    const [aVal, setAVal] = createSignal(node);
    const [bVal, setBVal] = createSignal(null);

    createRoot(() => {
      r.insert(parent, aVal, markerA);
      r.insert(parent, bVal, markerB);
    });
    flush();
    expect(parent.contains(node)).toBe(true);

    // B claims node first, A clears second — A's reconcile sees `current=[node]`
    // but node has already migrated to slot B's region.
    setBVal(node);
    setAVal(null);
    flush();

    expect(parent.contains(node)).toBe(true);
    expect(parent.querySelector("div")).toBe(node);
  });

  it("leaves foreign sibling nodes alone during cleanup", () => {
    // A node the runtime never inserted (e.g. user-appended via ref) should
    // not be removed when an adjacent slot cleans up.
    const slotNode = document.createElement("span");
    slotNode.textContent = "slot";
    const foreign = document.createElement("b");
    foreign.textContent = "foreign";
    const parent = document.createElement("div");
    const marker = parent.appendChild(document.createTextNode(""));

    const [val, setVal] = createSignal(slotNode);
    createRoot(() => {
      r.insert(parent, val, marker);
    });
    flush();
    parent.appendChild(foreign);
    expect(parent.contains(foreign)).toBe(true);

    setVal(null);
    flush();
    expect(parent.contains(foreign)).toBe(true);
    expect(parent.contains(slotNode)).toBe(false);
  });

  it("cleans up a fragment when one node has been migrated out", () => {
    const n1 = document.createElement("span");
    n1.textContent = "1";
    const n2 = document.createElement("span");
    n2.textContent = "2";
    const n3 = document.createElement("span");
    n3.textContent = "3";
    const parent = document.createElement("div");
    const marker = parent.appendChild(document.createTextNode(""));

    const [val, setVal] = createSignal([n1, n2, n3]);
    createRoot(() => {
      r.insert(parent, val, marker);
    });
    flush();
    expect(parent.querySelectorAll("span").length).toBe(3);

    // External code yanks n2 out and stashes it somewhere else.
    const other = document.createElement("div");
    other.appendChild(n2);

    // Slot clears. n1 and n3 should be removed; n2 must remain in `other`.
    setVal(null);
    flush();
    expect(parent.contains(n1)).toBe(false);
    expect(parent.contains(n3)).toBe(false);
    expect(other.contains(n2)).toBe(true);
  });

  // The tests above exercise the `cleanChildren` path (single-clear).
  // The tests below drive `reconcileArrays` migration branches.

  it("reconcileArrays keeps a node that replace + end-swap left detached (#574)", () => {
    // A B C D E → B A E C D. After two map-fallback replaces, C is out of
    // the DOM but still in a[]. The single-anchor swap then moves E; the
    // suffix walk used to treat detached C as a live common end and skip
    // the insert.
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
    const a = [A, B, C, D, E];
    const b = [B, A, E, C, D];
    a.forEach(n => parent.appendChild(n));
    reconcileArrays(parent, a, b);
    expect([...parent.children].map(n => n.textContent).join(",")).toBe("i3,i1,i5,i4,i1");
    expect(parent.contains(C)).toBe(true);
  });

  it("reconcile keeps a migrated node alive when its array drops it", () => {
    // Insert [n1, n2, n3]; user code migrates n2 to another parent; then
    // reconcile from [n1, n2, n3] to [n1, n3]. The remove-branch and
    // map-fallback paths in reconcileArrays must skip n2 (it no longer
    // belongs to this parent).
    const n1 = document.createElement("span");
    const n2 = document.createElement("span");
    const n3 = document.createElement("span");
    n1.textContent = "1";
    n2.textContent = "2";
    n3.textContent = "3";
    const parent = document.createElement("div");
    const other = document.createElement("div");
    const marker = parent.appendChild(document.createTextNode(""));

    const [val, setVal] = createSignal([n1, n2, n3]);
    createRoot(() => {
      r.insert(parent, val, marker);
    });
    flush();
    expect(parent.querySelectorAll("span").length).toBe(3);

    other.appendChild(n2);
    expect(other.contains(n2)).toBe(true);
    expect(parent.contains(n2)).toBe(false);

    setVal([n1, n3]);
    flush();
    expect(parent.contains(n1)).toBe(true);
    expect(parent.contains(n3)).toBe(true);
    expect(other.contains(n2)).toBe(true);
  });

  it("reconcile uses marker as after-anchor when tail has migrated", () => {
    // Insert [n1, n2, n3]; migrate n3 (the tail) elsewhere; then reconcile
    // by appending newNode at the tail position. The opening
    // `after = tail.parentNode === parentNode ? tail.nextSibling : marker`
    // fallback is what makes this safe — otherwise we'd read a sibling
    // pointer into the foreign parent's region.
    const n1 = document.createElement("span");
    const n2 = document.createElement("span");
    const n3 = document.createElement("span");
    n1.textContent = "1";
    n2.textContent = "2";
    n3.textContent = "3";
    const parent = document.createElement("div");
    const other = document.createElement("div");
    const marker = parent.appendChild(document.createTextNode(""));
    const trailing = parent.appendChild(document.createElement("i"));
    trailing.textContent = "trailing";

    const [val, setVal] = createSignal([n1, n2, n3]);
    createRoot(() => {
      r.insert(parent, val, marker);
    });
    flush();

    other.appendChild(n3);
    expect(other.contains(n3)).toBe(true);

    const newNode = document.createElement("span");
    newNode.textContent = "new";
    setVal([n1, n2, newNode]);
    flush();

    expect(parent.contains(n1)).toBe(true);
    expect(parent.contains(n2)).toBe(true);
    expect(parent.contains(newNode)).toBe(true);
    expect(other.contains(n3)).toBe(true);
    // newNode must be inserted before the slot's marker, leaving the
    // post-marker trailing sibling intact.
    expect(newNode.nextSibling).toBe(marker);
    expect(parent.lastChild).toBe(trailing);
  });

  it("toggles a single node between two `Show`-style slots in different parents (#2357)", () => {
    // Canonical solidjs/solid#2357 shape: one DOM element referenced as the
    // JSX child of two `<Show>`s in different parents, toggled by a single
    // signal. Each toggle is one reactive flush in which both effects react;
    // their order in the queue is what the slot-ownership tag protects
    // against (clear-then-claim vs claim-then-clear must both leave the
    // element in exactly one parent).
    const node = document.createElement("div");
    node.textContent = "shared";
    const parentA = document.createElement("div");
    const parentB = document.createElement("div");
    const markerA = parentA.appendChild(document.createTextNode(""));
    const markerB = parentB.appendChild(document.createTextNode(""));

    const [mode, setMode] = createSignal("foo");

    createRoot(() => {
      r.insert(parentA, () => (mode() === "foo" ? node : null), markerA);
      r.insert(parentB, () => (mode() === "bar" ? node : null), markerB);
    });
    flush();
    expect(parentA.contains(node)).toBe(true);
    expect(parentB.contains(node)).toBe(false);

    setMode("bar");
    flush();
    expect(parentA.contains(node)).toBe(false);
    expect(parentB.contains(node)).toBe(true);

    setMode("foo");
    flush();
    expect(parentA.contains(node)).toBe(true);
    expect(parentB.contains(node)).toBe(false);

    setMode("bar");
    flush();
    expect(parentA.contains(node)).toBe(false);
    expect(parentB.contains(node)).toBe(true);

    // Final invariant: the node must exist in exactly one place at all times,
    // never duplicated, never destroyed by the slot it migrated away from.
    setMode("foo");
    flush();
    expect(parentA.contains(node)).toBe(true);
    expect(parentB.contains(node)).toBe(false);
    expect(node.isConnected || parentA.contains(node)).toBe(true);
  });

  it("preserves element identity and state across migration", () => {
    // The whole point of allowing migration in the first place: the same JS
    // object reference reaches the destination slot, so anything stored on
    // that reference (properties, event listeners, internal element state
    // like <video>.currentTime, <canvas> bitmap, attached widget instances)
    // comes along. This test asserts identity + arbitrary-property survival;
    // real-browser tests can validate media/canvas state continuity but jsdom
    // doesn't simulate playback.
    const video = document.createElement("video");
    video.src = "test.mp4";
    video.currentTime = 12.5;
    // Stand-in for any state a third-party widget or framework might attach:
    video._attached = { keepAlive: true, frame: 42 };
    let blurredOnce = false;
    video.addEventListener("blur", () => {
      blurredOnce = true;
    });

    const parentA = document.createElement("div");
    const parentB = document.createElement("div");
    const markerA = parentA.appendChild(document.createTextNode(""));
    const markerB = parentB.appendChild(document.createTextNode(""));

    const [mode, setMode] = createSignal("a");
    createRoot(() => {
      r.insert(parentA, () => (mode() === "a" ? video : null), markerA);
      r.insert(parentB, () => (mode() === "b" ? video : null), markerB);
    });
    flush();

    setMode("b");
    flush();
    setMode("a");
    flush();
    setMode("b");
    flush();

    // After three migrations the SAME element object must be the one in B.
    const found = parentB.querySelector("video");
    expect(found).toBe(video);
    // Properties set on the JS reference survive.
    expect(found.src.endsWith("test.mp4")).toBe(true);
    expect(found.currentTime).toBe(12.5);
    expect(found._attached).toEqual({ keepAlive: true, frame: 42 });
    // Event listeners survive (registered once, still firing).
    found.dispatchEvent(new Event("blur"));
    expect(blurredOnce).toBe(true);
  });

  it("reconcile swap-backward gate falls through safely when head migrated", () => {
    // Reorder [n1, n2, n3] -> [n3, n2]. n1 was migrated to another parent
    // before the reconcile and is not in the new list. The symmetric
    // end-swap detector would normally fire on the prefix/suffix pattern
    // here; the anchor-ownership gate must redirect to the map branch so
    // that the destructive `insertBefore(_, n1)` against a foreign anchor
    // never runs. n1 must remain in `other`, untouched.
    const n1 = document.createElement("span");
    const n2 = document.createElement("span");
    const n3 = document.createElement("span");
    n1.textContent = "1";
    n2.textContent = "2";
    n3.textContent = "3";
    const parent = document.createElement("div");
    const other = document.createElement("div");
    const marker = parent.appendChild(document.createTextNode(""));

    const [val, setVal] = createSignal([n1, n2, n3]);
    createRoot(() => {
      r.insert(parent, val, marker);
    });
    flush();

    other.appendChild(n1);
    expect(other.contains(n1)).toBe(true);

    expect(() => {
      setVal([n3, n2]);
      flush();
    }).not.toThrow();

    expect(other.contains(n1)).toBe(true);
    expect(parent.contains(n2)).toBe(true);
    expect(parent.contains(n3)).toBe(true);
    expect(parent.querySelectorAll("span").length).toBe(2);
  });
});

describe("r.insert with host option", () => {
  // The `host` option is how portals route event retargeting back to their
  // logical position in the source tree: every top-level node the slot
  // manages gets a live `_$host` getter backed by the provided accessor.
  // Crucially the mount parent is a REAL element (no proxy wrapper), so the
  // slot-ownership checks in cleanChildren/reconcileArrays behave normally —
  // these tests cover the runtime side of solidjs/solid#2757 and #2758.

  it("tags top-level nodes (including created text nodes) with a live _$host getter", () => {
    const mount = document.createElement("div");
    const marker = mount.appendChild(document.createTextNode(""));
    let hostEl = document.createElement("section");
    const host = () => hostEl;

    const span = document.createElement("span");
    span.textContent = "content";
    const [val, setVal] = createSignal([span, "text"]);
    createRoot(() => {
      r.insert(mount, val, marker, undefined, { host });
    });
    flush();

    expect(span._$host).toBe(hostEl);
    // strings are normalized into text nodes — they must be tagged too
    const textNode = span.nextSibling;
    expect(textNode.nodeType).toBe(3);
    expect(textNode._$host).toBe(hostEl);

    // the getter is live: when the logical host moves, _$host follows
    const newHost = document.createElement("article");
    hostEl = newHost;
    expect(span._$host).toBe(newHost);

    setVal([span, "text"]);
    flush();
    expect(span._$host).toBe(newHost);
  });

  it("tags nodes on the static (non-reactive) insert path", () => {
    // Portal with non-reactive children resolves to a plain array and takes
    // insert's early-return path — no effect is created, but tagging must
    // still happen.
    const mount = document.createElement("div");
    const marker = mount.appendChild(document.createTextNode(""));
    const hostEl = document.createElement("section");

    const span = document.createElement("span");
    span.textContent = "static";
    r.insert(mount, [span, "text"], marker, undefined, { host: () => hostEl });

    expect(span._$host).toBe(hostEl);
    expect(span.nextSibling.nodeType).toBe(3);
    expect(span.nextSibling._$host).toBe(hostEl);
  });

  it("tags nodes inserted through the replaceChild path", () => {
    const mount = document.createElement("div");
    const marker = mount.appendChild(document.createTextNode(""));
    const hostEl = document.createElement("section");

    const startMarker = document.createTextNode("");
    const a = document.createElement("span");
    a.textContent = "a";
    const b = document.createElement("span");
    b.textContent = "b";

    const [val, setVal] = createSignal([startMarker, a]);
    createRoot(() => {
      r.insert(mount, val, marker, undefined, { host: () => hostEl });
    });
    flush();
    expect(a._$host).toBe(hostEl);

    // single-position swap drives reconcile's replaceChild branch — the
    // path the old proxy-based tagging never covered
    setVal([startMarker, b]);
    flush();
    expect(mount.contains(a)).toBe(false);
    expect(mount.contains(b)).toBe(true);
    expect(b._$host).toBe(hostEl);
  });

  it("portal-style keyed swaps replace content instead of accumulating (#2757)", () => {
    const mount = document.createElement("div");
    const marker = mount.appendChild(document.createTextNode(""));
    const hostEl = document.createElement("section");
    const startMarker = document.createTextNode("");

    const makeBranch = key => {
      const el = document.createElement("span");
      el.textContent = `content for key ${key}`;
      return el;
    };

    const [key, setKey] = createSignal(0);
    createRoot(() => {
      r.insert(mount, () => [startMarker, makeBranch(key())], marker, undefined, {
        host: () => hostEl
      });
    });
    flush();
    expect(mount.querySelectorAll("span").length).toBe(1);

    for (let i = 1; i <= 3; i++) {
      setKey(i);
      flush();
      expect(mount.querySelectorAll("span").length).toBe(1);
      expect(mount.querySelector("span").textContent).toBe(`content for key ${i}`);
    }
  });

  it("clears content fully when the slot empties", () => {
    const mount = document.createElement("div");
    const marker = mount.appendChild(document.createTextNode(""));
    const hostEl = document.createElement("section");

    const [val, setVal] = createSignal(["a", "b", "c"]);
    createRoot(() => {
      r.insert(mount, val, marker, undefined, { host: () => hostEl });
    });
    flush();
    expect(mount.textContent).toBe("abc");

    setVal([]);
    flush();
    expect(mount.textContent).toBe("");
  });

  it("keeps two host slots on the same mount isolated", () => {
    const mount = document.createElement("div");
    const markerA = mount.appendChild(document.createTextNode(""));
    const markerB = mount.appendChild(document.createTextNode(""));
    const hostA = document.createElement("section");
    const hostB = document.createElement("aside");

    const a1 = document.createElement("span");
    a1.textContent = "a1";
    const a2 = document.createElement("span");
    a2.textContent = "a2";
    const b1 = document.createElement("b");
    b1.textContent = "b1";

    const [aVal, setAVal] = createSignal([a1]);
    const [bVal] = createSignal([b1]);
    createRoot(() => {
      r.insert(mount, aVal, markerA, undefined, { host: () => hostA });
      r.insert(mount, bVal, markerB, undefined, { host: () => hostB });
    });
    flush();
    expect(a1._$host).toBe(hostA);
    expect(b1._$host).toBe(hostB);

    // swapping slot A must not disturb slot B's content or tagging
    setAVal([a2]);
    flush();
    expect(mount.contains(a1)).toBe(false);
    expect(mount.contains(a2)).toBe(true);
    expect(mount.contains(b1)).toBe(true);
    expect(a2._$host).toBe(hostA);
    expect(b1._$host).toBe(hostB);
  });

  it("does not tag nodes when no host option is given", () => {
    const mount = document.createElement("div");
    const marker = mount.appendChild(document.createTextNode(""));
    const span = document.createElement("span");

    const [val] = createSignal([span]);
    createRoot(() => {
      r.insert(mount, val, marker);
    });
    flush();
    expect(span._$host).toBeUndefined();
  });
});
