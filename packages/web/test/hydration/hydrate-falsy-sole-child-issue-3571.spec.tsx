/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Hydration variant of #3571. The server renders a sole `0` child as bare
 * text — `<span _hk=0>0</span>`, no `<!--$-->` markers — and the claim pass
 * returns the raw primitive as `current` while the server's text node stays
 * in the DOM. A post-hydration toggle to an element then hits the same
 * truthiness guards in `insertExpression` that the client-only fix covers:
 * the `0` text node was left beside the new element (`0<i>load</i>`).
 *
 * Server markup captured from renderToString of the identical component
 * (ssr generate):
 *   <span _hk=0>0</span>
 */
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { createSignal, flush, enableHydration } from "solid-js";
import { hydrate } from "@solidjs/web";

enableHydration();

function setupHydration() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
}

const SERVER_MARKUP = "<span _hk=0>0</span>";

describe("#3571: hydrated sole child of 0 toggles to an element cleanly", () => {
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

  test("server 0 text node is dropped when the hole becomes an element", async () => {
    container.innerHTML = SERVER_MARKUP;
    const span = container.querySelector("span")!;
    const serverText = span.firstChild!;
    expect(serverText.nodeType).toBe(3);

    let setLoading!: (v: boolean) => void;
    dispose = hydrate(() => {
      const [loading, _setLoading] = createSignal(false);
      setLoading = _setLoading;
      return <span>{loading() ? <i>load</i> : 0}</span>;
    }, container);

    await new Promise(r => setTimeout(r, 50));
    // The server element and its text node were adopted, not replaced.
    expect(container.querySelector("span")).toBe(span);
    expect(span.innerHTML).toBe("0");
    expect(span.firstChild).toBe(serverText);

    setLoading(true);
    flush();
    // The adopted `0` must go — not sit beside the element as `0<i>load</i>`.
    expect(span.innerHTML).toBe("<i>load</i>");
    expect(span.childNodes.length).toBe(1);

    setLoading(false);
    flush();
    expect(span.innerHTML).toBe("0");
    expect(span.childNodes.length).toBe(1);

    setLoading(true);
    flush();
    expect(span.innerHTML).toBe("<i>load</i>");
    expect(span.childNodes.length).toBe(1);
  });
});
