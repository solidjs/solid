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
import { redirect, reload, isHref, HREF, REVALIDATE_HEADER } from "../../src/response.js";

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

describe("composed response headers refuse rather than overflow (#3131)", () => {
  // A value past a receiver's limit makes the WHOLE response unreadable —
  // nginx's proxy_buffer_size is one 4-8 KiB page for the entire upstream
  // header block — so the caller gets a socket-level parse error on a
  // mutation that already committed. Truncation is not an option for
  // either value (a cut target is a different address; a cut key list is
  // a silently stale cache), so the helpers refuse with something the
  // author can read. The bound sits at the producers, which run inside
  // the function body: the returned AND thrown spellings both land on the
  // ordinary error path, nothing new escapes dispatch.
  it("redirect() refuses a target past the bound, legibly", () => {
    const target = "/search?q=" + "x".repeat(8000);
    expect(() => redirect(target)).toThrow(/8010 characters[\s\S]*different address/);
    // ...and passes one at the bound
    const atLimit = "/p" + "x".repeat(4094);
    expect(redirect(atLimit).headers.get("Location")).toBe(atLimit);
  });

  it("counts the ENCODED length — percent-encoding inflation is what hits the wire", () => {
    // ~1500 cyrillic chars: under the bound raw, 3x past it encoded
    expect(() => redirect("/" + "п".repeat(1500))).toThrow(/characters/);
  });

  it("refuses a revalidate list past the bound, naming the remedy", () => {
    const keys = Array.from({ length: 300 }, (_, i) => `orders:tenant-42:list:page-${i}`);
    // ~28 chars * 300 keys ≈ 8.7 KB — frenzzy measured the 8 KiB proxy
    // ceiling at 261 keys of this exact shape: a bulk edit, not pathology
    expect(() => reload({ revalidate: keys })).toThrow(/coarser keys|Split the invalidation/);
    expect(() => redirect("/done", { revalidate: keys })).toThrow(/refuses rather than trims/);

    // an ordinary invalidation rides the header untouched
    const ordinary = reload({ revalidate: ["orders", "orders:list"] });
    expect(ordinary.headers.get(REVALIDATE_HEADER)).toBe("orders,orders:list");
  });
});
