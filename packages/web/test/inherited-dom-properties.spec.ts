/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { createRoot, flush } from "solid-js";
import { spread, style } from "../src/client.js";
import { ssrElement, ssrStyle } from "../src/server.js";

describe("inherited DOM properties", () => {
  test("style objects ignore inherited enumerable declarations consistently with SSR", () => {
    const value = Object.assign(Object.create({ color: "red" }), { display: "block" });
    const element = document.createElement("div");

    expect(ssrStyle(value)).toBe("display:block");

    style(element, { color: "blue" });
    style(element, value);

    expect(element.style.display).toBe("block");
    expect(element.style.color).toBe("");
  });

  test("spread props ignore inherited enumerable attributes consistently with SSR", () => {
    const ref = vi.fn();
    const props = Object.assign(Object.create({ title: "inherited", children: "inherited", ref }), {
      "data-own": "present"
    });
    const element = document.createElement("div");

    expect(ssrElement("div", props, undefined, false).t).not.toContain("title");

    const dispose = createRoot(dispose => {
      spread(element, props);
      return dispose;
    });
    flush();

    expect(element.getAttribute("data-own")).toBe("present");
    expect(element.hasAttribute("title")).toBe(false);
    expect(element.textContent).toBe("");
    expect(ref).not.toHaveBeenCalled();
    dispose();
  });
});
