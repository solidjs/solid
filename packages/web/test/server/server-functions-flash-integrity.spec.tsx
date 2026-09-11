/**
 * THE FLASH COOKIE SLOT BELONGS TO ONE HOST.
 *
 * Encryption (#3239) makes the payload unforgeable, so this is not about the
 * contents. It is about delivery. A cookie named `flash` can be set for this
 * host by any sibling subdomain with `Domain=`, and a planted value clobbers
 * the real outcome. The clobbered value fails to decrypt, which reads as no
 * flash, so the user loses the confirmation for a mutation that already
 * committed and retries it. That is the failure #3137 and #3249 exist to
 * prevent, reached from a different direction.
 *
 * The `__Host-` prefix closes it. Browsers refuse a cookie with that name
 * unless it is `Secure` and `Path=/` and carries no `Domain`, and `Domain` is
 * the attribute that lets another host write this slot.
 *
 * Like the other server-function specs, these run against the built bundles.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  FLASH_COOKIE,
  clearFlashCookie,
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

function hasDomain(setCookie: string) {
  return attributesOf(setCookie).some(attribute => /^domain=/i.test(attribute));
}

function withKey() {
  (globalThis as any).__SOLID_SECRET__ = "spec-deployment-key";
}

afterEach(() => {
  delete (globalThis as any).__SOLID_SECRET__;
});

describe("the flash cookie slot is host-locked", () => {
  it("is named for the prefix the browser enforces", () => {
    expect(FLASH_COOKIE).toBe("__Host-flash");
  });

  it("is written with every attribute the prefix requires, and no Domain", async () => {
    withKey();
    const cookie = (await encodeFlashCookie("/checkout", { receipt: "RCPT-1" }, []))!;
    expect(cookie).not.toBeNull();
    expect(cookie.startsWith(`${FLASH_COOKIE}=`)).toBe(true);
    // Miss any one of these and the browser discards the whole Set-Cookie.
    // There is no response error and no console line.
    expect(hasAttribute(cookie, "Secure")).toBe(true);
    expect(hasAttribute(cookie, "Path=/")).toBe(true);
    expect(hasAttribute(cookie, "HttpOnly")).toBe(true);
    expect(hasDomain(cookie)).toBe(false);
  });

  it("is cleared under the same rules, so the deletion is not refused", () => {
    const clear = clearFlashCookie();
    expect(clear.startsWith(`${FLASH_COOKIE}=`)).toBe(true);
    expect(hasAttribute(clear, "Secure")).toBe(true);
    expect(hasAttribute(clear, "Path=/")).toBe(true);
    expect(hasAttribute(clear, "Max-Age=0")).toBe(true);
    // A refused deletion leaves the cookie riding every later request.
    expect(hasDomain(clear)).toBe(false);
  });

  it("is detected by the name it is written under", async () => {
    withKey();
    const cookie = (await encodeFlashCookie("/save", "ok", []))!;
    expect(hasFlashCookie(pairOf(cookie))).toBe(true);
    // The unprefixed name a sibling host could have written is not ours.
    expect(hasFlashCookie("flash=planted")).toBe(false);
    expect(hasFlashCookie("other=1")).toBe(false);
  });
});
