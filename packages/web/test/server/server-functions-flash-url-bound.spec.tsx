/**
 * A FLASH COOKIE THAT CANNOT FIT IS REFUSED, NEVER TRUNCATED (#3249).
 *
 * flash.ts's degrade ladder (#3137, see
 * server-functions-flash-bounds.spec.tsx) exists because a cookie past the
 * browser's ~4096-byte ceiling is discarded WHOLE, with no signal anywhere:
 * the page after the redirect is indistinguishable from one where nothing
 * was submitted, the mutation has already committed, and the retry writes
 * twice.
 *
 * The ladder bounds two of the payload's three variable-length fields — it
 * drops `input`, it bounds `result` — and never looked at `url`, which is
 * `pathname + search` of a request the CALLER chose (`<form
 * action={fn.url + "?return=" + here}>` is the convention's own idiom). A
 * long enough url put the payload past the ceiling with everything else
 * already spent, and the encoder emitted a cookie the browser throws away
 * — while writing `truncated: true`, asserting a degradation that never
 * stored.
 *
 * The ruled fix: when the fully-degraded payload still cannot fit, REFUSE
 * to flash. The encoder returns no cookie and the no-JS handler falls back
 * to the plain redirect — the navigation still lands where it should, only
 * the outcome echo is withheld. Never a prefix of the url: a truncated
 * identifier is a wrong identifier, silently attached to a different
 * submission. Cookie naming, attributes, and refusal/redirect statuses are
 * deliberately untouched (#3239, #3250 pending).
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FLASH_COOKIE,
  decodeFlashCookie,
  encodeFlashCookie,
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

/** RFC 6265bis §5.6: what the browser measures is the name=value pair. */
const COOKIE_CEILING = 4096;

function pairOf(setCookie: string) {
  const end = setCookie.indexOf("; ");
  return end < 0 ? setCookie : setCookie.slice(0, end);
}

describe("the encoder refuses what it cannot fit", () => {
  it("returns no cookie when the url alone overruns the ceiling", () => {
    const url = "/_server/publish?return=" + encodeURIComponent("/catalog/" + "a".repeat(4200));

    // today: a >4 KB Set-Cookie the browser discards whole, wearing
    // `truncated: true` — the encoder asserting it degraded to fit
    expect(encodeFlashCookie(url, { published: true }, [])).toBeNull();
  });

  it("refuses a thrown outcome the same way — no lying prefix, no oversized pair", () => {
    const url = "/_server/charge?receipt=" + "d".repeat(4200);

    expect(encodeFlashCookie(url, new Error("card declined"), [], true)).toBeNull();
  });

  it("keeps the #3137 ladder for outcomes that CAN fit", () => {
    // oversized input and result, ordinary url: the ladder spends the input
    // echo, bounds the value, and the cookie arrives marked truncated
    const pair = pairOf(
      encodeFlashCookie("/_server/import", "x".repeat(6000), [{ big: "c".repeat(5000) }])!
    );

    expect(pair.length).toBeLessThanOrEqual(COOKIE_CEILING);
    const submission = decodeFlashCookie(pair);
    expect(submission?.truncated).toBe(true);
    expect(submission?.url).toBe("/_server/import");
    expect(typeof submission?.result).toBe("string");
  });
});

describe("the no-JS handler falls back to a plain redirect", () => {
  it("redirects without a flash cookie when the request url cannot fit", async () => {
    let ran = 0;
    registerServerFunction("flash-url-bound-publish", async () => {
      ran++;
      return { published: true };
    });

    const back = "/catalog/" + "e".repeat(4200);
    const response = await handleServerFunctionRequest(
      new Request(
        "https://app.example/_server/flash-url-bound-publish?return=" + encodeURIComponent(back),
        {
          method: "POST",
          headers: {
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-Mode": "navigate",
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: "https://app.example/catalog"
          },
          body: "qty=1"
        }
      )
    );

    // the mutation committed and the navigation still lands (#3250 pending:
    // the status is not this fix's to change)
    expect(ran).toBe(1);
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("https://app.example/catalog");
    // ...but no flash cookie: refused, not truncated, not oversized
    const flash = response.headers
      .getSetCookie()
      .filter(entry => entry.startsWith(`${FLASH_COOKIE}=`));
    expect(flash).toEqual([]);
  });

  it("still flashes ordinary submissions through the handler", async () => {
    registerServerFunction("flash-url-bound-ok", async () => ({ published: true }));

    const response = await handleServerFunctionRequest(
      new Request("https://app.example/_server/flash-url-bound-ok", {
        method: "POST",
        headers: {
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "navigate",
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: "https://app.example/catalog"
        },
        body: "qty=1"
      })
    );

    expect(response.status).toBe(303);
    const flash = response.headers
      .getSetCookie()
      .find(entry => entry.startsWith(`${FLASH_COOKIE}=`))!;
    expect(flash).toBeDefined();
    const pair = pairOf(flash);
    expect(pair.length).toBeLessThanOrEqual(COOKIE_CEILING);
    expect(decodeFlashCookie(pair)?.result).toEqual({ published: true });
  });
});
