/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { renderToString, ssrElement, dynamic } from "@solidjs/web";

// Regression (#3382): ssrElement checked `style` and `class` before the
// nullish early-out, so a spread whose style/class resolved to undefined
// serialized as `style="" class=""` while every other attribute was omitted
// — and while the client removes the attribute for the same value.
describe("ssrElement nullish style/class (#3382)", () => {
  test("nullish style and class are omitted like any other attribute", () => {
    const html = renderToString(() =>
      ssrElement("button", { style: undefined, class: null, id: undefined }, undefined, false)
    );
    expect(html).toBe("<button></button>");
  });

  test("through a spread and through a dynamic() tag", () => {
    const props = { style: undefined, class: undefined, "data-x": "1" };
    const Button = dynamic(() => "button");
    expect(renderToString(() => <button {...props} />)).toMatch(
      /^<button( _hk=\w+)? data-x="1"><\/button>$/
    );
    expect(renderToString(() => <Button {...props} />)).toMatch(
      /^<button( _hk=\w+)? data-x="1"><\/button>$/
    );
  });

  test("present values still serialize", () => {
    const html = renderToString(() =>
      ssrElement(
        "div",
        { style: { color: "red" }, class: { a: true, b: false }, title: "" },
        undefined,
        false
      )
    );
    expect(html).toBe('<div style="color:red" class="a" title></div>');
  });

  test("skipped props leave no stray whitespace", () => {
    expect(renderToString(() => ssrElement("li", {}, "x", true))).toMatch(/^<li _hk=\w+>x<\/li>$/);
    expect(renderToString(() => ssrElement("li", { id: undefined }, "x", false))).toBe(
      "<li>x</li>"
    );
    expect(renderToString(() => ssrElement("input", { value: "v" }, undefined, true))).toMatch(
      /^<input _hk=\w+ value="v" \/>$/
    );
    // The unquoted hydration key must not swallow the void slash.
    expect(renderToString(() => ssrElement("br", {}, undefined, true))).toMatch(
      /^<br _hk=\w+ \/>$/
    );
  });
});
