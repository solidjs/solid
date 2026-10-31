/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { expect, it } from "vitest";
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  flush,
  Loading,
  Show
} from "solid-js";
import { render } from "@solidjs/web";

// #4543: `defer: true` skips the effect's first run. An effect created in a
// subtree that a held update mounts is still in its first run when the hold
// commits; its source never changed, so the commit must not run it.
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function mountChild(held: boolean) {
  const runs: unknown[] = [];
  const renders: unknown[] = [];
  const [path, setPath] = createSignal("a");
  const matched = createMemo(() => {
    const p = path();
    return p === "a" || !held ? p : wait(10).then(() => p);
  });
  function Child() {
    const [local, setLocal] = createSignal(1);
    const keys = createMemo(() => [local()]);
    createEffect(
      () => keys(),
      k => void runs.push(k),
      { defer: true }
    );
    createRenderEffect(
      () => keys(),
      k => void renders.push(k),
      { defer: true }
    );
    bump = setLocal;
    return <p>B</p>;
  }
  let bump!: (v: number) => void;
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
  const text = el.textContent ?? "";
  const before = [...runs, ...renders];
  bump(2);
  flush();
  dispose();
  return { text, runs: before, after: [...runs, ...renders] };
}

it("control: defer skips the first run when the mount is not held", async () => {
  expect(await mountChild(false)).toEqual({ text: "B", runs: [], after: [[2], [2]] });
});

it("defer skips the first run when the mount is held by an async memo (#4543)", async () => {
  expect(await mountChild(true)).toEqual({ text: "B", runs: [], after: [[2], [2]] });
});
