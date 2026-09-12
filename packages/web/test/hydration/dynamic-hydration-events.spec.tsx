/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test, beforeEach } from "vitest";
import { enableHydration } from "solid-js";
import { Dynamic, hydrate } from "@solidjs/web";

enableHydration();

// Compiled JSX calls runHydrationEvents() after an element carrying handlers.
// dynamic() binds handlers through spread(), so without the same call a click
// the hydration script queued for a <Dynamic> is never replayed.
describe("#3386: dynamic() replays events queued during hydration", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    if (dispose) {
      dispose();
      dispose = undefined;
    }
    container.innerHTML = "";
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
  });

  test("a click queued before hydration reaches the handler", async () => {
    // Server output for the tree below, captured from renderToString
    container.innerHTML = "<div _hk=0><button _hk=20 >hi</button></div>";

    // Queue the click the way the hydration script does: a real event that
    // reached the server-rendered element before its handlers existed.
    const button = container.querySelector("button")!;
    button.addEventListener(
      "click",
      event => (globalThis as any)._$HY.events.push([button, event]),
      { capture: true, once: true }
    );
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    let clicks = 0;
    dispose = hydrate(
      () => (
        <div>
          <Dynamic component="button" onClick={() => clicks++}>
            hi
          </Dynamic>
        </div>
      ),
      container
    );

    await new Promise(r => setTimeout(r, 50));
    expect(clicks).toBe(1);
  });
});
