/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { createSignal, flush, enableHydration } from "solid-js";
import { hydrate } from "@solidjs/web";

enableHydration();

function setupHydration() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
}

// The insert path leaves primitives raw through normalize and materializes
// them at commit. Hydration is the exception in both directions: claiming
// must still ADOPT the server's live text node (position bookkeeping, no
// mutation), and a failed claim must keep the phantom-render semantics the
// old fresh-node allocation triggered — never leak a raw primitive into the
// tracked range.
describe("hydration text node adoption", () => {
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

  test("server text hole beside an element is adopted, then updated in place", async () => {
    let setCount!: (v: number) => void;

    container.innerHTML = '<div _hk="0"><!--$-->5<!--/--><b>sib</b></div>';
    const serverText = container.querySelector("div")!.childNodes[1];
    expect(serverText.nodeType).toBe(3);
    expect((serverText as Text).data).toBe("5");

    dispose = hydrate(() => {
      const [count, _setCount] = createSignal(5);
      setCount = _setCount;
      return (
        <div>
          {count()}
          <b>sib</b>
        </div>
      );
    }, container);

    await new Promise(r => setTimeout(r, 50));
    expect(container.textContent).toBe("5sib");
    // the server node was adopted, not replaced
    expect(container.querySelector("div")!.childNodes[1]).toBe(serverText);

    setCount(6);
    flush();
    expect(container.textContent).toBe("6sib");
    // post-hydration updates keep writing the same adopted node
    expect(container.querySelector("div")!.childNodes[1]).toBe(serverText);
    expect((serverText as Text).data).toBe("6");
  });

  test("claim mismatch (element where text expected) recovers on first update", async () => {
    let setCount!: (v: number) => void;

    // server markup disagrees with the client render: the hole holds an
    // element, the client renders a primitive. The claim pass must keep the
    // tracked range as-is (phantom semantics) and the first real update
    // reconciles to the correct content.
    container.innerHTML = '<div _hk="0"><!--$--><i>stale</i><!--/--><b>sib</b></div>';

    dispose = hydrate(() => {
      const [count, _setCount] = createSignal(0);
      setCount = _setCount;
      return (
        <div>
          {count()}
          <b>sib</b>
        </div>
      );
    }, container);

    await new Promise(r => setTimeout(r, 50));

    setCount(1);
    flush();
    expect(container.textContent).toBe("1sib");
    expect(container.querySelector("i")).toBeNull();
  });
});
