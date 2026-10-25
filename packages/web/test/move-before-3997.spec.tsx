/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #3997: a node the runtime moves keeps its connection to the document when
// the browser has `moveBefore()`, so focus, animations and iframes survive.
// jsdom has no `moveBefore()`; the mock below throws where browsers do (a
// node or parent outside the document) and records each node it moves.
import { afterEach, beforeEach, expect, test } from "vitest";
import { createSignal, flush, For } from "solid-js";
import { render } from "../src/index.js";
import reconcileArrays from "../src/reconcile.js";

const proto = Node.prototype as any;
const { insertBefore, replaceChild, removeChild } = proto;
const remove = Element.prototype.remove;
let moved: Node[];
let detached: Node[];

function install() {
  moved = [];
  detached = [];
  proto.moveBefore = function (node: Node, ref: Node | null) {
    if (!node.isConnected || !this.isConnected || node.ownerDocument !== this.ownerDocument)
      throw new DOMException("", "HierarchyRequestError");
    moved.push(node);
    return insertBefore.call(this, node, ref);
  };
  // Any other way a connected node leaves its place detaches it first.
  proto.insertBefore = function (node: Node, ref: Node | null) {
    if (node.isConnected) detached.push(node);
    return insertBefore.call(this, node, ref);
  };
  proto.replaceChild = function (node: Node, old: Node) {
    detached.push(old);
    if (node.isConnected) detached.push(node);
    return replaceChild.call(this, node, old);
  };
  proto.removeChild = function (node: Node) {
    detached.push(node);
    return removeChild.call(this, node);
  };
  Element.prototype.remove = function () {
    detached.push(this);
    return remove.call(this);
  };
}

function uninstall() {
  delete proto.moveBefore;
  Object.assign(proto, { insertBefore, replaceChild, removeChild });
  Element.prototype.remove = remove;
}

beforeEach(install);
afterEach(uninstall);

function rows(parent: Node, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const el = document.createElement("i");
    el.id = "n" + i;
    parent.appendChild(el);
    return el;
  });
}

let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

test("reorders move kept nodes with moveBefore and never detach them", () => {
  for (let it = 0; it < 3000; it++) {
    const useMarker = it % 2 === 1;
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const before = parent.appendChild(document.createElement("p"));
    const pool = rows(document.createElement("div"), Math.floor(rnd() * 12) + 6);
    const a = pool.slice(0, pool.length - 6);
    for (const n of a) insertBefore.call(parent, n, null);
    const marker = useMarker ? parent.appendChild(document.createTextNode("")) : undefined;
    const b = pool.filter(() => rnd() < 0.7);
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    detached = [];
    reconcileArrays(parent, a, b, marker);
    expect([...parent.childNodes]).toEqual(marker ? [before, ...b, marker] : [before, ...b]);
    expect(detached.filter(n => b.includes(n as HTMLElement))).toEqual([]);
    parent.remove();
  }
});

test("moving a row to the end keeps it connected (the replaceChild path)", () => {
  const parent = document.body.appendChild(document.createElement("div"));
  const a = rows(parent, 5);
  moved = [];
  detached = [];
  reconcileArrays(parent, a, [...a.slice(1), a[0]]);
  expect([...parent.childNodes]).toEqual([...a.slice(1), a[0]]);
  expect(detached).toEqual([]);
  expect(moved).toContain(a[0]);
  parent.remove();
});

test("falls back to insertBefore where moveBefore throws", () => {
  // A detached parent: moveBefore() throws, insertBefore() works.
  const parent = document.createElement("div");
  const a = rows(document.body, 3);
  reconcileArrays(parent, [], a);
  expect([...parent.childNodes]).toEqual(a);
  expect(moved).toEqual([]);
  // New nodes never try moveBefore().
  const live = document.body.appendChild(document.createElement("div"));
  const fresh = rows(document.createElement("div"), 3).map(n => (n.remove(), n));
  reconcileArrays(live, [], fresh);
  expect([...live.childNodes]).toEqual(fresh);
  expect(moved).toEqual([]);
  live.remove();
});

test("without moveBefore the reconcile behaves as before", () => {
  delete proto.moveBefore;
  const parent = document.body.appendChild(document.createElement("div"));
  const a = rows(parent, 5);
  const b = [...a.slice(1), a[0]];
  reconcileArrays(parent, a, b);
  expect([...parent.childNodes]).toEqual(b);
  expect(detached).toContain(a[0]);
  parent.remove();
});

test("a <For> row reordered or moved between lists keeps its connection", () => {
  const [left, setLeft] = createSignal([1, 2, 3]);
  const [right, setRight] = createSignal<number[]>([]);
  const els = new Map<number, HTMLElement>();
  const el = (n: number) => {
    if (!els.has(n)) {
      const e = document.createElement("li");
      e.textContent = "" + n;
      els.set(n, e);
    }
    return els.get(n)!;
  };
  const root = document.body.appendChild(document.createElement("div"));
  const dispose = render(
    () => (
      <>
        <ul>
          <For each={right()}>{n => el(n)}</For>
        </ul>
        <ul>
          <For each={left()}>{n => el(n)}</For>
        </ul>
      </>
    ),
    root
  );
  flush();
  expect(root.textContent).toBe("123");
  moved = [];
  detached = [];
  setLeft([2, 3, 1]);
  flush();
  expect(root.textContent).toBe("231");
  expect(detached).toEqual([]);
  expect(moved).toContain(el(1));
  // The list it lands in updates first, so the row is still in the document.
  moved = [];
  setRight([1]);
  setLeft([2, 3]);
  flush();
  expect(root.textContent).toBe("123");
  expect(moved).toEqual([el(1)]);
  dispose();
  root.remove();
});
