/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 */

import { describe, expect, test, vi } from "vitest";
import {
  createSignal,
  createResource,
  enableScheduling,
  useTransition,
  startTransition,
  For
} from "../../src/index.js";
import { getSuspenseContext, Transition } from "../../src/reactive/signal.js";
import { createStore, reconcile } from "../../store/src/index.js";
import { render, Suspense } from "../src/index.js";

describe("#4728 pending transition store retention", () => {
  test("Transition.sources stays bounded while suspense transition is pending", async () => {
    enableScheduling(null as any);
    getSuspenseContext();

    const div = document.createElement("div");
    const [key, setKey] = createSignal(0);
    const [state, setState] = createStore({
      data: [
        { symbol: "A", value: 0 },
        { symbol: "B", value: 0 }
      ]
    });
    const [pending, start] = useTransition();
    let resolveResource!: (v: string) => void;

    function Child() {
      const [resource] = createResource(key, id =>
        id === 0
          ? Promise.resolve("ready")
          : new Promise<string>(resolve => {
              resolveResource = resolve;
            })
      );
      return (
        <>
          {resource()}
          <For each={state.data}>
            {row => (
              <For each={["symbol", "value"]}>{column => () => (row as any)[column]}</For>
            )}
          </For>
        </>
      );
    }

    const dispose = render(() => {
      return (
        <Suspense fallback="loading">
          <Child />
        </Suspense>
      );
    }, div);

    await Promise.resolve();
    await Promise.resolve();

    const transition = start(() => setKey(1));
    await vi.waitFor(() => expect(pending()).toBe(true));

    for (let step = 1; step <= 300; step++) {
      void startTransition(() =>
        setState(
          "data",
          reconcile(
            [
              { symbol: step % 2 ? "A" : "B", value: step },
              { symbol: step % 2 ? "C" : "D", value: step }
            ],
            { key: "symbol" }
          )
        )
      );
      await new Promise(r => setImmediate(r));
    }

    const sources = Transition?.sources.size ?? -1;
    const disposed = Transition?.disposed.size ?? -1;
    expect(pending()).toBe(true);
    expect(sources).toBeGreaterThan(0);
    // Live store leaves + computations only — must not grow with update count.
    expect(sources).toBeLessThan(100);
    expect(disposed).toBeLessThan(100);

    resolveResource("done");
    await transition;
    dispose();
  });
});
