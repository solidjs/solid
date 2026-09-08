/** @jsxImportSource @solidjs/web */
/**
 * Unified For ENGINE — every For mode, with mapArray + insert as the live
 * oracle (no <For> on the oracle side: every <For> engages the engine on web).
 *
 *   identity + index accessor   (item, i) => …  with i()   [arity 2]
 *   keyed={false}               (item, i) => …  item() accessor, i a number
 *   keyed={fn}                  (item, i) => …  item() accessor, i() accessor
 *   fallback                    empty-state row, owned like a row
 *
 * Each mode: DOM equality with the oracle after every step of a cumulative
 * sequence, node identity where the mode promises it, signal updates where
 * the mode promises them, and row-fn invocation counts equal on both sides.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { createSignal, flush, For, DEV, Show } from "solid-js";
import { referenceMapArray as refMapArray } from "./reference/mapArray.js";
const mapArray: (...a: any[]) => any = refMapArray as any;
import { render } from "@solidjs/web";

const stats = () => DEV!.unifiedFor;

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
beforeEach(() => {
  dispose?.();
  dispose = undefined;
  container = document.createElement("div");
});

type Item = { id: string; name: string };
const mk = (id: string, name = id.toUpperCase()): Item => ({ id, name });

/** Mount engine + oracle side by side off one signal; returns both hosts. */
function pair(list: () => any[], engine: () => any, oracle: () => any): [HTMLElement, HTMLElement] {
  const host = document.createElement("div");
  dispose = render(
    () => (
      <>
        <section id="e">
          <em>pre</em>
          {engine()}
          <em>post</em>
        </section>
        <section id="o">
          <em>pre</em>
          {oracle()}
          <em>post</em>
        </section>
      </>
    ),
    host
  );
  flush();
  return [host.querySelector("#e")!, host.querySelector("#o")!];
}

const texts = (el: HTMLElement) => Array.from(el.querySelectorAll("span")).map(s => s.textContent);

describe("identity keys + index accessor (arity 2)", () => {
  test("indices track position through reorders; nodes keep identity; oracle-equal", () => {
    const a = mk("a"),
      b = mk("b"),
      c = mk("c"),
      d = mk("d");
    const [list, setList] = createSignal<Item[]>([a, b, c]);
    let eCalls = 0,
      oCalls = 0;
    const engaged0 = stats().engaged;
    const [e, o] = pair(
      list,
      () => (
        <For each={list()}>
          {(item, i) => {
            eCalls++;
            return (
              <span>
                {item.name}:{i()}
              </span>
            );
          }}
        </For>
      ),
      () =>
        mapArray(list, (item: Item, i: any) => {
          oCalls++;
          return (
            <span>
              {item.name}:{i()}
            </span>
          );
        })
    );
    expect(stats().engaged).toBe(engaged0 + 1);
    expect(e.innerHTML).toBe(o.innerHTML);
    expect(texts(e)).toEqual(["A:0", "B:1", "C:2"]);
    const [sa, sb, sc] = Array.from(e.querySelectorAll("span"));
    const steps: Item[][] = [
      [c, a, b],
      [b, c],
      [d, b, c, a],
      [a, d],
      [],
      [b, a],
      [b, a, b] // duplicate: second b gets its own row and index
    ];
    for (const step of steps) {
      setList(step);
      flush();
      expect(e.innerHTML, step.map(x => x.id).join(",")).toBe(o.innerHTML);
      expect(texts(e)).toEqual(step.map((x, k) => `${x.name}:${k}`));
    }
    // a and b never left between steps 1-4; their nodes survived those moves.
    setList([a, b, c]);
    flush();
    expect(texts(e)).toEqual(["A:0", "B:1", "C:2"]);
    expect(eCalls).toBe(oCalls);
    // Identity check on a bounded move sequence.
    const [na, nb] = Array.from(e.querySelectorAll("span"));
    setList([b, a, c]);
    flush();
    expect(Array.from(e.querySelectorAll("span"))[0]).toBe(nb);
    expect(Array.from(e.querySelectorAll("span"))[1]).toBe(na);
    expect(texts(e)).toEqual(["B:0", "A:1", "C:2"]);
    void [sa, sb, sc];
  });
});

describe("keyed={false} (by index)", () => {
  test("rows are reused by POSITION: item() updates in place, index is a number, tail grows/shrinks", () => {
    const [list, setList] = createSignal(["a", "b", "c"]);
    let eCalls = 0,
      oCalls = 0;
    const [e, o] = pair(
      list,
      () => (
        <For each={list()} keyed={false}>
          {(item, i) => {
            eCalls++;
            return (
              <span>
                {item()}:{i}
              </span>
            );
          }}
        </For>
      ),
      () =>
        mapArray(
          list,
          (item: () => string, i: number) => {
            oCalls++;
            return (
              <span>
                {item()}:{i}
              </span>
            );
          },
          { keyed: false }
        )
    );
    expect(e.innerHTML).toBe(o.innerHTML);
    const nodes0 = Array.from(e.querySelectorAll("span"));
    // Reverse: no node moves — the same three nodes show new text.
    setList(["c", "b", "a"]);
    flush();
    expect(e.innerHTML).toBe(o.innerHTML);
    expect(texts(e)).toEqual(["c:0", "b:1", "a:2"]);
    expect(Array.from(e.querySelectorAll("span"))).toEqual(nodes0);
    expect(eCalls).toBe(3);
    // Grow: two fresh rows appended; the first three untouched.
    setList(["x", "y", "z", "p", "q"]);
    flush();
    expect(e.innerHTML).toBe(o.innerHTML);
    expect(texts(e)).toEqual(["x:0", "y:1", "z:2", "p:3", "q:4"]);
    expect(Array.from(e.querySelectorAll("span")).slice(0, 3)).toEqual(nodes0);
    expect(eCalls).toBe(5);
    // Shrink: tail rows leave; survivors keep identity.
    setList(["m"]);
    flush();
    expect(e.innerHTML).toBe(o.innerHTML);
    expect(texts(e)).toEqual(["m:0"]);
    expect(e.querySelector("span")).toBe(nodes0[0]);
    setList([]);
    flush();
    expect(e.innerHTML).toBe(o.innerHTML);
    expect(e.querySelectorAll("span").length).toBe(0);
    setList(["n", "o"]);
    flush();
    expect(e.innerHTML).toBe(o.innerHTML);
    expect(eCalls).toBe(oCalls);
  });
});

describe("keyed={fn}", () => {
  test("rows keyed by fn(item): same key → same node + item() update; reorder moves; duplicates by key", () => {
    const [list, setList] = createSignal<Item[]>([mk("a"), mk("b"), mk("c")]);
    let eCalls = 0,
      oCalls = 0;
    const key = (x: Item) => x.id;
    const [e, o] = pair(
      list,
      () => (
        <For each={list()} keyed={key}>
          {(item, i) => {
            eCalls++;
            return (
              <span>
                {item().name}:{i()}
              </span>
            );
          }}
        </For>
      ),
      () =>
        mapArray(
          list,
          (item: () => Item, i: any) => {
            oCalls++;
            return (
              <span>
                {item().name}:{i()}
              </span>
            );
          },
          { keyed: key }
        )
    );
    expect(e.innerHTML).toBe(o.innerHTML);
    const [na, nb, nc] = Array.from(e.querySelectorAll("span"));
    // New objects, same keys, one renamed: no new rows; b's text updates in place.
    setList([mk("a"), mk("b", "Bee"), mk("c")]);
    flush();
    expect(e.innerHTML).toBe(o.innerHTML);
    expect(texts(e)).toEqual(["A:0", "Bee:1", "C:2"]);
    expect(Array.from(e.querySelectorAll("span"))).toEqual([na, nb, nc]);
    expect(eCalls).toBe(3);
    // Reorder by key with fresh objects: nodes MOVE, indices update.
    setList([mk("c"), mk("a"), mk("b")]);
    flush();
    expect(e.innerHTML).toBe(o.innerHTML);
    expect(Array.from(e.querySelectorAll("span"))).toEqual([nc, na, nb]);
    expect(texts(e)).toEqual(["C:0", "A:1", "B:2"]);
    expect(eCalls).toBe(3);
    // Duplicate key: a second "a" row is created. mapArray's SUFFIX walk runs
    // before the middle window, so the old `a` row pairs with the LAST new
    // `a` (A2) and A1 is the fresh row — the engine pairs identically.
    setList([mk("a", "A1"), mk("a", "A2"), mk("b")]);
    flush();
    expect(e.innerHTML).toBe(o.innerHTML);
    expect(texts(e)).toEqual(["A1:0", "A2:1", "B:2"]);
    expect(e.querySelectorAll("span")[1]).toBe(na);
    const nA1 = e.querySelectorAll("span")[0];
    expect(eCalls).toBe(4);
    // Remove one duplicate: the PREFIX walk pairs the surviving `a` with the
    // row at position 0 (A1's); the old `a` row (na) is the one that leaves.
    setList([mk("a", "A3"), mk("b")]);
    flush();
    expect(e.innerHTML).toBe(o.innerHTML);
    expect(texts(e)).toEqual(["A3:0", "B:1"]);
    expect(e.querySelectorAll("span")[0]).toBe(nA1);
    expect(e.contains(na)).toBe(false);
    expect(eCalls).toBe(oCalls);
  });
});

describe("fallback", () => {
  test("empty → fallback; items replace it; clear brings it back; oracle-equal throughout", () => {
    const [list, setList] = createSignal<string[]>([]);
    const [e, o] = pair(
      list,
      () => (
        <For each={list()} fallback={<i>none</i>}>
          {item => <span>{item}</span>}
        </For>
      ),
      () => mapArray(list, (item: string) => <span>{item}</span>, { fallback: () => <i>none</i> })
    );
    expect(e.innerHTML).toBe(o.innerHTML);
    expect(e.innerHTML).toBe("<em>pre</em><i>none</i><em>post</em>");
    setList(["a", "b"]);
    flush();
    expect(e.innerHTML).toBe(o.innerHTML);
    expect(e.innerHTML).toBe("<em>pre</em><span>a</span><span>b</span><em>post</em>");
    setList(["b", "a", "c"]);
    flush();
    expect(e.innerHTML).toBe(o.innerHTML);
    setList([]);
    flush();
    expect(e.innerHTML).toBe(o.innerHTML);
    expect(e.innerHTML).toBe("<em>pre</em><i>none</i><em>post</em>");
    setList(["z"]);
    flush();
    expect(e.innerHTML).toBe(o.innerHTML);
    expect(e.innerHTML).toBe("<em>pre</em><span>z</span><em>post</em>");
  });

  test("dynamic fallback content (a Show) updates in place while shown", () => {
    const [list, setList] = createSignal<string[]>([]);
    const [busy, setBusy] = createSignal(true);
    const [e, o] = pair(
      list,
      () => (
        <For
          each={list()}
          fallback={
            <Show when={busy()} fallback={<i>empty</i>}>
              {<b>loading</b>}
            </Show>
          }
        >
          {item => <span>{item}</span>}
        </For>
      ),
      () =>
        mapArray(list, (item: string) => <span>{item}</span>, {
          fallback: () => (
            <Show when={busy()} fallback={<i>empty</i>}>
              {<b>loading</b>}
            </Show>
          )
        })
    );
    expect(e.innerHTML).toBe(o.innerHTML);
    expect(e.innerHTML).toBe("<em>pre</em><b>loading</b><em>post</em>");
    setBusy(false);
    flush();
    expect(e.innerHTML).toBe(o.innerHTML);
    expect(e.innerHTML).toBe("<em>pre</em><i>empty</i><em>post</em>");
    setList(["a"]);
    flush();
    expect(e.innerHTML).toBe(o.innerHTML);
    expect(e.innerHTML).toBe("<em>pre</em><span>a</span><em>post</em>");
    setBusy(true); // fallback not shown: no effect on the DOM
    flush();
    expect(e.innerHTML).toBe("<em>pre</em><span>a</span><em>post</em>");
    setList([]);
    flush();
    expect(e.innerHTML).toBe(o.innerHTML);
    expect(e.innerHTML).toBe("<em>pre</em><b>loading</b><em>post</em>");
  });

  test("whole-parent fallback with the flat path: fill → clear → fallback → fill", () => {
    const [list, setList] = createSignal<string[]>(["a", "b"]);
    dispose = render(
      () => (
        <section>
          <For each={list()} fallback={<i>none</i>}>
            {item => <span>{item}</span>}
          </For>
        </section>
      ),
      container
    );
    flush();
    const sec = container.firstChild as HTMLElement;
    expect(sec.innerHTML).toBe("<span>a</span><span>b</span>");
    setList([]);
    flush();
    expect(sec.innerHTML).toBe("<i>none</i>");
    setList(["c"]);
    flush();
    expect(sec.innerHTML).toBe("<span>c</span>");
    setList(["c", "d"]);
    flush();
    expect(sec.innerHTML).toBe("<span>c</span><span>d</span>");
  });
});
