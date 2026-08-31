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

describe("redirect() non-ASCII targets (#3135)", () => {
  // `Location` is a latin1 ByteString on the wire, and the non-ASCII range
  // used to split into two failure modes: above U+00FF `Headers.set` threw
  // (masked downstream as a sanitized 500 — no redirect at all), while
  // U+0080–U+00FF rode as a raw latin1 byte that is not valid UTF-8, so a
  // real client decoded U+FFFD and followed `/café` to `/caf%EF%BF%BD`.
  it("percent-encodes a path above the latin1 range instead of throwing", () => {
    const res = redirect("/поиск");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "/%D0%BF%D0%BE%D0%B8%D1%81%D0%BA" // what new URL("/поиск", base).pathname says
    );
  });

  it("percent-encodes the latin1 range too — the silent wrong-destination half", () => {
    expect(redirect("/café").headers.get("Location")).toBe("/caf%C3%A9");
  });

  it("encodes astral code points whole, not as surrogate halves", () => {
    expect(redirect("/🎉").headers.get("Location")).toBe("/%F0%9F%8E%89");
  });

  it("passes ASCII through untouched: an already-encoded target is not double-encoded", () => {
    expect(redirect("/caf%C3%A9?q=a%20b").headers.get("Location")).toBe("/caf%C3%A9?q=a%20b");
    expect(redirect("https://example.com/path?a=1&b=2#frag").headers.get("Location")).toBe(
      "https://example.com/path?a=1&b=2#frag"
    );
  });

  it("encodes the logical path of an Href the same way", () => {
    const node = displayHref("/поиск", "#/поиск");
    expect(redirect(node).headers.get("Location")).toBe("/%D0%BF%D0%BE%D0%B8%D1%81%D0%BA");
  });
});
