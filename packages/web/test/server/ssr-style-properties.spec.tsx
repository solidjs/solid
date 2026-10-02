// A spread-free SSR `style` object with several entries compiles to
// `ssrStyleProperties(name, value, …)`. Every written entry, a computed key
// included, is separated from the one before it, and the `;` goes only between
// entries that are written, so a nullish first value leaves no leading `;`.
import { describe, expect, test } from "vitest";
import { ssrStyleProperties } from "../../src/server.js";

describe("ssrStyleProperties", () => {
  test("a nullish first value leaves no leading semicolon", () => {
    expect(ssrStyleProperties("color:", undefined, "top:", "1px")).toBe("top:1px");
  });

  test("every written entry is separated from the one before it", () => {
    expect(
      ssrStyleProperties("color:", "red", "top:", "1px", "left:", null, "margin-right:", 0)
    ).toBe("color:red;top:1px;margin-right:0");
  });

  test("no written entry is an empty value", () => {
    expect(ssrStyleProperties("color:", null, "top:", undefined)).toBe("");
  });
});
