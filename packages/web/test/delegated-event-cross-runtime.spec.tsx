/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { render } from "@solidjs/web";
import * as runtimeA from "../src/client.js";
// A second module instance of the runtime: same code, separate module-level
// state (`delegatedContainers`, `delegatedEvents`). Stands in for a second
// bundle of the same major on one page — a third-party custom element, a
// devtools panel — and, since the wire contract is frozen, for a future
// major nested in this one.
// @ts-expect-error -- the query suffix is what makes Vite hand back a fresh instance
import * as runtimeB from "../src/client.js?copy=2";

// A faithful copy of `solid-js@1`'s delegated walker (dom-expressions
// `client.js`, `eventHandler`). v1 attaches this to `document` for every
// delegated type it has seen, keys handlers as `$$<type>`, and consults
// nothing else on the event. It cannot be told to skip an element; the only
// way to keep it away from our handlers is a key it does not look for.
function v1EventHandler(e: any) {
  let node = e.target;
  const key = `$$${e.type}`;
  const oriTarget = e.target;
  const oriCurrentTarget = e.currentTarget;
  const retarget = (value: any) =>
    Object.defineProperty(e, "target", { configurable: true, value });
  const handleNode = () => {
    const handler = node[key];
    if (handler && !node.disabled) {
      const data = node[`${key}Data`];
      data !== undefined ? handler.call(node, data, e) : handler.call(node, e);
      if (e.cancelBubble) return;
    }
    node.host &&
      typeof node.host !== "string" &&
      !node.host._$host &&
      node.contains(e.target) &&
      retarget(node.host);
    return true;
  };
  const walkUpTree = () => {
    while (handleNode() && (node = node._$host || node.parentNode || node.host));
  };
  Object.defineProperty(e, "currentTarget", {
    configurable: true,
    get() {
      return node || document;
    }
  });
  if (e.composedPath) {
    const path = e.composedPath();
    retarget(path[0]);
    for (let i = 0; i < path.length - 2; i++) {
      node = path[i];
      if (!handleNode()) break;
      if (node._$host) {
        node = node._$host;
        walkUpTree();
        break;
      }
      if (node.parentNode === oriCurrentTarget) break;
    }
  } else walkUpTree();
  retarget(oriTarget);
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function mountV1Walker(types: string[]) {
  for (const type of types) document.addEventListener(type, v1EventHandler);
  cleanups.push(() => {
    for (const type of types) document.removeEventListener(type, v1EventHandler);
  });
}

function container(parent: Node = document.body) {
  const el = document.createElement("div");
  parent.appendChild(el);
  cleanups.push(() => el.remove());
  return el;
}

describe("delegated events beside a Solid 1 runtime", () => {
  test("compiled handlers are keyed off the v1 `$$` namespace", () => {
    const root = container();
    const dispose = render(() => <button onClick={() => {}} />, root);
    cleanups.push(dispose);
    const button = root.firstElementChild as any;

    expect(typeof button._$$click).toBe("function");
    expect(button.$$click).toBeUndefined();
  });

  test("a v1 document listener does not re-fire v2 handlers (light DOM)", () => {
    mountV1Walker(["click"]);
    const handler = vi.fn();
    const root = container();
    const dispose = render(() => <button onClick={handler} />, root);
    cleanups.push(dispose);

    (root.firstElementChild as HTMLButtonElement).click();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("a v1 document listener does not re-fire v2 handlers inside an open shadow root", () => {
    mountV1Walker(["click"]);
    const handler = vi.fn();
    const host = container();
    const shadow = host.attachShadow({ mode: "open" });
    const dispose = render(() => <button onClick={handler} />, shadow);
    cleanups.push(dispose);

    (shadow.firstElementChild as HTMLButtonElement).click();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("v2 does not fire v1 handlers rendered inside its root", () => {
    mountV1Walker(["click"]);
    const v1Handler = vi.fn();
    const v2Handler = vi.fn();
    const root = container();
    const dispose = render(
      () => (
        <div onClick={v2Handler}>
          <div ref={el => ((el as any).$$click = v1Handler)} />
        </div>
      ),
      root
    );
    cleanups.push(dispose);

    (root.firstElementChild!.firstElementChild as HTMLElement).click();

    // v1's own document walker fires it once; our walk passes over it.
    expect(v1Handler).toHaveBeenCalledTimes(1);
    expect(v2Handler).toHaveBeenCalledTimes(1);
  });
});

describe("delegated events across two runtime instances", () => {
  test("the two instances share no module state", () => {
    expect(runtimeA).not.toBe(runtimeB);
    expect(runtimeA.render).not.toBe(runtimeB.render);
  });

  test("a root from one instance nested in a root from the other dispatches once each", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const outerRoot = container();

    const outerEl = document.createElement("div");
    runtimeA.addEvent(outerEl, "click", outer, true);
    runtimeA.delegateEvents(["click"]);
    cleanups.push(runtimeA.render(() => outerEl, outerRoot));

    const innerRoot = document.createElement("div");
    outerEl.appendChild(innerRoot);
    const button = document.createElement("button");
    runtimeB.addEvent(button, "click", inner, true);
    runtimeB.delegateEvents(["click"]);
    cleanups.push(runtimeB.render(() => button, innerRoot));

    button.click();

    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).toHaveBeenCalledTimes(1);
    expect(inner.mock.invocationCallOrder[0]).toBeLessThan(outer.mock.invocationCallOrder[0]);
  });

  test("stopPropagation in the inner instance stops the outer instance", () => {
    const outer = vi.fn();
    const outerRoot = container();

    const outerEl = document.createElement("div");
    runtimeA.addEvent(outerEl, "click", outer, true);
    runtimeA.delegateEvents(["click"]);
    cleanups.push(runtimeA.render(() => outerEl, outerRoot));

    const innerRoot = document.createElement("div");
    outerEl.appendChild(innerRoot);
    const button = document.createElement("button");
    runtimeB.addEvent(button, "click", (e: Event) => e.stopPropagation(), true);
    runtimeB.delegateEvents(["click"]);
    cleanups.push(runtimeB.render(() => button, innerRoot));

    button.click();

    expect(outer).not.toHaveBeenCalled();
  });

  test("the outer instance still fires its handlers above the inner root", () => {
    // The inner walk stops at its own boundary; the outer walk resumes from
    // there. Handlers stamped by the outer instance *above* the inner root
    // must fire; nothing below it belongs to the outer instance.
    const seenCurrentTargets: EventTarget[] = [];
    const above = vi.fn((e: Event) => seenCurrentTargets.push(e.currentTarget!));
    const outerRoot = container();

    const wrapper = document.createElement("section");
    const above1 = document.createElement("div");
    runtimeA.addEvent(above1, "click", above, true);
    runtimeA.delegateEvents(["click"]);
    wrapper.appendChild(above1);
    cleanups.push(runtimeA.render(() => wrapper, outerRoot));

    const innerRoot = document.createElement("div");
    above1.appendChild(innerRoot);
    const button = document.createElement("button");
    runtimeB.addEvent(button, "click", () => {}, true);
    runtimeB.delegateEvents(["click"]);
    cleanups.push(runtimeB.render(() => button, innerRoot));

    button.click();

    expect(above).toHaveBeenCalledTimes(1);
    expect(seenCurrentTargets).toEqual([above1]);
  });
});
