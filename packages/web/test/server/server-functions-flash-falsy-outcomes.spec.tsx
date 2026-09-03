/**
 * A falsy result is still an outcome (#3248, falsy half).
 *
 * The whole reason the flash cookie degrades instead of vanishing (#3137,
 * pinned by server-functions-flash-bounds.spec.tsx) is that a missing
 * confirmation reads as "nothing happened", and the natural response to
 * that is to submit again — which for a non-idempotent handler is the
 * second write. Two truthiness tests sat on that road and lost legitimate
 * outcomes for free:
 *
 *   - flash.ts, decode: `if (!payload || !payload.result) return;` — a
 *     WELL-FORMED cookie whose result is falsy was discarded. `""` is an
 *     ordinary return, `false` and `0` are ordinary answers, and a thrown
 *     `Error("")` lost the ERROR flag too.
 *   - server.ts, `createNoJSHandler`: `if (result && !(result instanceof
 *     Response))` — a falsy outcome emitted no cookie at all, and dispatch's
 *     `result ?? metadata` hand-off additionally erased a returned `null`
 *     before the handler ever saw it.
 *
 * Redirect vs flash is decided structurally — is the result a `Response`,
 * does it carry a redirect — never by the value's truthiness. Out of scope
 * here by pending ruling: an `undefined` outcome keeps its current
 * behavior (no cookie), and cookie naming/attributes/url bounds are
 * untouched (#3239, #3249, #3250).
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { respond } from "@solidjs/web";
import {
  FLASH_COOKIE,
  createNoJSHandler,
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

/** What the browser stores: the name=value pair, before the attributes. */
function pairOf(setCookie: string) {
  const end = setCookie.indexOf("; ");
  return end < 0 ? setCookie : setCookie.slice(0, end);
}

function roundTrip(setCookie: string) {
  return decodeFlashCookie(pairOf(setCookie));
}

/** The flash payload the next render would decode from the answer. */
function flashed(response: Response) {
  const cookie = response.headers
    .getSetCookie()
    .find(entry => entry.startsWith(`${FLASH_COOKIE}=`));
  return cookie ? roundTrip(cookie) : undefined;
}

/** A browser form post, as the no-JS leg receives it. */
function formPost(url = "https://app.example/_server/save-draft") {
  return new Request(url, {
    method: "POST",
    headers: {
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: "https://app.example/drafts/9"
    },
    body: "body=hello"
  });
}

describe("a falsy result is still an outcome", () => {
  it("delivers an empty-string result rather than discarding the cookie", () => {
    const cookie = encodeFlashCookie("/_server/save-draft", "", ["hello"]);
    const submission = roundTrip(cookie);

    // the control: absence really is absence, and stays undefined
    expect(decodeFlashCookie(null)).toBeUndefined();

    expect(submission).toBeDefined();
    expect(submission?.url).toBe("/_server/save-draft");
    expect(submission?.result).toBe("");
  });

  it("delivers 0, false and null the same way", () => {
    for (const result of [0, false, null]) {
      const submission = roundTrip(encodeFlashCookie("/_server/vote", result, []));
      expect(submission, `result ${JSON.stringify(result)} was discarded`).toBeDefined();
      expect(submission?.url).toBe("/_server/vote");
      expect(submission?.result).toBe(result);
    }
  });

  it("keeps the error flag on a thrown outcome whose message is empty", () => {
    // the flag, not the text, is what the next render branches on: losing it
    // turns a failed charge into a page that looks like nothing was posted
    const cookie = encodeFlashCookie("/_server/charge", new Error(""), [], true);
    const submission = roundTrip(cookie);

    expect(submission).toBeDefined();
    expect(submission?.error).toBeInstanceOf(Error);
    expect((submission?.error as Error).message).toBe("");
    expect(submission?.result).toBeUndefined();
  });

  it("the no-JS handler flashes falsy outcomes and still redirects back", () => {
    for (const result of [0, false, "", null]) {
      const response = createNoJSHandler()(result, formPost(), ["hello"]);

      expect(response.status).toBe(303);
      expect(response.headers.get("Location")).toBe("https://app.example/drafts/9");
      const submission = flashed(response);
      expect(submission, `result ${JSON.stringify(result)} emitted no cookie`).toBeDefined();
      expect(submission?.result).toBe(result);
      expect(submission?.input).toEqual(["hello"]);
    }
  });

  it("a form post to a function returning null flashes null (end to end)", async () => {
    // dispatch used to hand the no-JS handler `result ?? metadata`, erasing
    // a returned null into undefined before the handler could flash it
    registerServerFunction("sf-flash-null", async () => null);

    const response = await handleServerFunctionRequest(
      formPost("https://app.example/_server/sf-flash-null")
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("https://app.example/drafts/9");
    const submission = flashed(response);
    expect(submission, "the committed mutation's null outcome emitted no cookie").toBeDefined();
    expect(submission?.result).toBe(null);
  });

  it("a form post returning 0 flashes 0 (end to end)", async () => {
    registerServerFunction("sf-flash-zero", async () => 0);

    const response = await handleServerFunctionRequest(
      formPost("https://app.example/_server/sf-flash-zero")
    );

    expect(response.status).toBe(303);
    const submission = flashed(response);
    expect(submission?.result).toBe(0);
  });

  it("redirect vs flash stays structural: an envelope's redirect wins over its empty value", async () => {
    // `respond(null, ...)` carries its meaning in its metadata — the
    // redirect navigates and nothing flashes, decided by the shape of the
    // outcome, not by the value's truthiness
    registerServerFunction("sf-flash-envelope-redirect", async () =>
      respond(null, { status: 303, headers: { Location: "/orders/42" } })
    );

    const response = await handleServerFunctionRequest(
      formPost("https://app.example/_server/sf-flash-envelope-redirect")
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("https://app.example/orders/42");
    expect(flashed(response)).toBeUndefined();
  });

  it("an undefined outcome keeps its current behavior: no cookie (pending ruling)", () => {
    // Whether a bare `return` should flash is an open product ruling — this
    // pins today's behavior so the falsy fix cannot drift it by accident.
    const response = createNoJSHandler()(undefined, formPost(), ["hello"]);

    expect(response.status).toBe(303);
    expect(
      response.headers.getSetCookie().find(entry => entry.startsWith(`${FLASH_COOKIE}=`))
    ).toBeUndefined();
  });
});
