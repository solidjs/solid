/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3971: an `async` entry can run hydrate() while the parser is still inside
 * the server shell. hydrate() parks on the shell-end marker the server writes
 * after the shell (`_$HY.s[renderId] = 1; _$HY.sw(renderId)`), or on
 * DOMContentLoaded, so the shell's later nodes are claimed instead of left
 * dead beside fresh client copies.
 *
 * Server markup (renderToString of the same component):
 *   <main _hk=0><p>one</p><!--$--><button _hk=1 disabled>edit</button><!--/--></main>
 */
import { afterEach, describe, expect, test } from "vitest";
import { createSignal, enableHydration, flush } from "solid-js";
import { hydrate } from "@solidjs/web";

enableHydration();

const HEAD = "<main _hk=0><p>one</p><!--$-->";
const TAIL = "<button _hk=1 disabled>edit</button><!--/-->";

let container: HTMLDivElement;
function setup(hy: Record<string, unknown>) {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {}, ...hy };
  container = document.createElement("div");
  document.body.appendChild(container);
  Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
  container.innerHTML = HEAD;
  return container.querySelector("main")!;
}
function finishParse(main: Element) {
  main.insertAdjacentHTML("beforeend", TAIL);
}
function App(setter: (f: (n: number) => void) => void) {
  const Row = (props: { n: number }) => <button disabled={props.n === 0}>edit</button>;
  return () => {
    const [count, setCount] = createSignal(0);
    setter(setCount);
    return (
      <main>
        <p>one</p>
        <Row n={count()} />
      </main>
    );
  };
}
const tick = () => new Promise(r => setTimeout(r, 0));

afterEach(() => {
  container.remove();
  delete (document as any).readyState;
  delete (globalThis as any)._$HY;
});

describe("hydrate() started mid-parse (#3971)", () => {
  test("parks on the shell-end marker and claims the whole shell", async () => {
    const main = setup({ s: {} });
    let setCount!: (n: number) => void;
    const dispose = hydrate(
      App(f => (setCount = f)),
      container
    );
    flush();
    // Nothing claimed or created while parked.
    expect(main.querySelectorAll("button").length).toBe(0);

    finishParse(main);
    const serverButton = main.querySelector("button")!;
    // The marker script, as the server writes it after the shell.
    const hy = (globalThis as any)._$HY;
    hy.s[""] = 1;
    hy.sw && hy.sw("");
    await tick();
    flush();

    expect(main.querySelectorAll("button").length).toBe(1);
    expect(main.querySelector("button")).toBe(serverButton);
    setCount(1);
    flush();
    expect(serverButton.disabled).toBe(false);
    dispose();
  });

  test("falls back to DOMContentLoaded when no marker comes", async () => {
    const main = setup({ s: {} });
    let setCount!: (n: number) => void;
    const dispose = hydrate(
      App(f => (setCount = f)),
      container
    );
    finishParse(main);
    const serverButton = main.querySelector("button")!;
    Object.defineProperty(document, "readyState", { value: "interactive", configurable: true });
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await tick();
    flush();

    expect(main.querySelectorAll("button").length).toBe(1);
    setCount(1);
    flush();
    expect(serverButton.disabled).toBe(false);
    dispose();
  });

  test("starts at once when the marker already ran", () => {
    const main = setup({ s: { "": 1 } });
    finishParse(main);
    const serverButton = main.querySelector("button")!;
    let setCount!: (n: number) => void;
    const dispose = hydrate(
      App(f => (setCount = f)),
      container
    );
    setCount(1);
    flush();
    expect(serverButton.disabled).toBe(false);
    dispose();
  });

  test("a hand-built _$HY (no shell ledger) never parks", () => {
    const main = setup({});
    finishParse(main);
    const serverButton = main.querySelector("button")!;
    let setCount!: (n: number) => void;
    const dispose = hydrate(
      App(f => (setCount = f)),
      container
    );
    setCount(1);
    flush();
    expect(serverButton.disabled).toBe(false);
    dispose();
  });

  test("dispose before the marker cancels the parked start", async () => {
    const main = setup({ s: {} });
    const dispose = hydrate(
      App(() => {}),
      container
    );
    dispose();
    finishParse(main);
    const hy = (globalThis as any)._$HY;
    hy.s[""] = 1;
    hy.sw && hy.sw("");
    await tick();
    flush();
    // Still the untouched server node: no claim, no client copy.
    expect(main.querySelectorAll("button").length).toBe(1);
    expect(main.querySelector("button")!.disabled).toBe(true);
  });
});
