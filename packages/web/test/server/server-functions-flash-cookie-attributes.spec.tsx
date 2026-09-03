/**
 * The attributes the flash cookie is written with — the half of the no-JS
 * leg the browser enforces, and the half nothing in this package can
 * observe once it is wrong.
 *
 * What rides this cookie is not a status line: it is the SUBMISSION. A
 * no-JS login form flashes `input` verbatim, so the user's password sits in
 * the value as plaintext JSON. The codec is deliberate about that being
 * plaintext (flash.ts: "The payload is plain JSON rather than the wire
 * codec") and confidentiality is the caller's, but plaintext raises the bar
 * on the three attributes that decide WHO the browser hands it back to and
 * FOR HOW LONG, and today the encoder sets none of them:
 *
 *   - No `SameSite`, so a cross-site form post's outcome is stored and
 *     replayed by the ordinary defaults an app never sees.
 *   - No `Max-Age` and no `Expires`, so it is a SESSION cookie at `Path=/`:
 *     it is attached to every subsequent request to the origin — scripts,
 *     images, fonts — and lands in access and CDN logs, for as long as the
 *     browser lives. Clearing it is delegated to the integration
 *     (`clearFlashCookie`, cookies.ts), and no integration is required to
 *     exist; an app that reads the cookie by hand keeps it forever.
 *   - No `__Host-` prefix, though this codebase knows the prefix well
 *     enough to refuse cookies that break it (cookies.ts
 *     `assertServableCookie`). Without host-locking, a sibling subdomain
 *     can toss a `Domain`-scoped `flash` at the app; `parseCookieHeader` is
 *     last-wins, so the tossed one can displace the real outcome and the
 *     app renders an attacker's "result" as its own. `clearFlashCookie`
 *     carries no `Domain`, so a tossed cookie is never cleared either — the
 *     prefix closes both, which is why it is the fix rather than a
 *     domain-guessing clear.
 *
 * The prefix is not free: `__Host-` requires `Secure`, so the flash never
 * reaches a plain-http origin other than localhost. The encoder already
 * hardcodes `secure: true`, so that is the status quo, not a regression.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { describe, expect, it } from "vitest";
import {
  FLASH_COOKIE,
  clearFlashCookie,
  decodeFlashCookie,
  encodeFlashCookie
} from "@solidjs/web/server-functions/server";

/** The attribute list of a Set-Cookie value, lowercased for matching. */
function attributesOf(setCookie: string) {
  return setCookie
    .split(";")
    .slice(1)
    .map(part => part.trim().toLowerCase());
}

function hasAttribute(setCookie: string, name: string) {
  return attributesOf(setCookie).some(part => part === name || part.startsWith(`${name}=`));
}

/** A no-JS login post, as the encoder receives it. */
function loginOutcome() {
  const form = new FormData();
  form.set("email", "ada@example.com");
  form.set("password", "correct-horse-battery-staple");
  return encodeFlashCookie("/_server/log-in", { welcome: "Ada" }, [form]);
}

describe("the flash cookie is written so the browser can bound it", () => {
  it("names a SameSite, so a cross-site post's outcome is not stored unasked", () => {
    const cookie = loginOutcome();
    expect(attributesOf(cookie)).toContain("httponly"); // the one it does set
    expect(hasAttribute(cookie, "samesite")).toBe(true);
  });

  it("carries a lifetime, so an unread outcome does not ride the whole session", () => {
    // the value the browser would keep sending: it is the submission, in
    // the clear, on every request to the origin including assets
    const cookie = loginOutcome();
    expect(decodeURIComponent(cookie)).toContain("correct-horse-battery-staple");
    expect(hasAttribute(cookie, "max-age") || hasAttribute(cookie, "expires")).toBe(true);
  });

  it("is host-locked, so a sibling subdomain cannot toss one at the app", () => {
    // evil.app.example sets `flash=...; Domain=app.example; Path=/` and the
    // app receives TWO entries of the same name. Last-wins is not the bug —
    // it is the RFC's own reading and cannot be legislated away in the
    // parser, which sees one header and cannot tell the entries apart:
    const shadowed = decodeFlashCookie(
      `${FLASH_COOKIE}=${encodeURIComponent(JSON.stringify({ url: "/x", result: "ours" }))}; ` +
        `${FLASH_COOKIE}=${encodeURIComponent(JSON.stringify({ url: "/x", result: "theirs" }))}`
    );
    expect(shadowed?.result).toBe("theirs");

    // so the collision has to be made impossible upstream, and the platform
    // already has the mechanism: `__Host-` forbids `Domain`, which locks a
    // sibling's cookie to the sibling and leaves exactly one entry here.
    // The same prefix is what makes `clearFlashCookie`'s Domain-less clear
    // complete rather than partial.
    expect(FLASH_COOKIE.toLowerCase().startsWith("__host-")).toBe(true);
  });

  it("is cleared by a cookie the browser will actually accept for that name", () => {
    // the prefix rules apply to the DELETION Set-Cookie too: a `__Host-`
    // name without `Secure` is rejected on arrival with no trace (#3138),
    // so the clear silently fails and the outcome haunts the next request
    const clear = clearFlashCookie();
    expect(clear.startsWith(`${FLASH_COOKIE}=`)).toBe(true);
    expect(hasAttribute(clear, "path")).toBe(true);
    expect(hasAttribute(clear, "max-age")).toBe(true);
    expect(hasAttribute(clear, "secure")).toBe(true);
  });
});
