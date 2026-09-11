/**
 * The flash cookie's integrity, and its handling of falsy results.
 *
 * The cookie carries the outcome of a no-JS submission, and the next render
 * shows it as if the server had produced it. Nothing authenticates the
 * payload. The `__Host-` prefix is what keeps it trustworthy: browsers refuse
 * a cookie with that name unless it is `Secure`, `Path=/`, and free of
 * `Domain`, so only the exact host can set it. Without the prefix any sibling
 * subdomain could set it and forge a successful outcome.
 *
 * Runs against the built bundles like the other server-function specs.
 */
import { describe, expect, it } from "vitest";
import {
  FLASH_COOKIE,
  clearFlashCookie,
  decodeFlashCookie,
  encodeFlashCookie,
  hasFlashCookie
} from "@solidjs/web/server-functions/server";

// what the browser stores: the name=value pair, before the attributes
function pairOf(setCookie: string) {
  const end = setCookie.indexOf("; ");
  return end === -1 ? setCookie : setCookie.slice(0, end);
}

function attributesOf(setCookie: string) {
  return setCookie
    .split(";")
    .slice(1)
    .map(attribute => attribute.trim());
}

function hasAttribute(setCookie: string, expected: string) {
  return attributesOf(setCookie).some(
    attribute => attribute.toLowerCase() === expected.toLowerCase()
  );
}

describe("the flash cookie is host-locked", () => {
  it("is named for the prefix the browser enforces", () => {
    expect(FLASH_COOKIE).toBe("__Host-flash");
  });

  it("sets every attribute the prefix requires, and no Domain", () => {
    const cookie = encodeFlashCookie("/checkout", { receipt: "RCPT-1" }, []);
    expect(cookie.startsWith(`${FLASH_COOKIE}=`)).toBe(true);
    // Drop any one of these and the browser silently discards the whole
    // Set-Cookie. There is no response error and no console line.
    expect(hasAttribute(cookie, "Secure")).toBe(true);
    expect(hasAttribute(cookie, "Path=/")).toBe(true);
    expect(hasAttribute(cookie, "HttpOnly")).toBe(true);
    expect(hasAttribute(cookie, "SameSite=Lax")).toBe(true);
    // `Domain` is the attribute the prefix forbids. It is what would let a
    // sibling host write this cookie.
    expect(attributesOf(cookie).some(attribute => /^domain=/i.test(attribute))).toBe(false);
  });

  it("clears under the same rules, so the deletion is not refused", () => {
    const clear = clearFlashCookie();
    expect(clear.startsWith(`${FLASH_COOKIE}=`)).toBe(true);
    expect(hasAttribute(clear, "Secure")).toBe(true);
    expect(hasAttribute(clear, "Path=/")).toBe(true);
    expect(hasAttribute(clear, "Max-Age=0")).toBe(true);
    // A rejected deletion means the outcome is sent on every later request.
    expect(attributesOf(clear).some(attribute => /^domain=/i.test(attribute))).toBe(false);
  });

  it("detects its own cookie on the way back in", () => {
    const cookie = encodeFlashCookie("/save", "ok", []);
    expect(hasFlashCookie(pairOf(cookie))).toBe(true);
    expect(hasFlashCookie("other=1")).toBe(false);
  });
});

describe("a falsy outcome is still an outcome", () => {
  // A truthiness check on `result` reported a call that returned `false`, `0`,
  // `""`, or `null` as nothing submitted. That makes a user retry a mutation
  // that already committed.
  for (const result of [false, 0, "", null]) {
    it(`round-trips a result of ${JSON.stringify(result)}`, () => {
      const submission = decodeFlashCookie(pairOf(encodeFlashCookie("/save", result, [])))!;
      expect(submission).toBeDefined();
      expect(submission.url).toBe("/save");
      expect(submission.result).toBe(result);
      expect(submission.error).toBeUndefined();
    });
  }

  it("round-trips a thrown error with a falsy message", () => {
    const cookie = encodeFlashCookie("/save", new Error(""), [], true);
    const submission = decodeFlashCookie(pairOf(cookie))!;
    expect(submission).toBeDefined();
    expect(submission.error).toBeInstanceOf(Error);
    expect(submission.result).toBeUndefined();
  });

  it("declines a payload it did not write", () => {
    expect(decodeFlashCookie(`${FLASH_COOKIE}=${encodeURIComponent("null")}`)).toBeUndefined();
    expect(
      decodeFlashCookie(`${FLASH_COOKIE}=${encodeURIComponent('"a string"')}`)
    ).toBeUndefined();
    expect(decodeFlashCookie(`${FLASH_COOKIE}=${encodeURIComponent("{}")}`)).toBeUndefined();
    expect(decodeFlashCookie(null)).toBeUndefined();
  });
});
