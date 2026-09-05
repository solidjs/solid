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
 *   - a demote INSIDE a hole hands the hole to the classic path via the
 *     hosting effect's re-run — no second insert fighting for the hole
 *   - `children()` introspection and fragment children stay classic
 */
import { beforeEach, describe, expect, test } from "vitest";
import { createSignal, flush, For, children, __unifiedForStats } from "solid-js";
import { render } from "@solidjs/web";

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
    const engaged0 = __unifiedForStats.engaged;
    const demoted0 = __unifiedForStats.demoted;
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
    expect(__unifiedForStats.engaged).toBe(engaged0 + 1);
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
    expect(__unifiedForStats.demoted).toBe(demoted0);
  });

  test("bounded hole (element marker) engages; siblings untouched through reorder and clear", () => {
    const [rows, setRows] = createSignal(["a", "b", "c"]);
    const engaged0 = __unifiedForStats.engaged;
    dispose = render(
      () => (
        <Card>
          <For each={rows()}>{r => <p>{r}</p>}</For>
        </Card>
      ),
      container
    );
    expect(__unifiedForStats.engaged).toBe(engaged0 + 1);
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
    const engaged0 = __unifiedForStats.engaged;
    dispose = render(
      () => <Wrap>{show() ? <For each={rows()}>{r => <span>{r}</span>}</For> : <p>none</p>}</Wrap>,
      container
    );
    const div = container.querySelector("div")!;
    expect(__unifiedForStats.engaged).toBe(engaged0 + 1);
    expect(div.innerHTML).toBe("<span>a</span><span>b</span>");
    setShow(false);
    flush();
    expect(div.innerHTML).toBe("<p>none</p>"); // rows gone, no leftovers
    setShow(true);
    flush();
    expect(__unifiedForStats.engaged).toBe(engaged0 + 2); // fresh slot
    expect(div.innerHTML).toBe("<span>a</span><span>b</span>");
    setRows(["b", "a"]);
    flush();
    expect(div.innerHTML).toBe("<span>b</span><span>a</span>");
  });

  test("demote inside a hole hands the hole to classic via the hosting effect", () => {
    const [rows, setRows] = createSignal<any[]>(["a", "b"]);
    const demoted0 = __unifiedForStats.demoted;
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
    // A function-top-level row arrives → slot demotes; the hole re-runs classic.
    setRows(["a", () => <b>dyn</b>, "b"]);
    flush();
    expect(__unifiedForStats.demoted).toBe(demoted0 + 1);
    expect(div.innerHTML).toBe("<span>a</span><b>dyn</b><span>b</span>");
    // Classic now owns the hole: further updates keep working, no duplicates.
    setRows(["b", "a"]);
    flush();
    expect(div.innerHTML).toBe("<span>b</span><span>a</span>");
    setRows([]);
    flush();
    expect(div.innerHTML).toBe("");
  });

  test("children() introspection stays classic and correct", () => {
    const [rows, setRows] = createSignal(["a", "b"]);
    const engaged0 = __unifiedForStats.engaged;
    dispose = render(
      () => (
        <Introspect>
          <For each={rows()}>{r => <span>{r}</span>}</For>
        </Introspect>
      ),
      container
    );
    expect(__unifiedForStats.engaged).toBe(engaged0);
    expect(container.querySelector("div")!.innerHTML).toBe("<span>a</span><span>b</span>");
    setRows(["b", "a", "c"]);
    flush();
    expect(container.querySelector("div")!.innerHTML).toBe(
      "<span>b</span><span>a</span><span>c</span>"
    );
  });

  test("fragment children (For beside siblings) stay classic and correct", () => {
    const [rows, setRows] = createSignal(["a", "b"]);
    const engaged0 = __unifiedForStats.engaged;
    dispose = render(
      () => (
        <Wrap>
          <h1>t</h1>
          <For each={rows()}>{r => <span>{r}</span>}</For>
        </Wrap>
      ),
      container
    );
    expect(__unifiedForStats.engaged).toBe(engaged0);
    const div = container.querySelector("div")!;
    expect(div.innerHTML).toBe("<h1>t</h1><span>a</span><span>b</span>");
    setRows(["b"]);
    flush();
    expect(div.innerHTML).toBe("<h1>t</h1><span>b</span>");
  });
});
