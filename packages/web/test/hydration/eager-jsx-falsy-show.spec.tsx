/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3163: JSX stored eagerly in a variable and referenced by an initially
 * false `<Show>`. The server evaluates the variable (consuming hydration
 * ids 0/1) but the falsy conditional never renders it, so its markup is not
 * in the document. The client evaluates the same variable during hydration:
 * its template claim misses (dev logs the key-miss diagnostic) and a
 * detached subtree is created instead. That detached subtree must be fully
 * initialized — its dynamic inserts must materialize their initial values
 * like a client-only render — so that revealing it later produces complete
 * DOM, and downstream siblings must still hydrate in place.
 *
 * Server markup captured from renderToString of the identical component
 * (ssr generate):
 *   <button _hk=2 id="toggle">toggle</button>
 *   <pre _hk=6 id="after">after: <!--$-->0<!--/--></pre>
 */
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { createSignal, flush, enableHydration, Show } from "solid-js";
import { hydrate } from "@solidjs/web";

enableHydration();

function setupHydration() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
}

const SERVER_MARKUP =
  '<button _hk=2 id="toggle">toggle</button><pre _hk=6 id="after">after: <!--$-->0<!--/--></pre>';

describe("#3163: eager JSX hidden by an initially false <Show>", () => {
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

  test("detached eager subtree hydrates fully initialized and reveals complete", async () => {
    container.innerHTML = SERVER_MARKUP;
    const after = container.querySelector("#after")!;

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let setOpen!: (v: boolean) => void;
    let setCount!: (v: number) => void;
    try {
      dispose = hydrate(() => {
        const [count, _setCount] = createSignal(0);
        const [open, _setOpen] = createSignal(false);
        setOpen = _setOpen;
        setCount = _setCount;
        const hidden = (
          <div id="hidden">
            <h3>Hidden section</h3>
            <pre id="inside">count: {String(count())}</pre>
          </div>
        );
        return (
          <>
            <button id="toggle">toggle</button>
            <Show when={open()}>{hidden}</Show>
            <pre id="after">after: {String(count())}</pre>
          </>
        );
      }, container);
      flush();
      await new Promise(r => setTimeout(r, 10));
      flush();

      // Downstream siblings hydrate in place despite the dropped fragment:
      // the server allocated the same ids for it.
      expect(container.querySelector("#after")).toBe(after);
      expect(after.textContent).toBe("after: 0");

      // The claim miss is reported (dev diagnostic for the eager-JSX shape).
      expect(warn.mock.calls.some(args => String(args[0]).includes("Hydration key miss"))).toBe(
        true
      );
    } finally {
      warn.mockRestore();
    }

    // Reveal: the detached subtree must arrive fully initialized — static
    // parts AND dynamic inserts.
    setOpen(true);
    flush();
    const inside = container.querySelector("#inside")!;
    expect(inside).toBeTruthy();
    expect(inside.textContent).toBe("count: 0");
    expect(container.querySelector("#hidden")!.textContent).toBe("Hidden sectioncount: 0");

    // Bindings are wired: later updates flow into both subtrees.
    setCount(1);
    flush();
    expect(inside.textContent).toBe("count: 1");
    expect(after.textContent).toBe("after: 1");
  });

  test("toggling back and forth keeps the revealed subtree intact", () => {
    container.innerHTML = SERVER_MARKUP;

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let setOpen!: (v: boolean) => void;
    try {
      dispose = hydrate(() => {
        const [count] = createSignal(0);
        const [open, _setOpen] = createSignal(false);
        setOpen = _setOpen;
        const hidden = (
          <div id="hidden">
            <h3>Hidden section</h3>
            <pre id="inside">count: {String(count())}</pre>
          </div>
        );
        return (
          <>
            <button id="toggle">toggle</button>
            <Show when={open()}>{hidden}</Show>
            <pre id="after">after: {String(count())}</pre>
          </>
        );
      }, container);
      flush();
    } finally {
      warn.mockRestore();
    }

    setOpen(true);
    flush();
    const hidden = container.querySelector("#hidden")!;
    expect(hidden.textContent).toBe("Hidden sectioncount: 0");

    setOpen(false);
    flush();
    expect(container.querySelector("#hidden")).toBeNull();

    setOpen(true);
    flush();
    expect(container.querySelector("#hidden")!.textContent).toBe("Hidden sectioncount: 0");
  });
});
