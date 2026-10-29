/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import { createSignal, createRoot, flush } from "solid-js";

// #4372: a sole text child is updated with a `.data` write on the parent's
// first child — the hot text path every app ships, which trusts that the node
// is still there. Only a streamed fragment's swap removed it from under
// Solid (the swap takes the claimed fallback's text, a rejected fragment's
// fresh render clears what the swap put in); that cold path now re-claims
// the swapped region (the hole's `reclaimRegion`, #4374), and the fast path
// stays as it is. Code outside Solid removing the node (here by hand) still
// breaks the next write: pinned as a known failure, not a contract.
test.fails("a sole text child removed by hand: the next text write has no node", () => {
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
