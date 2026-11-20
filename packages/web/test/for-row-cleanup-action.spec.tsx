/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4165 let a removed <For> row's cleanup write; invoking an action from the
// same cleanup is the same imperative act and must not be rejected as a call
// in the list's owned scope.
import { afterEach, expect, test } from "vitest";
import { action, createSignal, flush, For, onCleanup, onSettled, resetErrorHalt } from "solid-js";
import { render } from "../src/index.js";

afterEach(() => resetErrorHalt());

for (const [label, register] of [
  ["onSettled cleanup", (fn: () => void) => onSettled(() => fn)],
  ["onCleanup", (fn: () => void) => onCleanup(fn)]
] as const)
  test(`a row's ${label} can call an action when the row is removed`, async () => {
    const [rows, setRows] = createSignal([1, 2]);
    const [released, setReleased] = createSignal<number[]>([]);
    const release = action(function* (n: number) {
      yield Promise.resolve();
      setReleased(r => [...r, n]);
    });
    function Row(props: { n: number }) {
      register(() => void release(props.n));
      return <i>{props.n}</i>;
    }
    const div = document.createElement("div");
    const dispose = render(() => <For each={rows()}>{n => <Row n={n} />}</For>, div);
    flush();
    expect(div.textContent).toBe("12");
    setRows([2]);
    flush();
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(div.textContent).toBe("2");
    expect(released()).toEqual([1]);
    setRows([2, 3]);
    flush();
    expect(div.textContent).toBe("23");
    dispose();
  });
