/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { action, createOptimistic, createSignal, flush, isPending, latest, Show } from "solid-js";
import { render } from "../src/index.js";

const settle = () => new Promise<void>(r => setTimeout(r));

function snapshot(container: HTMLElement) {
  return Array.from(container.querySelectorAll("p"))
    .map(p => p.textContent)
    .join(" | ");
}

describe("#3698 sync write beside a visible optimistic value in <Show>", () => {
  test("the write publishes while the action stays open", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let run!: () => Promise<void>;

    function App() {
      const [optimistic, setOptimistic] = createOptimistic(false);
      const [drag, setDrag] = createSignal(false);
      const move = action(function* () {
        setOptimistic(true);
        yield new Promise<void>(() => {});
      });
      run = async () => {
        void move();
        await settle();
        setDrag(true);
        await settle();
      };
      return (
        <>
          <p>optimistic: {String(optimistic())}</p>
          <p>drag: {String(drag())}</p>
          <p>latest: {String(latest(drag))}</p>
          <p>pending: {String(isPending(drag))}</p>
          <Show when={optimistic() && !drag()} keyed>
            <p>Optimistic content</p>
          </Show>
        </>
      );
    }

    const dispose = render(() => <App />, container);
    try {
      flush();
      expect(snapshot(container)).toBe(
        "optimistic: false | drag: false | latest: false | pending: false"
      );

      await run();
      expect(snapshot(container)).toBe(
        "optimistic: true | drag: true | latest: true | pending: false"
      );
    } finally {
      dispose();
      container.remove();
    }
  });
});
