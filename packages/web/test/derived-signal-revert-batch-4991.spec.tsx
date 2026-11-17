/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import { createSignal, flush } from "solid-js";
import { render } from "../src/index.js";

// #4991: a binding reading a plain signal and a derived writable signal
// misses the derived write when the plain one is reverted in the same batch.
test("a binding shows a derived signal's write after another source reverts", () => {
  const [a, setA] = createSignal(false);
  const [b, setB] = createSignal<boolean>(() => false);
  const root = document.body.appendChild(document.createElement("div"));
  const dispose = render(() => <div id="el" data-a={String(a())} data-b={String(b())} />, root);
  const el = root.querySelector("#el")!;
  setA(true);
  setA(false);
  setB(true);
  flush();
  expect(b()).toBe(true);
  expect(el.getAttribute("data-b")).toBe("true");
  expect(el.getAttribute("data-a")).toBe("false");
  dispose();
  root.remove();
});
