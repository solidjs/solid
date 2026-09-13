/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { renderToString, ssrElement, Dynamic } from "@solidjs/web";
import { createMemo, createComponent } from "solid-js";
import type { JSX } from "@solidjs/web";

const SEP = "<!--!$-->";
// Keys out, and any whitespace left behind in the opening tag (#3382).
const strip = (html: string) => html.replace(/ _hk=[^\s>]+/g, "").replace(/\s+>/g, ">");
const count = (html: string) => html.split(SEP).length - 1;

// Regression (#3383): the separator decision was made on an item's STATIC
// type, so any two adjacent functions — memos, components — were separated as
// if they were text, even when both produced elements. The client flattens
// the value before claiming nodes positionally, so what matters is what each
// item RESOLVES to.
describe("SSR text separators (#3383)", () => {
  test("adjacent memos that yield elements get no separator", () => {
    // Memos are valid children at runtime (function children); the cast is
    // for the Component type, which only admits JSX.Element.
    const Item = (p: { i: number }) =>
      createMemo(() => ssrElement("li", {}, () => p.i, true)) as unknown as JSX.Element;
    const html = renderToString(() => <ul>{[1, 2, 3].map(i => createComponent(Item, { i }))}</ul>);
    expect(strip(html)).toBe("<ul><li>1</li><li>2</li><li>3</li></ul>");
  });

  test("Dynamic instances in a list get no separator", () => {
    const html = renderToString(() => (
      <div>
        {[1, 2].map(i => (
          <Dynamic component="span">{i}</Dynamic>
        ))}
      </div>
    ));
    expect(strip(html)).toBe("<div><span>1</span><span>2</span></div>");
  });

  test("adjacent memos that yield text are separated", () => {
    const html = renderToString(() => <div>{["a", "b"].map(s => createMemo(() => s))}</div>);
    expect(strip(html)).toBe(`<div>a${SEP}b</div>`);
  });

  test("text on either side of an element is not separated from it", () => {
    const html = renderToString(() => <div>{["a", <b>x</b>, "c"]}</div>);
    expect(strip(html)).toBe("<div>a<b>x</b>c</div>");
  });

  test("nullish and boolean items are dropped without breaking text adjacency", () => {
    // The client drops null/false when flattening, so `7` and "x" are
    // neighbours and must land in two text nodes.
    for (const gap of [null, undefined, false, true]) {
      const html = renderToString(() => <div>{[7, gap, "x"]}</div>);
      expect(strip(html)).toBe(`<div>7${SEP}x</div>`);
    }
  });

  test("nested arrays flatten: text across the boundary is separated", () => {
    const html = renderToString(() => <div>{["a", ["b", <i />], "c", ["d"]]}</div>);
    expect(strip(html)).toBe(`<div>a${SEP}b<i></i>c${SEP}d</div>`);
  });

  test("mixed memo results are decided per item", () => {
    const items = [() => "a", () => <b>1</b>, () => "c", () => "d", () => <i />, () => 5];
    const html = renderToString(() => <div>{items.map(f => createMemo(f))}</div>);
    expect(strip(html)).toBe(`<div>a<b>1</b>c${SEP}d<i></i>5</div>`);
  });

  test("a large list of element-returning components emits no separators", () => {
    const Row = (p: { i: number }) => createMemo(() => <li>{p.i}</li>) as unknown as JSX.Element;
    const html = renderToString(() => (
      <ul>{Array.from({ length: 200 }, (_, i) => createComponent(Row, { i }))}</ul>
    ));
    expect(count(html)).toBe(0);
  });
});
