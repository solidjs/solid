/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import { flush } from "solid-js";
import { render, Portal } from "../src/index.js";

// #4852: the `_$host` getter on a portal's nodes was the slot's own closure.
// V8 shares the descriptor array that holds an accessor between nodes of the
// same shape, so after the portal was disposed a live node of that shape kept
// the closure, and through it the portal's content, reachable. Every tagged
// node now shares one getter; the slot's accessor lives on the node.
test("portal nodes share one host getter that still answers each portal's host", () => {
  const outlet = document.createElement("div");
  const a = document.body.appendChild(document.createElement("div"));
  const b = document.body.appendChild(document.createElement("div"));
  const disposeA = render(
    () => (
      <Portal mount={outlet}>
        <p>a</p>
      </Portal>
    ),
    a
  );
  const disposeB = render(
    () => (
      <Portal mount={outlet}>
        <p>b</p>
      </Portal>
    ),
    b
  );
  flush();
  const [pa, pb] = outlet.querySelectorAll("p");
  expect((pa as any)._$host).toBe(a);
  expect((pb as any)._$host).toBe(b);
  const getter = (n: Node) => Object.getOwnPropertyDescriptor(n, "_$host")!.get;
  expect(getter(pa)).toBe(getter(pb));
  disposeA();
  disposeB();
  a.remove();
  b.remove();
});
