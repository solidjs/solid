/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 */
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { createSignal, Show, flush, enableHydration } from "solid-js";
import { hydrate } from "@solidjs/web";

enableHydration();

function setupHydration() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
}

describe("Show fallback hydration toggle", () => {
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

  test("Show with fallback: toggling after hydration updates DOM", async () => {
    let setShow!: (v: boolean | ((p: boolean) => boolean)) => void;

    container.innerHTML = "fallback branch";

    dispose = hydrate(() => {
      const [show, _setShow] = createSignal(false);
      setShow = _setShow;

      return (
        <Show when={show()} fallback={"fallback branch"}>
          show branch
        </Show>
      );
    }, container);

    await new Promise(r => setTimeout(r, 50));
    expect(container.textContent).toBe("fallback branch");

    setShow(true);
    flush();
    expect(container.textContent).toBe("show branch");

    setShow(false);
    flush();
    expect(container.textContent).toBe("fallback branch");
  });

  test("Show with fallback inside div: toggling after hydration updates DOM", async () => {
    let setShow!: (v: boolean | ((p: boolean) => boolean)) => void;

    container.innerHTML = '<div _hk="0">fallback branch</div>';

    dispose = hydrate(() => {
      const [show, _setShow] = createSignal(false);
      setShow = _setShow;

      return (
        <div>
          <Show when={show()} fallback={"fallback branch"}>
            show branch
          </Show>
        </div>
      );
    }, container);

    await new Promise(r => setTimeout(r, 50));
    expect(container.textContent).toBe("fallback branch");

    setShow(true);
    flush();
    expect(container.textContent).toBe("show branch");
  });

  test("Show with fallback inside div (component-returned fragment)", async () => {
    let setShow!: (v: boolean | ((p: boolean) => boolean)) => void;

    function Home() {
      const [show, _setShow] = createSignal(false);
      setShow = _setShow;
      return (
        <>
          <Show when={show()} fallback={"fallback branch"}>
            show branch
          </Show>
          <button onClick={() => setShow(prev => !prev)}>click me</button>
        </>
      );
    }

    container.innerHTML = '<div _hk="0">fallback branch<button _hk="33">click me</button></div>';

    dispose = hydrate(() => {
      return (
        <div>
          <Show when={false} fallback={<Home />}>
            other content
          </Show>
        </div>
      );
    }, container);

    await new Promise(r => setTimeout(r, 50));
    expect(container.textContent).toContain("fallback branch");
    expect(container.textContent).toContain("click me");

    setShow(true);
    flush();
    expect(container.textContent).toContain("show branch");
    expect(container.textContent).toContain("click me");
  });
});
