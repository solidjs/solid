/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { createSignal, createMemo, flush, enableHydration } from "solid-js";
import { hydrate } from "@solidjs/web";

enableHydration();

function setupHydration() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
}

describe("#2737: spread + innerHTML across hydration", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let dispose: (() => void) | undefined;

  beforeEach(async () => {
    if (dispose) dispose();
    await new Promise(r => setTimeout(r, 0));
    setupHydration();
    container.innerHTML = "";
  });

  afterEach(() => {
    if (dispose) {
      dispose();
      dispose = undefined;
    }
  });

  test("reactive spread update after hydration keeps innerHTML content", async () => {
    // Exact server output for the repro shape (captured from renderToString)
    container.innerHTML =
      '<div _hk=1 data-whatever="no" class="flex" style="color: red" >Hello world!</div>';

    let setCount!: (v: number) => void;
    dispose = hydrate(() => {
      const [count, _setCount] = createSignal(0);
      setCount = _setCount;
      const data = createMemo(() => ({ "data-whatever": count() === 1 ? "yes" : "no" }));
      return <div {...data()} class="flex" style="color: red" innerHTML="Hello world!"></div>;
    }, container);

    await new Promise(r => setTimeout(r, 50));
    const div = container.querySelector("div")!;
    expect(div.textContent).toBe("Hello world!");
    expect(div.getAttribute("data-whatever")).toBe("no");

    setCount(1);
    flush();
    await new Promise(r => setTimeout(r, 50));

    expect(div.getAttribute("data-whatever")).toBe("yes");
    expect(div.getAttribute("class")).toBe("flex");
    // The 1.x bug: content cleared on first reactive spread update post-hydration
    expect(div.textContent).toBe("Hello world!");
  });
});
