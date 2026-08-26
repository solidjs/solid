/**
 * @vitest-environment node
 *
 * `redirect()` with Href-branded values: the brand slot doubles as the
 * logical-path channel. A router's typed path node stringifies to its
 * *display* href (a hash router renders `#/page1`) for use in anchors,
 * while the brand slot carries the routable pathname — redirect() must
 * put the logical path in Location, not the display form. A legacy
 * `true`-branded Href keeps coercing through String().
 */
import { describe, expect, it } from "vitest";
import { redirect, isHref, HREF } from "../../src/response.js";

const displayHref = (logical, display) => ({
  [HREF]: logical,
  toString: () => display
});

describe("redirect() Href handling", () => {
  it("prefers the logical path carried in the brand slot", () => {
    const node = displayHref("/page1", "#/page1");
    expect(isHref(node)).toBe(true);
    const res = redirect(node);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/page1");
  });

  it("falls back to string coercion for a `true`-branded Href", () => {
    const legacy = { [HREF]: true, toString: () => "/somewhere" };
    const res = redirect(legacy);
    expect(res.headers.get("Location")).toBe("/somewhere");
  });

  it("leaves plain string urls untouched", () => {
    expect(redirect("/plain").headers.get("Location")).toBe("/plain");
  });

  it("still rejects unbranded objects", () => {
    expect(() => redirect({ toString: () => "/sneaky" })).toThrow(TypeError);
  });
});
