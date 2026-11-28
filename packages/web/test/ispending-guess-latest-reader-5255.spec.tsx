/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #5255: an input change under a guess wakes the guess's `isPending` probes,
// not a rendered async memo that reads `latest()` of it: that memo's input is
// still the guess, so it starts no second request (F-6), also when it reads
// another value the post holds.
import { test, expect } from "vitest";
import {
  Loading,
  action,
  createMemo,
  createOptimistic,
  createSignal,
  flush,
  isPending,
  latest,
  refresh
} from "solid-js";
import { render } from "../src/index.js";
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test("a latest()-only async memo under Loading keeps its request for the guess (#5255)", async () => {
  const asks: { key: string; finish: (n: number) => void }[] = [];
  const ask = (key: string) => new Promise<number>(finish => asks.push({ key, finish }));
  const answer = async (key: string, value: number) => {
    const i = asks.findIndex(a => a.key === key);
    expect(i, key).toBeGreaterThanOrEqual(0);
    asks.splice(i, 1)[0].finish(value);
    await tick();
  };
  const container = document.createElement("div");
  let post!: () => void, change!: () => void;
  const dispose = render(() => {
    const [sel, setSel] = createSignal(3);
    const [data, setData] = createOptimistic(() => ask("input:" + sel()));
    const detail = createMemo(() => ask("detail:" + latest(data)));
    change = () => setSel(1);
    post = action(function* () {
      setData(9);
      yield ask("post");
    });
    return (
      <Loading fallback="loading">
        <span>
          {sel()}:{data()}
        </span>
        <span>/{detail()}</span>
        <span>/{String(isPending(data))}</span>
      </Loading>
    );
  }, container);
  try {
    await answer("input:3", 4);
    await answer("detail:4", 40);
    expect(container.textContent).toBe("3:4/40/false");
    post();
    await tick();
    await answer("detail:9", 90);
    expect(container.textContent).toBe("3:9/90/false");
    change();
    await tick();
    // Only the input's request: the memo's input is still the guess, 9.
    expect(asks.map(a => a.key).sort()).toEqual(["input:1", "post"]);
    expect(container.textContent).toBe("3:9/90/true");
  } finally {
    dispose();
  }
});

test("a latest() memo that also reads a signal the post wrote starts no second request (#5255)", async () => {
  const asks: { key: string; finish: (n: number) => void }[] = [];
  const ask = (key: string) => new Promise<number>(finish => asks.push({ key, finish }));
  const answer = async (key: string, value: number) => {
    const i = asks.findIndex(a => a.key === key);
    expect(i, key).toBeGreaterThanOrEqual(0);
    asks.splice(i, 1)[0].finish(value);
    await tick();
  };
  const container = document.createElement("div");
  let post!: () => void, change!: () => void;
  const dispose = render(() => {
    const [sel, setSel] = createSignal(3);
    const [page, setPage] = createSignal(0);
    const [data, setData] = createOptimistic(() => ask("input:" + sel()));
    const detail = createMemo(() => ask("detail:" + latest(data) + ":" + page()));
    change = () => setSel(1);
    post = action(function* () {
      setData(9);
      setPage(1);
      yield ask("post");
      refresh(data);
    });
    return (
      <Loading fallback="loading">
        <span>
          {sel()}:{data()}
        </span>
        <span>/{detail()}</span>
        <span>/{String(isPending(data))}</span>
      </Loading>
    );
  }, container);
  try {
    await answer("input:3", 4);
    await answer("detail:4:0", 40);
    expect(container.textContent).toBe("3:4/40/false");
    post();
    await tick();
    for (const { key } of asks.filter(a => a.key.startsWith("detail:"))) await answer(key, 90);
    expect(container.textContent).toBe("3:9/90/false");
    change();
    await tick();
    expect(asks.map(a => a.key).sort()).toEqual(["input:1", "post"]);
    expect(container.textContent).toBe("3:9/90/true");
  } finally {
    dispose();
  }
});
