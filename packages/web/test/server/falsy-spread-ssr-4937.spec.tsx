/**
 * @jsxImportSource @solidjs/web
 */
// #4937 on the server: a spread that evaluates to a falsy value contributes no
// props, on a component and on an element.
import { test, expect } from "vitest";
import { createSignal } from "solid-js";
import { renderToString } from "@solidjs/web";

function Child(props: { k?: number }) {
  return <i>{props.k ?? "none"}</i>;
}

test("#4937 SSR: a falsy reactive spread renders no props", () => {
  const [on] = createSignal(false);
  const html = renderToString(() => (
    <div>
      <Child {...(on() && { k: 1 })} />
      <b {...(on() && { title: "x" })}>hi</b>
    </div>
  ));
  expect(html).toMatch(/<i[^>]*>none<\/i>/);
  expect(html).toMatch(/<b[^>]*>hi<\/b>/);
  expect(html).not.toContain("title");
});
