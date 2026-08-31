/**
 * The flash cookie's size bound (#3137). A cookie has a hard ceiling and no
 * failure signal: past ~4096 bytes of name=value the browser discards the
 * whole Set-Cookie — nothing in the response, nothing in the console,
 * nothing server-side — and the page after the no-JS redirect is
 * indistinguishable from one where nothing was submitted. The mutation has
 * already COMMITTED by then, so a vanished outcome invites the retry that
 * writes twice. The encoder degrades instead of vanishing: the input echo
 * goes first, then the value is bounded, and `url` plus the error/thrown
 * flags always survive, arriving with `truncated` set.
 *
 * Runs against the built bundles like the other server-function specs.
 */
import { describe, expect, it } from "vitest";
import { decodeFlashCookie, encodeFlashCookie } from "@solidjs/web/server-functions/server";

// what the browser stores: the name=value pair, before the attributes
function pairOf(setCookie: string) {
  return setCookie.slice(0, setCookie.indexOf("; "));
}

function roundTrip(setCookie: string) {
  return decodeFlashCookie(pairOf(setCookie));
}

describe("the flash cookie stays under the browser's ceiling", () => {
  it("passes a small outcome through whole, untruncated", () => {
    const form = new FormData();
    form.set("sku", "A-1");
    const cookie = encodeFlashCookie("/checkout", { receipt: "RCPT-1" }, [form]);
    const submission = roundTrip(cookie)!;
    expect(submission.url).toBe("/checkout");
    expect(submission.result).toEqual({ receipt: "RCPT-1" });
    expect(submission.truncated).toBeUndefined();
    expect((submission.input[0] as FormData).get("sku")).toBe("A-1");
  });

  it("drops the input echo first, keeping a result that still fits", () => {
    const form = new FormData();
    form.set("note", "x".repeat(8000)); // the submission is the bulk
    const cookie = encodeFlashCookie("/save", { id: 7, ok: true }, [form]);
    expect(pairOf(cookie).length).toBeLessThanOrEqual(4096);
    const submission = roundTrip(cookie)!;
    expect(submission.result).toEqual({ id: 7, ok: true }); // the answer survives whole
    expect(submission.input).toEqual([]); // the echo paid for it
    expect(submission.truncated).toBe(true);
  });

  it("reduces a structured result past the ceiling to the outcome flag", () => {
    // ~200 rows of the issue's shape — 29 was already past the ceiling
    const rows = Array.from({ length: 200 }, (_, i) => ({
      id: i,
      sku: `SKU-${i}`,
      name: `Product ${i}`,
      price: 19.99,
      note: "restocked"
    }));
    const cookie = encodeFlashCookie("/bulk-save", rows, []);
    expect(pairOf(cookie).length).toBeLessThanOrEqual(4096);
    const submission = roundTrip(cookie)!;
    // structured JSON has no partial spelling: what survives is THAT it
    // happened and where — the part whose loss causes the double-submit
    expect(submission.url).toBe("/bulk-save");
    expect(submission.result).toBe(true);
    expect(submission.truncated).toBe(true);
  });

  it("keeps the longest prefix of a string result that fits", () => {
    const cookie = encodeFlashCookie("/report", "line ".repeat(4000), []);
    expect(pairOf(cookie).length).toBeLessThanOrEqual(4096);
    const submission = roundTrip(cookie)!;
    expect(typeof submission.result).toBe("string");
    expect(submission.result.startsWith("line line ")).toBe(true);
    expect(submission.truncated).toBe(true);
  });

  it("a thrown outcome stays an error with a bounded message", () => {
    const failure = new Error("constraint violated: " + "detail ".repeat(3000));
    const cookie = encodeFlashCookie("/charge", failure, [], true);
    expect(pairOf(cookie).length).toBeLessThanOrEqual(4096);
    const submission = roundTrip(cookie)!;
    expect(submission.error).toBeInstanceOf(Error);
    expect((submission.error as Error).message.startsWith("constraint violated:")).toBe(true);
    expect(submission.result).toBeUndefined();
    expect(submission.truncated).toBe(true);
  });
});
