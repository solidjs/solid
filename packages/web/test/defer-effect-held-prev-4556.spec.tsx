/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { expect, it } from "vitest";
import { createEffect, createMemo, createSignal, flush, Loading, Show } from "solid-js";
import { render } from "@solidjs/web";

// #4556: a held mount lands at its commit as if it had mounted then (D-13,
// D-3). A deferred effect skips its first run (#4543), but its first value is
// still the `prev` its next pass receives, as on a plain mount.
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function mountChild(held: boolean) {
  const prevs: unknown[] = [];
  const runs: unknown[] = [];
  const [path, setPath] = createSignal("a");
  const matched = createMemo(() => {
    const p = path();
    return p === "a" || !held ? p : wait(10).then(() => p);
  });
  let bump!: (v: number) => void;
  function Child() {
    const [local, setLocal] = createSignal(1);
    createEffect(
      (prev?: number) => (prevs.push(prev), local()),
      (v, prev) => void runs.push([v, prev]),
      { defer: true }
    );
    bump = setLocal;
    return <p>B</p>;
  }
  const el = document.createElement("div");
  const dispose = render(
    () => (
      <Loading fallback="root">
        <Show when={matched() === "b"} fallback={<p>A</p>}>
          <Child />
        </Show>
      </Loading>
    ),
    el
  );
  setPath("b");
  flush();
  await wait(80);
  flush();
  const text = el.textContent;
  bump(2);
  flush();
  dispose();
  // The last compute's `prev`: earlier passes differ between the paths
  // (a held mount's pass re-runs at the hold), the pass after the write does not.
  return { text, lastPrev: prevs[prevs.length - 1], runs };
}

it("control: a deferred effect's next pass sees its first value on a plain mount", async () => {
  expect(await mountChild(false)).toEqual({ text: "B", lastPrev: 1, runs: [[2, undefined]] });
});

it("a deferred effect's next pass sees its first value on a held mount (#4556)", async () => {
  expect(await mountChild(true)).toEqual({ text: "B", lastPrev: 1, runs: [[2, undefined]] });
});
