/**
 * The degrade ladder has to bound EVERY field it writes, or it does not
 * bound the cookie.
 *
 * flash.ts's ladder (#3137, and see server-functions-flash-bounds.spec.tsx)
 * exists because a cookie past the browser's ~4096-byte ceiling is
 * discarded WHOLE, with no signal in the response, the console, or
 * server-side: the page after the redirect is indistinguishable from one
 * where nothing was submitted, the mutation has already committed, and the
 * retry writes twice.
 *
 * The ladder bounds two of the payload's three variable-length fields. It
 * drops `input`, it bounds `result` — and it never looks at `url`, which is
 * `pathname + search` of a request the caller chose. A form whose action
 * carries state (`<form action={fn.url + "?return=" + here}>`) is the
 * convention's own idiom, and a long enough one puts the payload past the
 * ceiling with `input: []` and `result` already reduced to `true`: the
 * ladder has spent everything it knows how to spend and hands the encoder a
 * cookie that cannot be stored.
 *
 * Worse than the unbounded case it replaced, because it is now SILENT in
 * both directions: `truncated: true` is written into the payload, so the
 * one field that says "this was degraded to fit" is the encoder asserting
 * success about a cookie the browser throws away.
 *
 * Whether the fix bounds `url`, drops it, or spends something else is the
 * fixer's call; what is pinned here is that a payload the encoder declares
 * truncated is a payload that fits, and that the error/thrown flags — the
 * part the ladder's own comment says must never be lost — still arrive.
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

describe("the flash cookie's url is bounded like everything else in it", () => {
  it("keeps the pair storable when the url alone overruns the ceiling", () => {
    const url = "/_server/publish?return=" + encodeURIComponent("/catalog/" + "a".repeat(4200));
    const cookie = encodeFlashCookie(url, { published: true }, []);
    const pair = pairOf(cookie);

    expect(
      pair.length,
      `${pair.length} bytes — the browser discards the whole cookie`
    ).toBeLessThanOrEqual(COOKIE_CEILING);
    // and having fit, it still says what happened
    expect(decodeFlashCookie(pair)?.truncated).toBe(true);
  });

  it("never reports truncated success for a payload that cannot be stored", () => {
    // the ladder has already spent input and result here; `truncated: true`
    // is the encoder's own claim that what it returned fits
    const url = "/_server/import?" + "q=" + "b".repeat(40000);
    const pair = pairOf(encodeFlashCookie(url, { rows: 12000 }, [{ big: "c".repeat(50000) }]));
    const payload = JSON.parse(decodeURIComponent(pair.slice(FLASH_COOKIE.length + 1)));

    expect(payload.truncated).toBe(true);
    expect(
      pair.length,
      "the payload claims it was degraded to fit, and did not"
    ).toBeLessThanOrEqual(COOKIE_CEILING);
  });

  it("still tells the next render that a long-url submission FAILED", () => {
    const url = "/_server/charge?receipt=" + "d".repeat(4200);
    const pair = pairOf(encodeFlashCookie(url, new Error("card declined"), [], true));

    expect(pair.length).toBeLessThanOrEqual(COOKIE_CEILING);
    const submission = decodeFlashCookie(pair);
    expect(submission?.error).toBeInstanceOf(Error);
    expect(submission?.result).toBeUndefined();
  });

  it("holds through the handler, where the url is not the encoder's to choose", async () => {
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
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: "https://app.example/catalog"
          },
          body: "qty=1"
        }
      )
    );

    expect(ran).toBe(1); // the mutation COMMITTED — this is the #3137 case
    expect(response.status).toBe(303);
    const flash = response.headers
      .getSetCookie()
      .find(entry => entry.startsWith(`${FLASH_COOKIE}=`))!;
    const pair = pairOf(flash);
    expect(
      pair.length,
      `${pair.length} bytes reach the browser and none come back`
    ).toBeLessThanOrEqual(COOKIE_CEILING);
  });
});
