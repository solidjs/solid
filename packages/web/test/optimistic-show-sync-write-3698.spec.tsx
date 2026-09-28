/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { action, createOptimistic, createSignal, flush, isPending, latest, Show } from "solid-js";
import { render } from "../src/index.js";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function snapshot(container: HTMLElement) {
  return Array.from(container.querySelectorAll("p"))
    .map(p => p.textContent)
    .join(" | ");
}

describe("#3698 sync write beside a visible optimistic value in <Show>", () => {
  test("the write publishes while the action stays open", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let run!: () => void;

    function App() {
      const [optimistic, setOptimistic] = createOptimistic(false);
      const [drag, setDrag] = createSignal(false);
      const move = action(function* () {
        setOptimistic(true);
        yield new Promise<void>(() => {});
      });
      run = () => {
        void move();
        setTimeout(() => setDrag(true), 0);
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
    flush();
    expect(snapshot(container)).toBe(
      "optimistic: false | drag: false | latest: false | pending: false"
    );

    run();
    await sleep(20);
    expect(snapshot(container)).toBe(
      "optimistic: true | drag: true | latest: true | pending: false"
    );

    dispose();
    container.remove();
  });
});
