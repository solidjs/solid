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
});
