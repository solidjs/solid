/**
 * @vitest-environment jsdom
 *
 * Template creation under Trusted Types.
 *
 * A page that enforces `require-trusted-types-for 'script'` rejects a plain
 * string assigned to `innerHTML`. The app hands its own policy to
 * `setTrustedTypesPolicy`, and `template()` assigns what that policy creates.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { setTrustedTypesPolicy, template } from "../src/client.js";

afterEach(() => setTrustedTypesPolicy(undefined));

describe("setTrustedTypesPolicy", () => {
  test("template() assigns the TrustedHTML the policy creates", () => {
    const assigned: unknown[] = [];
    const setter = vi.spyOn(Element.prototype, "innerHTML", "set").mockImplementation(function (
      this: HTMLTemplateElement,
      value
    ) {
      assigned.push(value);
      this.content.appendChild(document.createElement("div"));
    });
    const createHTML = vi.fn((html: string) => ({ html }));
    setTrustedTypesPolicy({ createHTML });

    template("<div>First</div>")();
    setter.mockRestore();

    expect(createHTML.mock.calls).toEqual([["<div>First</div>"]]);
    expect(assigned).toEqual([createHTML.mock.results[0].value]);
  });

  test("each template is created once", () => {
    const createHTML = vi.fn((html: string) => html);
    setTrustedTypesPolicy({ createHTML });
    const create = template("<span>Second</span>");

    expect(create().outerHTML).toBe("<span>Second</span>");
    expect(create().outerHTML).toBe("<span>Second</span>");
    expect(createHTML).toHaveBeenCalledTimes(1);
  });

  test("template() assigns the string without a policy", () => {
    expect(template("<div>First</div>")().outerHTML).toBe("<div>First</div>");
  });
});
