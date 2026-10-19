/** @jsxImportSource @solidjs/web */
import { afterEach, beforeEach, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRenderEffect, createSignal, flush, onHydrationEnd, runWithOwner } from "solid-js";
import { hydrate, render } from "@solidjs/web";
import {
  deferredApp,
  deferredModuleApp,
  sequentialDeferredModuleApp
} from "../harness/deferred-hydration.jsx";

const artifact = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../harness/__artifacts__/deferred-hydration.json"
    ),
    "utf8"
  )
) as {
  shell: string;
  other: { shell: string };
  streamed: { shell: string; chunks: string[] };
  module: { shell: string };
  handledModule: { shell: string };
  nestedModule: { shell: string };
  sequentialModule: { shell: string };
};
let container: HTMLDivElement;
let dispose: (() => void) | undefined;

function applyChunk(target: HTMLElement, html: string, first = true) {
  const scripts: string[] = [];
  const markup = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/g, (_, s) => {
    scripts.push(s);
    return "";
  });
  if (first) target.innerHTML = markup;
  else target.insertAdjacentHTML("beforeend", markup);
  for (const script of scripts) (0, eval)(script);
}
function mount() {
  applyChunk(container, artifact.shell);
}
async function settle() {
  await Promise.resolve();
  flush();
  await new Promise(resolve => setTimeout(resolve, 0));
  flush();
}

beforeEach(() => {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await settle();
  container.remove();
  delete (globalThis as any)._$HY;
});

test("holds exact SSR nodes, preserves context, and replays one queued click on the late claim", async () => {
  mount();
  const button = container.querySelector("button")!;
  const nested = container.querySelector("span")!;
  const sibling = container.querySelector("aside")!;
  const entered: string[] = [];
  let clicks = 0;
  let settled = 0;
  let ended = 0;
  const [ready, setReady] = createSignal(false);
  const [nestedReady, setNestedReady] = createSignal(false);
  const App = deferredApp({
    ready,
    nestedReady,
    entered: n => entered.push(n),
    clicked: () => clicks++,
    settled: () => settled++
  });
  // The generated bootstrap queues the nearest keyed template root, not an
  // unkeyed descendant. The original event still targets the button.
  button.addEventListener(
    "click",
    event => (globalThis as any)._$HY.events.push([button.closest("[_hk]"), event]),
    {
      capture: true,
      once: true
    }
  );
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  dispose = hydrate(() => <App />, container);
  onHydrationEnd(() => ended++);
  await settle();
  expect(entered).toEqual([]);
  expect(settled).toBe(1);
  expect(ended).toBe(0);
  expect(container.querySelector("button")).toBe(button);
  expect(container.querySelector("aside")).toBe(sibling);
  expect(clicks).toBe(0);

  setReady(true);
  await settle();
  expect(entered).toEqual(["outer"]);
  expect(container.querySelectorAll("button")).toHaveLength(1);
  expect(container.querySelector("button")).toBe(button);
  expect(button.textContent).toBe("preserved context");
  expect(clicks).toBe(1);
  expect(ended).toBe(0);
  expect(container.querySelector("span")).toBe(nested);

  setNestedReady(true);
  await settle();
  expect(entered).toEqual(["outer", "nested"]);
  expect(container.querySelector("span")).toBe(nested);
  expect(nested.textContent).toBe("nested context: preserved context");
  expect(ended).toBe(1);
  setReady(false);
  setNestedReady(false);
  await settle();
  button.click();
  expect(clicks).toBe(2);
  expect(container.querySelector("button")).toBe(button);
  expect(entered).toEqual(["outer", "nested"]);
});

test("a late claim uses its original registry after another root hydrates", async () => {
  mount();
  const button = container.querySelector("button")!;
  const [ready, setReady] = createSignal(false);
  const App = deferredApp({ ready });
  dispose = hydrate(() => <App />, container);
  await settle();
  const otherContainer = document.createElement("div");
  document.body.appendChild(otherContainer);
  let disposeOther: (() => void) | undefined;
  try {
    applyChunk(otherContainer, artifact.other.shell);
    const otherButton = otherContainer.querySelector("button")!;
    const Other = deferredApp({ ready: () => true });
    disposeOther = hydrate(() => <Other />, otherContainer, { renderId: "other" });
    await settle();
    expect(otherContainer.querySelector("button")).toBe(otherButton);
    setReady(true);
    await settle();
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.querySelector("button")).toBe(button);
    expect(otherContainer.querySelectorAll("button")).toHaveLength(1);
    expect(otherContainer.querySelector("button")).toBe(otherButton);
  } finally {
    disposeOther?.();
    otherContainer.remove();
  }
});

test("claims an async native Loading fragment delivered while its outer gate is held", async () => {
  applyChunk(container, artifact.streamed.shell);
  const [ready, setReady] = createSignal(false);
  const App = deferredApp({ ready, async: true });
  let ended = 0;
  dispose = hydrate(() => <App />, container);
  onHydrationEnd(() => ended++);
  await settle();
  expect(ended).toBe(0);
  expect(container.textContent).toContain("native pending");
  for (const chunk of artifact.streamed.chunks) {
    applyChunk(container, chunk, false);
    await settle();
  }
  // The parser-delivered fragment may remain parked until its native Loading
  // owner claims it. Capture whichever real SSR nodes have already revealed.
  const deliveredButton =
    container.querySelector("button") ??
    Array.from(container.querySelectorAll("template"))
      .map(template => template.content.querySelector("button"))
      .find(button => button !== null);
  expect(deliveredButton).toBeTruthy();
  setReady(true);
  await settle();
  await settle();
  expect(container.querySelectorAll("button")).toHaveLength(1);
  expect(container.querySelector("button")).toBe(deliveredButton);
  expect(container.textContent).toContain("async content");
  expect(container.textContent).not.toContain("native pending");
  expect(container.querySelectorAll("template")).toHaveLength(0);
  expect(ended).toBe(1);
});

test("an initially open gate claims the server nodes without a deferred pass", async () => {
  mount();
  const button = container.querySelector("button")!;
  const span = container.querySelector("span")!;
  const [ready, setReady] = createSignal(true);
  const entered: string[] = [];
  let ended = 0;
  const App = deferredApp({ ready, entered: n => entered.push(n) });
  dispose = hydrate(() => <App />, container);
  onHydrationEnd(() => ended++);
  await settle();
  expect(entered).toEqual(["outer", "nested"]);
  expect(container.querySelector("button")).toBe(button);
  expect(container.querySelector("span")).toBe(span);
  expect(ended).toBe(1);
  setReady(false);
  await settle();
  expect(entered).toEqual(["outer", "nested"]);
  expect(container.querySelector("button")).toBe(button);
});

test("disposing an unopened boundary releases its hold and a later gate cannot mount it", async () => {
  mount();
  const [ready, setReady] = createSignal(false);
  const entered: string[] = [];
  const App = deferredApp({ ready, entered: n => entered.push(n) });
  let ended = 0;
  dispose = hydrate(() => <App />, container);
  onHydrationEnd(() => ended++);
  await settle();
  expect(ended).toBe(0);
  dispose();
  dispose = undefined;
  await settle();
  expect(ended).toBe(1);
  setReady(true);
  await settle();
  expect(entered).toEqual([]);
});

test("a queued activation cannot revive a boundary disposed before its microtask", async () => {
  mount();
  const [ready, setReady] = createSignal(false);
  const entered: string[] = [];
  const App = deferredApp({ ready, entered: name => entered.push(name) });
  let ended = 0;
  dispose = hydrate(() => <App />, container);
  onHydrationEnd(() => ended++);
  await settle();
  setReady(true);
  // The user effect queues the claim; it does not run the claim in this flush.
  flush();
  expect(entered).toEqual([]);
  dispose();
  dispose = undefined;
  await settle();
  expect(entered).toEqual([]);
  expect(ended).toBe(1);
});

test("a client-only mount renders its fallback, then activates exactly once", async () => {
  const [ready, setReady] = createSignal(false);
  const entered: string[] = [];
  let cleaned = 0;
  const App = deferredApp({ ready, entered: n => entered.push(n), disposed: () => cleaned++ });
  dispose = render(() => <App />, container);
  expect(container.textContent).toContain("client fallback");
  expect(entered).toEqual([]);
  setReady(true);
  await settle();
  expect(entered).toEqual(["outer", "nested"]);
  expect(container.querySelector("button")!.textContent).toBe("preserved context");
  setReady(false);
  await settle();
  expect(entered).toEqual(["outer", "nested"]);
  expect(cleaned).toBe(0);
  dispose();
  dispose = undefined;
  expect(cleaned).toBe(1);
});

test("an error during a late claim reaches its native boundary and releases hydration", async () => {
  mount();
  const [ready, setReady] = createSignal(false);
  const error = new Error("activation failed");
  let caught: unknown;
  let ended = 0;
  const App = deferredApp({
    ready,
    fail: () => {
      throw error;
    },
    failed: e => {
      caught = e;
    }
  });
  dispose = hydrate(() => <App />, container);
  onHydrationEnd(() => ended++);
  await settle();
  expect(caught).toBeUndefined();
  expect(ended).toBe(0);
  setReady(true);
  await settle();
  expect(caught).toBe(error);
  expect(container.textContent).toBe("activation failed");
  expect(ended).toBe(1);
});

test("claims retained SSR after a client-only module settles beyond gate activation", async () => {
  applyChunk(container, artifact.module.shell);
  const button = container.querySelector("button")!;
  const sibling = container.querySelector("aside")!;
  const [ready, setReady] = createSignal(false);
  let resolveModule!: () => void;
  const module = new Promise<void>(resolve => {
    resolveModule = resolve;
  });
  let entered = 0;
  let cleaned = 0;
  let clicks = 0;
  const App = deferredModuleApp({
    ready,
    module,
    entered: () => entered++,
    disposed: () => cleaned++,
    clicked: () => clicks++
  });
  dispose = hydrate(() => <App />, container);
  await settle();
  expect(entered).toBe(0);
  expect(container.querySelector("button")).toBe(button);

  setReady(true);
  await settle();
  expect(entered).toBe(0);
  expect(button.isConnected).toBe(true);
  expect(container.querySelector("aside")).toBe(sibling);

  resolveModule();
  await settle();
  await settle();
  expect(entered).toBe(1);
  expect(container.querySelectorAll("button")).toHaveLength(1);
  expect(container.querySelector("button")).toBe(button);
  expect(container.querySelector("aside")).toBe(sibling);
  button.click();
  expect(clicks).toBe(1);
  dispose();
  dispose = undefined;
  expect(cleaned).toBe(1);
});

test("disposing a pending client-only module releases hydration and prevents a late claim", async () => {
  applyChunk(container, artifact.module.shell);
  const button = container.querySelector("button")!;
  const [ready, setReady] = createSignal(false);
  let resolveModule!: () => void;
  const module = new Promise<void>(resolve => {
    resolveModule = resolve;
  });
  let entered = 0;
  let moduleCleaned = 0;
  let ended = 0;
  const App = deferredModuleApp({
    ready,
    module,
    entered: () => entered++,
    moduleDisposed: () => moduleCleaned++
  });
  dispose = hydrate(() => <App />, container);
  onHydrationEnd(() => ended++);
  setReady(true);
  await settle();
  expect(button.isConnected).toBe(true);
  expect(entered).toBe(0);
  expect(ended).toBe(0);
  dispose();
  dispose = undefined;
  await settle();
  expect(moduleCleaned).toBe(1);
  expect(ended).toBe(1);
  const remainingNodes = Array.from(container.childNodes);
  resolveModule();
  await settle();
  await settle();
  expect(entered).toBe(0);
  expect(moduleCleaned).toBe(1);
  expect(ended).toBe(1);
  expect(Array.from(container.childNodes)).toEqual(remainingNodes);
});

test("a pending module rejection reaches Errored without blocking the following hydration sibling", async () => {
  applyChunk(container, artifact.module.shell);
  const button = container.querySelector("button")!;
  const sibling = container.querySelector("aside")!;
  const [ready, setReady] = createSignal(false);
  let rejectModule!: (error: unknown) => void;
  const module = new Promise<void>((_, reject) => {
    rejectModule = reject;
  });
  const failure = new Error("client module failed");
  let caught: unknown;
  let entered = 0;
  let moduleCleaned = 0;
  let clicks = 0;
  let ended = 0;
  const App = deferredModuleApp({
    ready,
    module,
    entered: () => entered++,
    moduleDisposed: () => moduleCleaned++,
    failed: error => {
      caught = error;
    },
    followingClicked: () => clicks++
  });
  dispose = hydrate(() => <App />, container);
  onHydrationEnd(() => ended++);
  setReady(true);
  await settle();
  expect(button.isConnected).toBe(true);
  expect(caught).toBeUndefined();
  expect(ended).toBe(0);
  rejectModule(failure);
  await settle();
  await settle();
  expect(caught).toBe(failure);
  expect(container.querySelector("p")!.textContent).toBe("module failed");
  expect(entered).toBe(0);
  // Errored retains the failed content's owner so reset can retry it.
  expect(moduleCleaned).toBe(0);
  expect(ended).toBe(1);
  expect(container.querySelector("aside")).toBe(sibling);
  sibling.click();
  expect(clicks).toBe(1);
  dispose();
  dispose = undefined;
  expect(moduleCleaned).toBe(1);
});

test("a claimed boundary uses its authored Loading fallback when explicitly re-armed", async () => {
  applyChunk(container, artifact.module.shell);
  const button = container.querySelector("button")!;
  const sibling = container.querySelector("aside")!;
  const [ready, setReady] = createSignal(false);
  const [reloadKey, setReloadKey] = createSignal(0);
  const initialModule = Promise.resolve();
  const [moduleRequest, setModuleRequest] = createSignal(initialModule);
  let resolveReload!: () => void;
  const reload = new Promise<void>(resolve => {
    resolveReload = resolve;
  });
  let clicks = 0;
  let ended = 0;
  const App = deferredModuleApp({
    ready,
    module: initialModule,
    moduleRequest,
    reloadKey,
    clicked: () => clicks++
  });
  dispose = hydrate(() => <App />, container);
  onHydrationEnd(() => ended++);
  setReady(true);
  await settle();
  await settle();
  expect(container.querySelector("button")).toBe(button);
  expect(ended).toBe(1);

  setModuleRequest(reload);
  setReloadKey(1);
  await settle();
  expect(container.querySelector("p")!.textContent).toBe("module pending");
  expect(container.querySelector("aside")).toBe(sibling);

  resolveReload();
  await settle();
  await settle();
  expect(container.querySelector("p")).toBeNull();
  expect(container.querySelectorAll("button")).toHaveLength(1);
  expect(container.querySelector("button")!.textContent).toBe("module content");
  container.querySelector("button")!.click();
  expect(clicks).toBe(1);
  expect(ended).toBe(1);
});

test("an inner handled error cannot retire an independent pending sibling's claim", async () => {
  applyChunk(container, artifact.handledModule.shell);
  const button = container.querySelector("button")!;
  const sibling = container.querySelector("aside")!;
  const [ready, setReady] = createSignal(false);
  let resolveModule!: () => void;
  const module = new Promise<void>(resolve => {
    resolveModule = resolve;
  });
  const failure = new Error("handled child failed");
  let caught: unknown;
  let entered = 0;
  let ended = 0;
  const App = deferredModuleApp({
    ready,
    module,
    entered: () => entered++,
    handledFailure: () => {
      throw failure;
    },
    handledFailed: error => {
      caught = error;
    }
  });
  dispose = hydrate(() => <App />, container);
  onHydrationEnd(() => ended++);
  setReady(true);
  await settle();
  expect(caught).toBe(failure);
  expect(entered).toBe(0);
  expect(ended).toBe(0);
  expect(button.isConnected).toBe(true);

  resolveModule();
  await settle();
  await settle();
  expect(entered).toBe(1);
  expect(container.querySelector("button")).toBe(button);
  expect(container.querySelector("aside")).toBe(sibling);
  expect(container.textContent).toContain("inner failed");
  expect(ended).toBe(1);
});

test("an outer error retires a hidden pending claim inside an inner Errored", async () => {
  applyChunk(container, artifact.nestedModule.shell);
  const button = container.querySelector("button")!;
  const sibling = container.querySelector("aside")!;
  const [ready, setReady] = createSignal(false);
  const [fail, setFail] = createSignal(false);
  // This module remains unresolved throughout the error fallback and teardown.
  const module = new Promise<void>(() => {});
  const failure = new Error("outer child failed");
  let caught: unknown;
  let entered = 0;
  let ended = 0;
  let clicks = 0;
  const App = deferredModuleApp({
    ready,
    module,
    entered: () => entered++,
    followingClicked: () => clicks++,
    outerFailure: () => {
      if (fail()) throw failure;
    },
    failed: error => {
      caught = error;
    }
  });
  dispose = hydrate(() => <App />, container);
  onHydrationEnd(() => ended++);
  setReady(true);
  await settle();
  expect(button.isConnected).toBe(true);
  expect(entered).toBe(0);
  expect(ended).toBe(0);

  setFail(true);
  await settle();
  await settle();
  expect(caught).toBe(failure);
  expect(container.querySelector("p")!.textContent).toBe("module failed");
  expect(entered).toBe(0);
  expect(ended).toBe(1);
  expect(container.querySelector("aside")).toBe(sibling);
  sibling.click();
  expect(clicks).toBe(1);
});

test("nested deferred claims retain one button through two sequential client module loads", async () => {
  applyChunk(container, artifact.sequentialModule.shell);
  const button = container.querySelector("button")!;
  const sibling = container.querySelector("aside")!;
  const markers = Array.from(container.querySelectorAll("[data-module-id]"));
  const ids = markers.map(marker => marker.getAttribute("data-module-id"));
  const buttonId = button.id;
  expect(button.textContent).toBe("dynamic nested0");
  const [ready, setReady] = createSignal(false);
  const [nestedReady, setNestedReady] = createSignal(false);
  let resolveOuter!: () => void;
  let resolveInner!: () => void;
  const outerModule = new Promise<void>(resolve => {
    resolveOuter = resolve;
  });
  const innerModule = new Promise<void>(resolve => {
    resolveInner = resolve;
  });
  const entered: string[] = [];
  const settled: string[] = [];
  let clicks = 0;
  let ended = 0;
  const App = sequentialDeferredModuleApp({
    ready,
    nestedReady,
    outerModule,
    innerModule,
    entered: name => entered.push(name),
    settled: name => settled.push(name),
    clicked: () => clicks++
  });
  dispose = hydrate(() => <App />, container);
  onHydrationEnd(() => ended++);
  await settle();
  expect(entered).toEqual([]);

  // One interaction can resolve both intents before either browser module loads.
  setReady(true);
  setNestedReady(true);
  await settle();
  expect(entered).toEqual(["outer"]);
  expect(container.querySelector("button")).toBe(button);
  expect(button.textContent).toBe("dynamic nested0");
  expect(ended).toBe(0);

  resolveOuter();
  await settle();
  await settle();
  expect(entered).toEqual(["outer", "inner"]);
  expect(container.querySelector("button")).toBe(button);
  expect(button.textContent).toBe("dynamic nested0");
  expect(ended).toBe(0);

  resolveInner();
  await settle();
  await settle();
  expect(container.querySelectorAll("button")).toHaveLength(1);
  expect(container.querySelector("button")).toBe(button);
  expect(button.textContent).toBe("dynamic nested0");
  expect(button.id).toBe(buttonId);
  expect(button.getAttribute("data-context")).toBe("preserved context");
  expect(Array.from(container.querySelectorAll("[data-module-id]"))).toEqual(markers);
  expect(markers.map(marker => marker.getAttribute("data-module-id"))).toEqual(ids);
  expect(container.querySelector("aside")).toBe(sibling);
  expect(settled).toEqual(["outer", "inner"]);
  expect(ended).toBe(1);
  button.click();
  await settle();
  expect(clicks).toBe(1);
  expect(button.textContent).toBe("dynamic nested1");
  expect(container.querySelector("button")).toBe(button);
  expect(ended).toBe(1);
});

test("ownerless render effects remain usable while a deferred claim is pending", async () => {
  mount();
  const button = container.querySelector("button")!;
  const [ready, setReady] = createSignal(false);
  const App = deferredApp({ ready });
  let ended = 0;
  dispose = hydrate(() => <App />, container);
  onHydrationEnd(() => ended++);
  await settle();
  expect(ended).toBe(0);

  const outside = document.createElement("p");
  // A constant ownerless effect has no subscriptions or cleanup to retain.
  // It must use the ordinary render path while another tree claims SSR DOM.
  runWithOwner(null, () => {
    createRenderEffect(
      () => "outside the deferred tree",
      value => {
        outside.textContent = value;
      }
    );
  });
  expect(outside.textContent).toBe("outside the deferred tree");
  expect(container.querySelector("button")).toBe(button);
  expect(ended).toBe(0);

  setReady(true);
  await settle();
  expect(container.querySelector("button")).toBe(button);
  expect(ended).toBe(1);
});
