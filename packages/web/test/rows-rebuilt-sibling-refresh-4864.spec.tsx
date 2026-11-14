/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4864: rows the guess lane rebuilds while a sibling refresh is out bind
// `intoDoing` as it shows (D-34 ¶3, F-1). The signals version is
// packages/signals/tests/rows-rebuilt-sibling-refresh-4864.test.ts.
import { test, expect } from "vitest";
import { For, action, createMemo, createSignal, createOptimistic, flush, refresh } from "solid-js";
import { render } from "../src/index.js";
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
test("rows rebuilt while a sibling refresh is out read a memo without the action's guess", async () => {
  const fl: Record<string, ((v: any) => void)[]> = {};
  const ask = (k: string) => new Promise<any>(r => (fl[k] ??= []).push(r));
  const land = (k: string, v: any) => {
    const rs = fl[k];
    fl[k] = [];
    rs.forEach(r => r(structuredClone(v)));
  };
  const c = document.body.appendChild(document.createElement("div"));

  const [todoAns] = createSignal<any>(() => ask("todo"), { loadingValue: null } as any);
  const [doingAns] = createSignal<any>(() => ask("doing"), { loadingValue: null } as any);
  const [moving, guessMoving] = createOptimistic<number[]>(() => []);
  const todoRows = createMemo(() => {
    const a = todoAns();
    return a == null
      ? []
      : a.filter((id: number) => !moving().includes(id)).map((id: number) => ({ id }));
  });
  const doingRows = createMemo(() => {
    const a = doingAns();
    return a == null ? null : [...a, ...moving()];
  });
  const doingUp = createMemo(() => doingRows() != null); // a second reader of doingRows
  const intoDoing = createMemo(() => doingRows() != null && doingRows()!.length < 3);
  const reask = action(function* () {
    refresh(todoAns);
    refresh(doingAns);
  });
  const move = action(function* (id: number) {
    guessMoving(ms => [...ms, id]);
    yield ask("move");
    yield reask(); // a nested action
  });
  render(
    () => (
      <div>
        <For each={todoRows()}>{(r: any) => <button disabled={!intoDoing()}>{r.id}</button>}</For>
        <p>{doingUp() ? "up" : "down"}</p>
        <p>
          doing={String(doingRows()?.length)} into={String(intoDoing())}
        </p>
      </div>
    ),
    c
  );
  const state = () =>
    `${[...c.querySelectorAll("button")].map(b => b.textContent + (b.disabled ? "x" : "")).join(",")} ${c.querySelectorAll("p")[1].textContent}`;

  land("doing", [3, 4]);
  land("todo", [1, 2, 5]);
  await tick();
  expect(state()).toBe("1,2,5 doing=2 into=true");
  move(5);
  await tick();
  expect(state()).toBe("1x,2x doing=3 into=false");
  land("move", {});
  await tick();
  expect(state()).toBe("1x,2x doing=3 into=false");
  land("todo", [1, 2, 5]);
  await tick(); // doing's re-ask is still out
  expect(state()).toBe("1x,2x doing=3 into=false");
  land("doing", [3, 4, 5]);
  await tick();
  expect(state()).toBe("1x,2x,5x doing=3 into=false");
});
