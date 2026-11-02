/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { expect, it } from "vitest";
import { createMemo, createSignal, createTrackedEffect, flush, onSettled } from "solid-js";
import { render } from "../src/index.js";

async function settle() {
  flush();
  await Promise.resolve();
  flush();
}

it("a tracked effect re-runs for a prop the parent's onSettled writes, read through a memo (#4606)", async () => {
  const log: number[] = [];
  function Child(props: { v: number }) {
    const m = createMemo(() => props.v + 1);
    createTrackedEffect(() => {
      log.push(m());
    });
    return null;
  }
  function Parent() {
    const [s, setS] = createSignal(99);
    onSettled(() => {
      setS(100);
    });
    return <Child v={s()} />;
  }
  const dispose = render(() => <Parent />, document.createElement("div"));
  await settle();
  expect(log).toEqual([100, 101]);
  dispose();
});
