/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { expect, it } from "vitest";
import { createEffect, createSignal, createTrackedEffect, flush, onSettled } from "solid-js";
import { render } from "../src/index.js";

async function settle() {
  flush();
  await Promise.resolve();
  flush();
}

it("a tracked effect re-runs for a write another effect makes on its first run", async () => {
  const log: number[] = [];
  function C() {
    const [s, setS] = createSignal(0);
    createEffect(
      () => 1,
      () => {
        setS(1);
      }
    );
    createTrackedEffect(() => {
      log.push(s());
    });
    return null;
  }
  const dispose = render(() => <C />, document.createElement("div"));
  await settle();
  expect(log).toEqual([0, 1]);
  dispose();
});

it("a tracked effect re-runs for a prop the parent's onSettled writes", async () => {
  const log: number[] = [];
  function Child(props: { v: number }) {
    createTrackedEffect(() => {
      log.push(props.v);
    });
    return null;
  }
  function Parent() {
    const [s, setS] = createSignal(0);
    onSettled(() => {
      setS(1);
    });
    return <Child v={s()} />;
  }
  const dispose = render(() => <Parent />, document.createElement("div"));
  await settle();
  expect(log).toEqual([0, 1]);
  dispose();
});
