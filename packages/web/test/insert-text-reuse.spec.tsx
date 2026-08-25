/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { createSignal, createRoot, flush } from "solid-js";

// Dynamic text sharing a slot with element siblings (the `multi` insert
// path). Text updates must adopt the existing text node with a `.data`
// write — never allocate a replacement node and swap it in — and the
// adoption must happen at commit (insertExpression), not during compute
// (normalize), so transition forks cannot touch the live DOM.
describe("insert text node reuse (multi slot)", () => {
  test("text beside an element updates in place, preserving node identity", () => {
    const [count, setCount] = createSignal(0);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        {count()}
        <b>sib</b>
      </div>;
      return d;
    });
    flush();

    expect(div.textContent).toBe("0sib");
    const textNode = div.firstChild!;
    expect(textNode.nodeType).toBe(3);

    setCount(1);
    flush();
    expect(div.textContent).toBe("1sib");
    expect(div.firstChild).toBe(textNode);

    setCount(2);
    flush();
    expect(div.firstChild).toBe(textNode);
    expect((textNode as Text).data).toBe("2");

    dispose();
  });

  test("string and number values both reuse the node", () => {
    const [value, setValue] = createSignal<string | number>("a");
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        {value()}
        <i>x</i>
      </div>;
      return d;
    });
    flush();

    const textNode = div.firstChild!;
    setValue(42);
    flush();
    expect(div.firstChild).toBe(textNode);
    expect((textNode as Text).data).toBe("42");

    setValue("");
    flush();
    expect(div.firstChild).toBe(textNode);
    expect((textNode as Text).data).toBe("");

    dispose();
  });

  test("text -> element -> text transition still replaces correctly", () => {
    const [value, setValue] = createSignal<any>("start");
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        {value()}
        <b>sib</b>
      </div>;
      return d;
    });
    flush();

    expect(div.textContent).toBe("startsib");

    const el = document.createElement("em");
    el.textContent = "mid";
    setValue(el);
    flush();
    expect(div.firstChild).toBe(el);
    expect(div.textContent).toBe("midsib");

    setValue("end");
    flush();
    expect(div.firstChild!.nodeType).toBe(3);
    expect(div.textContent).toBe("endsib");

    dispose();
  });

  test("fragment of primitives updates each slot in place", () => {
    const [a, setA] = createSignal(1);
    const [b, setB] = createSignal(2);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>{[a(), <b>mid</b>, b()]}</div>;
      return d;
    });
    flush();

    expect(div.textContent).toBe("1mid2");
    const first = div.firstChild!;
    const last = div.lastChild!;
    expect(first.nodeType).toBe(3);
    expect(last.nodeType).toBe(3);

    setA(10);
    setB(20);
    flush();
    expect(div.textContent).toBe("10mid20");
    expect(div.firstChild).toBe(first);
    expect(div.lastChild).toBe(last);

    dispose();
  });
});
