/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4165: a row's cleanup that writes a signal when a keyed <For> removes the
// row. What it may write goes by the phase it belongs to: the documented
// `onSettled(() => () => …)` cleanup belongs to the effect phase and writes
// freely; an `onCleanup` in the component body belongs to the component's
// computation, so its write is an owned write. Either way the row is removed
// and the list keeps updating.
import { afterEach, expect, test } from "vitest";
import { createSignal, flush, For, onCleanup, onSettled, resetErrorHalt } from "solid-js";
import { render } from "../src/index.js";

afterEach(() => resetErrorHalt());

for (const [label, register, owned] of [
  ["onSettled cleanup can write a signal", (fn: () => void) => onSettled(() => fn), false],
  ["onCleanup that writes a signal is an owned write", (fn: () => void) => onCleanup(fn), true]
] as const)
  test(`a row's ${label} when the row is removed`, () => {
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
    if (owned) expect(() => flush()).toThrow(/REACTIVE_WRITE_IN_OWNED_SCOPE/);
    else flush();
    expect(div.textContent).toBe("2");
    expect(count()).toBe(owned ? 0 : 1);
    setRows([2, 3]);
    flush();
    expect(div.textContent).toBe("23");
    // (The rows still mounted have the same cleanup.)
    if (owned) expect(dispose).toThrow(/REACTIVE_WRITE_IN_OWNED_SCOPE/);
    else dispose();
  });
