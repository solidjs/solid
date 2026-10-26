/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import { action, createSignal, enableHydration } from "solid-js";
import { hydrate } from "@solidjs/web";

enableHydration();

// #4285: each replayed event is its own instant, as it would have been live.
// Two clicks queued before hydration must bump an action-driven counter twice.
test("#4285: replayed events each flush before the next runs", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
  container.innerHTML = "<p _hk=0>0</p><button _hk=2>+</button>";
  const button = container.querySelector("button")!;
  const record = (event: Event) => (globalThis as any)._$HY.events.push([button, event]);
  button.addEventListener("click", record, true);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  button.removeEventListener("click", record, true);

  const dispose = hydrate(() => {
    const [n, setN] = createSignal(0);
    const bump = action(function* () {
      setN(n() + 1);
    });
    return (
      <>
        <p>{n()}</p>
        <button onClick={() => bump()}>+</button>
      </>
    );
  }, container);

  await new Promise(r => setTimeout(r, 50));
  expect(container.querySelector("p")!.textContent).toBe("2");
  dispose();
  container.remove();
});
