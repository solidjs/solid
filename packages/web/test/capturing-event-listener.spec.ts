/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { assign } from "../src/client.js";

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
});
