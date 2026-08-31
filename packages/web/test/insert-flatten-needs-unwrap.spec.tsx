/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3133 at the DOM layer: flattenArray losing `needsUnwrap` when a
 * function-free fragment follows an accessor in the same children array made
 * `normalize` hand `insertExpression` a plain array with the raw memo still
 * inside — `appendNodes` then threw `Failed to execute 'insertBefore' on
 * 'Node': parameter 1 is not of type 'Node'`. The issue was reported against
 * universal renderers on the belief that web's insertExpression had a
 * function branch protecting it; that branch is 1.x dom-expressions — 2.0
 * crashes identically.
 */
import { expect, test } from "vitest";
import { createMemo, flush } from "solid-js";
import { render } from "../src/index.js";

test("accessor followed by a fragment inside one children array renders (#3133)", () => {
  const container = document.createElement("div");
  function App() {
    const label = createMemo(() => "from memo");
    const children = [label, ["a", "b"]];
    return <div>{children}</div>;
  }
  const dispose = render(() => <App />, container);
  flush();
  expect(container.textContent).toBe("from memoab");
  dispose();
});
