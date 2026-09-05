/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * P0 regression suite (external audit, 2026-09-04): the slot's bulk-clear
 * paths must never wipe nodes it doesn't own.
 *
 * 1. `marker = null` (the compiler's TRAILING-child shape —
 *    `<div><h1/><For/></div>`) is classic MULTI mode, NOT whole-parent
 *    ownership: clear / no-survivor replace / chain batch-clear must remove
 *    only slot rows.
 * 2. Even true whole-parent slots honor classic's ownsAllChildren ruling:
 *    foreign nodes appended to the parent (streaming's late <link>s) survive
 *    bulk ops.
 * 3. Empty-rendering rows (null) hold position with a placeholder text node
 *    instead of demoting — sibling rows keep their DOM state (typed inputs).
 */
import { beforeEach, describe, expect, test } from "vitest";
// The packaged specifier, NOT ../src — compiled JSX resolves solid-js to
// dist; probes must share that instance.
import { createSignal, flush, For, __unifiedForStats } from "solid-js";
import { render } from "@solidjs/web";

describe("unified For: preceding siblings survive bulk paths (P0)", () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    dispose?.();
    dispose = undefined;
    container = document.createElement("div");
  });

  test("clear (flat path) removes only slot rows", () => {
    const [list, setList] = createSignal(["a", "b"]);
    dispose = render(
      () => (
        <div>
          <h1>Title</h1>
          <For each={list()}>{item => <span>{item}</span>}</For>
        </div>
      ),
      container
    );
    expect(container.innerHTML).toBe("<div><h1>Title</h1><span>a</span><span>b</span></div>");
    setList([]);
    flush();
    expect(container.innerHTML).toBe("<div><h1>Title</h1></div>");
  });

  test("no-survivor replace (flat path) removes only slot rows, appends in place", () => {
    const [list, setList] = createSignal(["a", "b"]);
    dispose = render(
      () => (
        <div>
          <h1>Title</h1>
          <For each={list()}>{item => <span>{item}</span>}</For>
        </div>
      ),
      container
    );
    setList(["x", "y"]);
    flush();
    expect(container.innerHTML).toBe("<div><h1>Title</h1><span>x</span><span>y</span></div>");
  });

  test("clear after materialization (chain path) removes only slot rows", () => {
    const [list, setList] = createSignal(["a", "b", "c"]);
    dispose = render(
      () => (
        <div>
          <h1>Title</h1>
          <For each={list()}>{item => <span>{item}</span>}</For>
        </div>
      ),
      container
    );
    // Partial structural op materializes the chain out of flat mode.
    setList(["b", "a", "c"]);
    flush();
    expect(container.innerHTML).toBe(
      "<div><h1>Title</h1><span>b</span><span>a</span><span>c</span></div>"
    );
    setList([]);
    flush();
    expect(container.innerHTML).toBe("<div><h1>Title</h1></div>");
  });

  test("no-survivor replace after materialization removes only slot rows", () => {
    const [list, setList] = createSignal(["a", "b"]);
    dispose = render(
      () => (
        <div>
          <h1>Title</h1>
          <For each={list()}>{item => <span>{item}</span>}</For>
        </div>
      ),
      container
    );
    setList(["b", "a"]);
    flush();
    setList(["x", "y"]);
    flush();
    expect(container.innerHTML).toBe("<div><h1>Title</h1><span>x</span><span>y</span></div>");
  });

  test("demote (flat) with preceding sibling: classic rebuild keeps the sibling", () => {
    const [list, setList] = createSignal<any[]>(["a", "b"]);
    dispose = render(
      () => (
        <div>
          <h1>Title</h1>
          <For each={list()}>
            {(item: any) => (typeof item === "function" ? item : <span>{item}</span>)}
          </For>
        </div>
      ),
      container
    );
    // A row whose top level is a FUNCTION demotes to classic.
    const before = __unifiedForStats.demoted;
    setList(["a", () => <b>dyn</b>]);
    flush();
    expect(__unifiedForStats.demoted).toBe(before + 1);
    expect(container.querySelector("h1")).not.toBeNull();
    expect(container.querySelector("h1")!.textContent).toBe("Title");
    expect(container.querySelectorAll("span").length).toBe(1);
    expect(container.querySelector("b")!.textContent).toBe("dyn");
  });
});

describe("unified For: whole-parent ownership guard (foreign nodes survive)", () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    dispose?.();
    dispose = undefined;
    container = document.createElement("div");
  });

  // For as the SOLE child of a compiled element — the true whole-parent
  // shape (`insert(_el$, comp)`, marker undefined). `render(() => <For/>)`
  // wraps the accessor and runs classic; the compiled shape is the one that
  // engages with whole-parent ownership.
  test("streamed foreign node survives a flat clear", () => {
    const [list, setList] = createSignal(["a", "b"]);
    dispose = render(
      () => (
        <section>
          <For each={list()}>{item => <span>{item}</span>}</For>
        </section>
      ),
      container
    );
    const section = container.querySelector("section")!;
    // Streaming appends a foreign node (late-flushed <link>) to our parent.
    const link = document.createElement("link");
    section.appendChild(link);
    setList([]);
    flush();
    expect(section.contains(link)).toBe(true);
    expect(section.querySelectorAll("span").length).toBe(0);
  });

  test("streamed foreign node survives a chain batch clear", () => {
    const [list, setList] = createSignal(["a", "b", "c"]);
    dispose = render(
      () => (
        <section>
          <For each={list()}>{item => <span>{item}</span>}</For>
        </section>
      ),
      container
    );
    const section = container.querySelector("section")!;
    setList(["b", "a", "c"]); // materialize the chain
    flush();
    const link = document.createElement("link");
    section.appendChild(link);
    setList([]);
    flush();
    expect(section.contains(link)).toBe(true);
    expect(section.querySelectorAll("span").length).toBe(0);
  });

  test("owned whole-parent clear still takes the bulk path", () => {
    const [list, setList] = createSignal(["a", "b", "c"]);
    dispose = render(
      () => (
        <section>
          <For each={list()}>{item => <span>{item}</span>}</For>
        </section>
      ),
      container
    );
    const section = container.querySelector("section")!;
    setList(["c", "b", "a"]); // materialize
    flush();
    const before = __unifiedForStats.batchCleared;
    setList([]);
    flush();
    expect(__unifiedForStats.batchCleared).toBe(before + 1);
    expect(section.innerHTML).toBe("");
  });
});

describe("unified For: empty-rendering rows hold position (no demote)", () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    dispose?.();
    dispose = undefined;
    container = document.createElement("div");
  });

  test("a null row arriving late does NOT demote — sibling input state survives", () => {
    type R = { id: string; hidden?: boolean };
    const a: R = { id: "a" };
    const b: R = { id: "b" };
    const [list, setList] = createSignal<R[]>([a, b]);
    dispose = render(
      () => <For each={list()}>{(it: R) => (it.hidden ? null : <input data-id={it.id} />)}</For>,
      container
    );
    const inputA = container.querySelector("input")!;
    inputA.value = "typed";
    const before = __unifiedForStats.demoted;
    setList([a, b, { id: "c", hidden: true }]);
    flush();
    expect(__unifiedForStats.demoted).toBe(before);
    expect(container.querySelector("input")).toBe(inputA); // same node
    expect(inputA.value).toBe("typed"); // state intact
    expect(container.querySelectorAll("input").length).toBe(2);
  });

  test("null rows participate in reorders and removals", () => {
    type R = { id: string; hidden?: boolean };
    const a: R = { id: "a" };
    const gap: R = { id: "gap", hidden: true };
    const b: R = { id: "b" };
    const [list, setList] = createSignal<R[]>([a, gap, b]);
    dispose = render(
      () => <For each={list()}>{(it: R) => (it.hidden ? null : <span>{it.id}</span>)}</For>,
      container
    );
    expect(container.querySelectorAll("span").length).toBe(2);
    setList([b, gap, a]);
    flush();
    const spans = [...container.querySelectorAll("span")].map(s => s.textContent);
    expect(spans).toEqual(["b", "a"]);
    setList([a, b]);
    flush();
    expect([...container.querySelectorAll("span")].map(s => s.textContent)).toEqual(["a", "b"]);
  });
});
