/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #3997: the node holding focus keeps its connection to the document when the
// runtime moves it and the browser has `moveBefore()`, so focus survives.
// Every other node keeps plain `insertBefore()`. jsdom has no `moveBefore()`;
// the mock below throws where browsers do (a node or parent outside the
// document), keeps focus as browsers do, and records each node it moves.
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
    const active = document.activeElement as HTMLElement | null;
    insertBefore.call(this, node, ref);
    if (active && node.contains(active)) active.focus();
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
    el.tabIndex = 0;
    parent.appendChild(el);
    return el;
  });
}

let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

test("a reorder moves the focused node with moveBefore and never detaches it", () => {
  for (let it = 0; it < 500; it++) {
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
    const kept = b.filter(n => a.includes(n));
    const focused = kept.length ? kept[Math.floor(rnd() * kept.length)] : undefined;
    focused?.focus();
    moved = [];
    detached = [];
    reconcileArrays(parent, a, b, marker);
    expect([...parent.childNodes]).toEqual(marker ? [before, ...b, marker] : [before, ...b]);
    expect(moved.every(n => n === focused)).toBe(true);
    if (focused) {
      expect(detached).not.toContain(focused);
      expect(document.activeElement).toBe(focused);
    }
    parent.remove();
  }
});

test("a focused row moving to the end stays connected (the replaceChild path)", () => {
  const parent = document.body.appendChild(document.createElement("div"));
  const a = rows(parent, 5);
  a[0].focus();
  moved = [];
  detached = [];
  reconcileArrays(parent, a, [...a.slice(1), a[0]]);
  expect([...parent.childNodes]).toEqual([...a.slice(1), a[0]]);
  expect(detached).not.toContain(a[0]);
  expect(moved).toContain(a[0]);
  expect(document.activeElement).toBe(a[0]);
  parent.remove();
});

test("with nothing focused in the list, moves take plain insertBefore", () => {
  const button = document.body.appendChild(document.createElement("button"));
  button.focus();
  const parent = document.body.appendChild(document.createElement("div"));
  const a = rows(parent, 5);
  reconcileArrays(parent, a, [...a].reverse());
  reconcileArrays(parent, [...a].reverse(), [...a.slice(1), a[0]]);
  expect([...parent.childNodes]).toEqual([...a.slice(1), a[0]]);
  expect(moved).toEqual([]);
  parent.remove();
  button.remove();
});

test("takes insertBefore where moveBefore would throw", () => {
  // A detached parent: moveBefore() throws, insertBefore() works.
  const parent = document.createElement("div");
  const a = rows(document.body, 3);
  a[0].focus();
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
  a[0].focus();
  const b = [...a.slice(1), a[0]];
  reconcileArrays(parent, a, b);
  expect([...parent.childNodes]).toEqual(b);
  expect(detached).toContain(a[0]);
  parent.remove();
});

test("a focused <For> row reordered or moved between lists keeps its connection", () => {
  const [left, setLeft] = createSignal([1, 2, 3]);
  const [right, setRight] = createSignal<number[]>([]);
  const els = new Map<number, HTMLElement>();
  const el = (n: number) => {
    if (!els.has(n)) {
      const e = document.createElement("li");
      e.textContent = "" + n;
      e.tabIndex = 0;
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
  el(1).focus();
  moved = [];
  detached = [];
  setLeft([2, 3, 1]);
  flush();
  expect(root.textContent).toBe("231");
  expect(detached).not.toContain(el(1));
  expect(moved).toContain(el(1));
  // The list it lands in updates first, so the row is still in the document.
  moved = [];
  setRight([1]);
  setLeft([2, 3]);
  flush();
  expect(root.textContent).toBe("123");
  expect(moved).toEqual([el(1)]);
  expect(document.activeElement).toBe(el(1));
  dispose();
  root.remove();
});
