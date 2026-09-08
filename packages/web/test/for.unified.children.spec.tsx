/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Unified For through COMPONENT CHILDREN — the hole seam. A `<For>` passed
 * as `props.children` reaches the parent's insert through a wrapper
 * accessor (`insert(el, () => props.children)`); the seam engages the slot
 * for that hole when the resolved value is the `$for` accessor.
 *
 * Contract pinned here:
 *   - whole-parent and bounded (marker) holes engage; rows move, not rebuild
 *   - a children CHANGE tears the slot down cleanly (rows removed, new
 *     content in place, no leftovers) and a returning For re-engages
 *   - duplicates and array-like subjects INSIDE a hole stay on the engine
 *   - `children()` introspection and fragment children stay classic
 */
import { beforeEach, describe, expect, test } from "vitest";
import { createSignal, flush, For, children, DEV } from "solid-js";
const stats = DEV!.unifiedFor;
import { render, Dynamic } from "@solidjs/web";

function Table(props: { children: any }) {
  return (
    <table>
      <tbody>{props.children}</tbody>
    </table>
  );
}

function Card(props: { children: any }) {
  return (
    <section>
      <header>h</header>
      {props.children}
      <footer>f</footer>
    </section>
  );
}

function Introspect(props: { children: any }) {
  const c = children(() => props.children);
  return <div>{c()}</div>;
}

function Wrap(props: { children: any }) {
  return <div>{props.children}</div>;
}

const texts = (root: ParentNode, sel: string) =>
  [...root.querySelectorAll(sel)].map(el => el.textContent);

describe("unified For through props.children (hole seam)", () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    dispose?.();
    dispose = undefined;
    container = document.createElement("div");
  });

  test("whole-parent hole engages; reorder moves the same rows", () => {
    const [rows, setRows] = createSignal(["a", "b", "c"]);
    const engaged0 = stats.engaged;
    dispose = render(
      () => (
        <Table>
          <For each={rows()}>
            {r => (
              <tr>
                <td>{r}</td>
              </tr>
            )}
          </For>
        </Table>
      ),
      container
    );
    expect(stats.engaged).toBe(engaged0 + 1);
    expect(texts(container, "tr")).toEqual(["a", "b", "c"]);
    const before = new Map([...container.querySelectorAll("tr")].map(tr => [tr.textContent, tr]));
    setRows(["c", "a", "b"]);
    flush();
    expect(texts(container, "tr")).toEqual(["c", "a", "b"]);
    for (const tr of container.querySelectorAll("tr"))
      expect(tr, `row ${tr.textContent} moved, not rebuilt`).toBe(before.get(tr.textContent));
    setRows([]);
    flush();
    expect(container.querySelector("tbody")!.innerHTML).toBe("");
  });

  test("bounded hole (element marker) engages; siblings untouched through reorder and clear", () => {
    const [rows, setRows] = createSignal(["a", "b", "c"]);
    const engaged0 = stats.engaged;
    dispose = render(
      () => (
        <Card>
          <For each={rows()}>{r => <p>{r}</p>}</For>
        </Card>
      ),
      container
    );
    expect(stats.engaged).toBe(engaged0 + 1);
    const section = container.querySelector("section")!;
    expect(section.querySelector("header")!.textContent).toBe("h");
    expect(texts(section, "p")).toEqual(["a", "b", "c"]);
    expect(section.lastElementChild!.tagName).toBe("FOOTER");
    setRows(["b", "c", "a"]);
    flush();
    expect(texts(section, "p")).toEqual(["b", "c", "a"]);
    // Rows sit strictly between header and footer.
    expect(section.firstElementChild!.tagName).toBe("HEADER");
    expect(section.lastElementChild!.tagName).toBe("FOOTER");
    setRows([]);
    flush();
    expect(section.querySelectorAll("p").length).toBe(0);
    expect(section.querySelector("header")!.textContent).toBe("h");
    expect(section.querySelector("footer")!.textContent).toBe("f");
  });

  test("children change tears the slot down cleanly; a returning For re-engages", () => {
    const [rows, setRows] = createSignal(["a", "b"]);
    const [show, setShow] = createSignal(true);
    const engaged0 = stats.engaged;
    dispose = render(
      () => <Wrap>{show() ? <For each={rows()}>{r => <span>{r}</span>}</For> : <p>none</p>}</Wrap>,
      container
    );
    const div = container.querySelector("div")!;
    expect(stats.engaged).toBe(engaged0 + 1);
    expect(div.innerHTML).toBe("<span>a</span><span>b</span>");
    setShow(false);
    flush();
    expect(div.innerHTML).toBe("<p>none</p>"); // rows gone, no leftovers
    setShow(true);
    flush();
    expect(stats.engaged).toBe(engaged0 + 2); // fresh slot
    expect(div.innerHTML).toBe("<span>a</span><span>b</span>");
    setRows(["b", "a"]);
    flush();
    expect(div.innerHTML).toBe("<span>b</span><span>a</span>");
  });

  test("function-top-level rows stay engaged inside a hole (dynamic rows, no demote)", () => {
    const [rows, setRows] = createSignal<any[]>(["a", "b"]);
    dispose = render(
      () => (
        <Wrap>
          <For each={rows()}>{(r: any) => (typeof r === "function" ? r : <span>{r}</span>)}</For>
        </Wrap>
      ),
      container
    );
    const div = container.querySelector("div")!;
    expect(div.innerHTML).toBe("<span>a</span><span>b</span>");
    // A function-top-level row arrives → resolved by the slot's own compute
    // (classic's list-effect model); the slot stays engaged.
    const dyn = () => <b>dyn</b>;
    setRows(["a", dyn, "b"]);
    flush();
    expect(div.innerHTML).toBe("<span>a</span><b>dyn</b><span>b</span>");
    setRows(["b", dyn, "a"]);
    flush();
    expect(div.innerHTML).toBe("<span>b</span><b>dyn</b><span>a</span>");
    setRows([]);
    flush();
    expect(div.innerHTML).toBe("");
  });

  test("duplicate identity keys inside a hole: two rows, engine stays engaged", () => {
    const a = { id: "a" },
      b = { id: "b" };
    const [rows, setRows] = createSignal<any[]>([a, b]);
    dispose = render(
      () => (
        <Wrap>
          <For each={rows()}>{(r: any) => <span>{r.id}</span>}</For>
        </Wrap>
      ),
      container
    );
    const div = container.querySelector("div")!;
    expect(div.innerHTML).toBe("<span>a</span><span>b</span>");
    setRows([a, b, a]);
    flush();
    expect(div.innerHTML).toBe("<span>a</span><span>b</span><span>a</span>");
    setRows([b, a]);
    flush();
    expect(div.innerHTML).toBe("<span>b</span><span>a</span>");
    setRows([]);
    flush();
    expect(div.innerHTML).toBe("");
  });

  test("<Dynamic>-rooted rows stay engaged (memo top level → dynamic row) and stay correct", () => {
    // Dynamic returns a MEMO (its `component` may change), so the row's top
    // level is a function whether element creation is eager (#3291 revert)
    // or deferred (#3187). The slot resolves it tracked in its own compute —
    // no demote, no second invocation of the row — and reorders as usual.
    const [rows, setRows] = createSignal(["a", "b", "c"]);
    const engaged0 = stats.engaged;
    dispose = render(
      () => (
        <Table>
          <For each={rows()}>{r => <Dynamic component="tr">{r}</Dynamic>}</For>
        </Table>
      ),
      container
    );
    expect(stats.engaged).toBe(engaged0 + 1);
    expect(texts(container, "tr")).toEqual(["a", "b", "c"]);
    const trs = Array.from(container.querySelectorAll("tr"));
    setRows(["c", "a", "b"]);
    flush();
    expect(texts(container, "tr")).toEqual(["c", "a", "b"]);
    // Reorder moved the SAME elements (row identity survived).
    expect(Array.from(container.querySelectorAll("tr"))).toEqual([trs[2], trs[0], trs[1]]);
    setRows([]);
    flush();
    expect(container.querySelector("tbody")!.innerHTML).toBe("");
  });

  test("array-like subject in a hole (string → characters), replace and children swap stay clean", () => {
    // mapArray duck-types anything with `length` + indices; the engine does
    // the same. The hole's range must stay exact through a replace and a
    // children change (no orphan placeholder, no leaked rows).
    const [rows, setRows] = createSignal<any>("ab");
    const [show, setShow] = createSignal(true);
    dispose = render(
      () => (
        <Card>
          {show() ? (
            <For each={rows()}>{(r: any) => <Dynamic component="span">{r}</Dynamic>}</For>
          ) : (
            <p>none</p>
          )}
        </Card>
      ),
      container
    );
    const sec = container.querySelector("section")!;
    expect(sec.innerHTML).toBe("<header>h</header><span>a</span><span>b</span><footer>f</footer>");
    expect(sec.childNodes.length).toBe(4); // no orphan placeholder
    setRows(["x", "y"]); // REPLACE (not reorder): old rows must go
    flush();
    expect(sec.innerHTML).toBe("<header>h</header><span>x</span><span>y</span><footer>f</footer>");
    expect(sec.childNodes.length).toBe(4);
    setShow(false);
    flush();
    expect(sec.innerHTML).toBe("<header>h</header><p>none</p><footer>f</footer>");
    setShow(true);
    flush();
    expect(sec.innerHTML).toBe("<header>h</header><span>x</span><span>y</span><footer>f</footer>");

    // Whole-parent hole, replace only.
    dispose();
    const [rows2, setRows2] = createSignal<any>("ab");
    dispose = render(
      () => (
        <Wrap>
          <For each={rows2()}>{(r: any) => <Dynamic component="span">{r}</Dynamic>}</For>
        </Wrap>
      ),
      container
    );
    const div = container.querySelector("div")!;
    expect(div.innerHTML).toBe("<span>a</span><span>b</span>");
    setRows2(["x", "y"]);
    flush();
    expect(div.innerHTML).toBe("<span>x</span><span>y</span>");
  });

  test("children() introspection stays classic and correct", () => {
    const [rows, setRows] = createSignal(["a", "b"]);
    const engaged0 = stats.engaged;
    dispose = render(
      () => (
        <Introspect>
          <For each={rows()}>{r => <span>{r}</span>}</For>
        </Introspect>
      ),
      container
    );
    expect(stats.engaged).toBe(engaged0);
    expect(container.querySelector("div")!.innerHTML).toBe("<span>a</span><span>b</span>");
    setRows(["b", "a", "c"]);
    flush();
    expect(container.querySelector("div")!.innerHTML).toBe(
      "<span>b</span><span>a</span><span>c</span>"
    );
  });

  test("fragment children (For beside siblings) stay classic and correct", () => {
    const [rows, setRows] = createSignal(["a", "b"]);
    const engaged0 = stats.engaged;
    dispose = render(
      () => (
        <Wrap>
          <h1>t</h1>
          <For each={rows()}>{r => <span>{r}</span>}</For>
        </Wrap>
      ),
      container
    );
    expect(stats.engaged).toBe(engaged0);
    const div = container.querySelector("div")!;
    expect(div.innerHTML).toBe("<h1>t</h1><span>a</span><span>b</span>");
    setRows(["b"]);
    flush();
    expect(div.innerHTML).toBe("<h1>t</h1><span>b</span>");
  });
});
