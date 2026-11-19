/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { afterEach, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";
import { hydrate } from "@solidjs/web";
import { generateHydrationScript } from "../../src/server.js";

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const bootstrapListeners: [string, EventListener][] = [];

function installBootstrap() {
  const add = document.addEventListener.bind(document);
  const spy = vi
    .spyOn(document, "addEventListener")
    .mockImplementation((name, listener, options) => {
      bootstrapListeners.push([name, listener as EventListener]);
      add(name, listener, options);
    });
  try {
    const script = generateHydrationScript();
    (0, eval)(script.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1]);
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => {
  for (const [name, listener] of bootstrapListeners) document.removeEventListener(name, listener);
  bootstrapListeners.length = 0;
  document.body.replaceChildren();
  delete (globalThis as any)._$HY;
});

test("#5023: a click queued in a shadow root replays after hydration", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = "<p _hk=0>0</p><button _hk=2>+</button>";
  const button = shadow.querySelector("button")!;

  installBootstrap();
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  expect((globalThis as any)._$HY.events).toHaveLength(1);
  expect((globalThis as any)._$HY.events[0][2]).toBe(button);
  const queuedEvent = (globalThis as any)._$HY.events[0][1];
  expect(queuedEvent.target).toBe(host);

  let clicks = 0;
  const dispose = hydrate(() => {
    const [count, setCount] = createSignal(0);
    return (
      <>
        <p>{count()}</p>
        <button onClick={() => (clicks++, setCount(count() + 1))}>+</button>
      </>
    );
  }, shadow);
  await tick();
  expect(clicks).toBe(1);
  expect(shadow.querySelector("p")!.textContent).toBe("1");
  expect(queuedEvent.target).toBe(host);
  dispose();
});

test("#5023: replay starts at the clicked descendant, not its hydration-key ancestor", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = "<p _hk=0>0</p><button _hk=2><span>+</span></button>";
  const span = shadow.querySelector("span")!;

  installBootstrap();
  span.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  expect((globalThis as any)._$HY.events[0][0]).toBe(shadow.querySelector("button"));
  expect((globalThis as any)._$HY.events[0][2]).toBe(span);

  let clicks = 0;
  const dispose = hydrate(() => {
    const [count, setCount] = createSignal(0);
    return (
      <>
        <p>{count()}</p>
        <button onClick={() => (clicks++, setCount(count() + 1))}>
          <span>+</span>
        </button>
      </>
    );
  }, shadow);
  await tick();
  expect(clicks).toBe(1);
  expect(shadow.querySelector("p")!.textContent).toBe("1");
  dispose();
});
