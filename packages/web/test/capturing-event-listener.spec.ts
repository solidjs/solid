/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { assign } from "../src/client.js";
import type { JSX } from "../src/index.js";

describe("capturing event listeners", () => {
  test("removes the previous non-delegated EventListenerObject when props change", () => {
    const previous = vi.fn();
    const current = vi.fn();
    const previousListener = { capture: true, handleEvent: previous };
    const currentListener = { capture: true, handleEvent: current };
    const parent = document.createElement("div");
    const child = document.createElement("span");
    const prevProps = {};
    parent.append(child);

    assign(parent, { onScroll: previousListener }, true, prevProps);
    assign(parent, { onScroll: currentListener }, true, prevProps);
    child.dispatchEvent(new Event("scroll", { bubbles: true }));

    expect(previous).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledOnce();
  });

  test("preserves removal options across object and bound tuple transitions", () => {
    const calls: string[] = [];
    const first = {
      capture: true,
      handleEvent: () => calls.push("first-object")
    };
    const tuple: JSX.BoundEventHandler<HTMLDivElement, Event> = [
      value => calls.push(value),
      "tuple"
    ];
    const second = {
      capture: true,
      handleEvent: () => calls.push("second-object")
    };
    const parent = document.createElement("div");
    const child = document.createElement("span");
    const prevProps = {};
    parent.append(child);

    assign(parent, { onScroll: first }, true, prevProps);
    assign(parent, { onScroll: tuple }, true, prevProps);
    child.dispatchEvent(new Event("scroll", { bubbles: true }));

    assign(parent, { onScroll: second }, true, prevProps);
    child.dispatchEvent(new Event("scroll", { bubbles: true }));

    assign(parent, {}, true, prevProps);
    child.dispatchEvent(new Event("scroll", { bubbles: true }));

    expect(calls).toEqual(["tuple", "second-object"]);
  });
});
