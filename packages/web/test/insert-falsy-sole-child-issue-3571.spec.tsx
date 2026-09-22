/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * A sole dynamic child whose value is `0` or `NaN` is tracked as that raw
 * primitive. Replacing it must drop the text node. Truthiness checks used to
 * skip that cleanup, so the new content was appended and zeros accumulated
 * on later toggles (#3571).
 */
import { describe, expect, test } from "vitest";
import { createSignal, createRoot, flush, For } from "solid-js";

function directText(el: HTMLElement): string[] {
  return [...el.childNodes].filter(node => node.nodeType === 3).map(node => node.nodeValue ?? "");
}

describe("sole-child falsy primitives (#3571)", () => {
  test("0 swaps with an element and back without leaving text behind", () => {
    const [count, setCount] = createSignal(0);
    const [loading, setLoading] = createSignal(false);
    let span!: HTMLSpanElement;
    const dispose = createRoot(d => {
      <span ref={span}>{loading() ? <i>load</i> : count()}</span>;
      return d;
    });
    flush();

    expect(span.childNodes.length).toBe(1);
    expect(span.textContent).toBe("0");

    setLoading(true);
    flush();
    expect(span.childNodes.length).toBe(1);
    expect(span.firstChild!.nodeName).toBe("I");
    expect(span.textContent).toBe("load");

    setLoading(false);
    flush();
    expect(span.childNodes.length).toBe(1);
    expect(span.textContent).toBe("0");

    setCount(4);
    flush();
    expect(span.childNodes.length).toBe(1);
    expect(span.textContent).toBe("4");

    setCount(0);
    flush();
    setLoading(true);
    flush();
    setLoading(false);
    flush();
    setLoading(true);
    flush();
    expect(directText(span)).toEqual([]);
    expect(span.childNodes.length).toBe(1);
    expect(span.textContent).toBe("load");

    dispose();
  });

  test("NaN swaps with an element and back without leaving text behind", () => {
    const [value, setValue] = createSignal<number>(NaN);
    const [show, setShow] = createSignal(false);
    let span!: HTMLSpanElement;
    const dispose = createRoot(d => {
      <span ref={span}>{show() ? <b>x</b> : value()}</span>;
      return d;
    });
    flush();

    expect(span.childNodes.length).toBe(1);
    expect(span.textContent).toBe("NaN");

    setShow(true);
    flush();
    expect(span.childNodes.length).toBe(1);
    expect(span.firstChild!.nodeName).toBe("B");
    expect(span.textContent).toBe("x");

    setShow(false);
    flush();
    expect(span.childNodes.length).toBe(1);
    expect(span.textContent).toBe("NaN");

    setValue(2);
    flush();
    expect(span.childNodes.length).toBe(1);
    expect(span.textContent).toBe("2");

    dispose();
  });

  test("0 swaps with an array and back without leaving text behind", () => {
    const [showList, setShowList] = createSignal(false);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>{showList() ? [<b>b</b>, <i>i</i>] : 0}</div>;
      return d;
    });
    flush();

    expect(div.childNodes.length).toBe(1);
    expect(div.textContent).toBe("0");

    setShowList(true);
    flush();
    expect(directText(div)).toEqual([]);
    expect(div.textContent).toBe("bi");
    expect(div.childNodes.length).toBe(2);

    setShowList(false);
    flush();
    expect(div.childNodes.length).toBe(1);
    expect(div.textContent).toBe("0");

    setShowList(true);
    flush();
    expect(directText(div)).toEqual([]);
    expect(div.textContent).toBe("bi");

    dispose();
  });

  test("length && list replaces the 0 text node", () => {
    const [items, setItems] = createSignal<string[]>([]);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        {items().length && <For each={items()}>{item => <span>{item}</span>}</For>}
      </div>;
      return d;
    });
    flush();

    expect(div.childNodes.length).toBe(1);
    expect(div.textContent).toBe("0");

    setItems(["a", "b"]);
    flush();
    expect(directText(div)).not.toContain("0");
    expect(div.textContent).toBe("ab");
    expect(div.querySelectorAll("span").length).toBe(2);

    setItems([]);
    flush();
    expect(div.childNodes.length).toBe(1);
    expect(div.textContent).toBe("0");

    setItems(["c"]);
    flush();
    expect(directText(div)).not.toContain("0");
    expect(div.textContent).toBe("c");
    expect(div.querySelectorAll("span").length).toBe(1);

    dispose();
  });
});
