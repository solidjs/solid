/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import { createSignal, createRoot, flush } from "solid-js";

// #4372: a sole text child is updated with a `.data` write on the parent's
// first child. When the document removed that node since (a streamed
// fragment's swap took the claimed fallback's text, and a rejected
// fragment's fresh render cleared what the swap put in), the next text value
// is inserted like a first one instead of writing to a missing node.
test("a sole text child removed from the document: the next text value is inserted", () => {
  const [text, setText] = createSignal("a");
  let div!: HTMLDivElement;
  const dispose = createRoot(d => {
    <div ref={div}>{text()}</div>;
    return d;
  });
  flush();
  expect(div.textContent).toBe("a");
  div.firstChild!.remove();

  setText("b");
  flush();
  expect(div.textContent).toBe("b");

  // And the fast path holds again from there: the new node is updated in place.
  const node = div.firstChild;
  setText("c");
  flush();
  expect(div.firstChild).toBe(node);
  expect(div.textContent).toBe("c");
  dispose();
});
