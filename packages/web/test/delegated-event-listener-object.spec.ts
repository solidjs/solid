/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { addEvent, delegateEvents, render } from "../src/client.js";

describe("delegated EventListenerObject handlers", () => {
  test("dispatches delegated events through handleEvent", () => {
    const handleEvent = vi.fn();
    const listener = { handleEvent };
    const element = document.createElement("button");
    const container = document.createElement("div");
    document.body.append(container);
    const dispose = render(() => element, container);

    try {
      addEvent(element, "click", listener, true);
      delegateEvents(["click"]);
      element.click();

      expect(handleEvent).toHaveBeenCalledOnce();
      expect(handleEvent.mock.instances[0]).toBe(listener);
      expect(handleEvent.mock.calls[0][0]).toBeInstanceOf(MouseEvent);
    } finally {
      dispose();
      container.remove();
    }
  });

  test("replaces a bound tuple without retaining its data slot", () => {
    const previous = vi.fn();
    const handleEvent = vi.fn();
    const element = document.createElement("button");
    const container = document.createElement("div");
    document.body.append(container);
    const dispose = render(() => element, container);

    try {
      addEvent(element, "click", [previous, "stale"] as any, true);
      addEvent(element, "click", { handleEvent }, true);
      delegateEvents(["click"]);
      element.click();

      expect(previous).not.toHaveBeenCalled();
      expect(handleEvent).toHaveBeenCalledOnce();
    } finally {
      dispose();
      container.remove();
    }
  });
});
