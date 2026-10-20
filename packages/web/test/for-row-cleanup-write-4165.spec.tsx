/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4165: removing a keyed <For> row ran the row's cleanups inside the list's
// pass, so a setter in a cleanup was rejected as a write in an owned scope and
// halted reactivity in development. Cleanups now run with no owner.
import { afterEach, expect, test } from "vitest";
import { createSignal, flush, For, onCleanup, onSettled, resetErrorHalt } from "solid-js";
import { render } from "../src/index.js";

afterEach(() => resetErrorHalt());

for (const [label, register] of [
  ["onSettled cleanup", (fn: () => void) => onSettled(() => fn)],
  ["onCleanup", (fn: () => void) => onCleanup(fn)]
] as const)
  test(`a row's ${label} can write a signal when the row is removed`, () => {
    const [rows, setRows] = createSignal([1, 2]);
    const [count, setCount] = createSignal(0);
    function Row(props: { n: number }) {
      register(() => setCount(n => n + 1));
      return <i>{props.n}</i>;
    }
    const div = document.createElement("div");
    const dispose = render(() => <For each={rows()}>{n => <Row n={n} />}</For>, div);
    flush();
    expect(div.textContent).toBe("12");
    setRows([2]);
    flush();
    expect(div.textContent).toBe("2");
    expect(count()).toBe(1);
    setRows([2, 3]);
    flush();
    expect(div.textContent).toBe("23");
    dispose();
  });
