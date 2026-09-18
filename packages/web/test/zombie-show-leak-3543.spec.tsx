/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #3543: a <Show> condition's nested memo leaks one subscription per update
// while an unrelated action is parked, and the leak survives the action.
import { expect, test } from "vitest";
import { DEV, Show, action, createSignal, flush, getOwner } from "solid-js";
import { render } from "../src/index.js";

test("Show condition subscriptions stay bounded while an unrelated action is parked", async () => {
  const div = document.createElement("div");
  let setN!: (v: number) => void;
  let subscribers!: () => number;
  let hold!: () => Promise<void>;
  let release: () => void = () => {};

  const dispose = render(() => {
    const [n, _setN] = createSignal(0, { name: "counter" });
    setN = _setN;
    const [held, setHeld] = createSignal(false);
    const counter = DEV!.getSignals(getOwner()!).find((s: any) => s._name === "counter")!;
    subscribers = () => DEV!.getObservers(counter).length;
    hold = action(function* () {
      setHeld(true);
      yield new Promise<void>(r => (release = r));
    }) as () => Promise<void>;
    return (
      <>
        <span>{String(held())}</span>
        <Show when={n() > 0 && n() < 2}>Visible</Show>
      </>
    );
  }, div);
  flush();

  const alternate = (times: number) => {
    for (let i = 0; i < times; i++) {
      setN(i % 2);
      flush();
    }
  };

  alternate(40);
  const control = subscribers();

  const completion = hold();
  flush();
  alternate(40);
  expect(subscribers()).toBe(control);

  release();
  await completion;
  flush();
  alternate(40);
  expect(subscribers()).toBe(control);

  dispose();
});
