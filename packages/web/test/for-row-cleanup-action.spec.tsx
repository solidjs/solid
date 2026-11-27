/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #5123: a row's cleanup that calls an action when a keyed <For> removes the
// row. Invoking an action is a write for the owned-scope guard, which goes by
// the phase the cleanup belongs to: an `onSettled(() => () => …)` cleanup is
// the effect phase's and may; an `onCleanup` in the component body is the
// component computation's, so the call is rejected as an owned one.
import { afterEach, expect, test } from "vitest";
import { action, createSignal, flush, For, onCleanup, onSettled, resetErrorHalt } from "solid-js";
import { render } from "../src/index.js";

afterEach(() => resetErrorHalt());

for (const [label, register, owned] of [
  ["onSettled cleanup can call an action", (fn: () => void) => onSettled(() => fn), false],
  ["onCleanup that calls an action is an owned call", (fn: () => void) => onCleanup(fn), true]
] as const)
  test(`a row's ${label} when the row is removed`, async () => {
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
    if (owned) expect(() => flush()).toThrow(/ACTION_CALLED_IN_OWNED_SCOPE/);
    else flush();
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(div.textContent).toBe("2");
    expect(released()).toEqual(owned ? [] : [1]);
    setRows([2, 3]);
    flush();
    expect(div.textContent).toBe("23");
    // (The rows still mounted have the same cleanup.)
    if (owned) expect(dispose).toThrow(/ACTION_CALLED_IN_OWNED_SCOPE/);
    else dispose();
  });
