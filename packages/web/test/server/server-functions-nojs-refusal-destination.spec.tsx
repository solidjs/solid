/**
 * The no-JS convention's promise covers the refusals too.
 *
 * `createNoJSHandler`'s contract is stated as an absolute — "the browser is
 * never left on the endpoint" (server.ts ~1705, and the describe name in
 * server-functions-nojs-destination.spec.tsx): a form post has no channel
 * to receive a value, so the answer is a redirect and the outcome rides the
 * flash cookie. The handler honours that for everything it is HANDED.
 *
 * It is handed nothing when the request is refused before dispatch, because
 * the convention is chosen at server.ts ~3055 — AFTER the gates. A stale id
 * from before a deploy, a malformed multipart body, an upload past
 * `bodySizeLimit`, a request the origin check cannot vouch for: each
 * answers 404 / 400 / 413 / 403 with no `Location` and, in production,
 * no body. What the user sees is a blank page at `/_server/<id>` with the
 * back button as the only way out and everything they typed gone.
 *
 * This is a progressive-enhancement hole, not a correctness one: the
 * mutation has NOT committed in any of these cases — each test proves that
 * with a counter — so there is nothing to double-submit. That is exactly
 * why the answer can be the ordinary bounce back to the form.
 *
 * The origin refusal is pinned for destination only. Where the outcome
 * should be legible to the next render is pinned on the deploy-skew case:
 * the id in the shipped HTML is stale, the user is not at fault, and a
 * silent bounce back to an unchanged form is the failure the flash cookie
 * exists to avoid.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FLASH_COOKIE,
  decodeFlashCookie,
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

const ORIGIN = "https://app.example";
const FORM_PAGE = `${ORIGIN}/settings`;

let ran = 0;
registerServerFunction("nojs-refusal-save", async (...args: unknown[]) => {
  ran++;
  return { saved: args.length };
});

/**
 * A real browser form navigation: no `X-Server-Function-Instance`, a form
 * content type, and no `Sec-Fetch-Mode` (which dispatch reads as navigate,
 * the older-browser spelling — #3139).
 */
function formNavigation(
  id: string,
  {
    contentType = "application/x-www-form-urlencoded",
    body = "name=Ada",
    referer = FORM_PAGE as string | null
  } = {}
) {
  const headers: Record<string, string> = {
    "Sec-Fetch-Site": "same-origin",
    "Content-Type": contentType
  };
  if (referer) headers.Referer = referer;
  return new Request(`${ORIGIN}/_server/${id}`, { method: "POST", headers, body });
}

/** The destination assertion the convention promises, whatever went wrong. */
function expectsBounceBack(response: Response, message: string) {
  const location = response.headers.get("Location");
  expect(response.status, `${message} — status ${response.status}`).toBe(303);
  expect(location, `${message} — no Location, the browser stays on the endpoint`).not.toBeNull();
  expect(new URL(location!, ORIGIN).origin).toBe(ORIGIN);
}

function flashed(response: Response) {
  const cookie = response.headers
    .getSetCookie()
    .find(entry => entry.startsWith(`${FLASH_COOKIE}=`));
  return cookie ? decodeFlashCookie(cookie.split(";")[0]) : undefined;
}

describe("a refused form navigation is bounced back, not stranded", () => {
  it("returns to the form when the id is stale after a deploy", async () => {
    const before = ran;
    const response = await handleServerFunctionRequest(formNavigation("nojs-refusal-retired-id"));

    expect(ran - before).toBe(0); // nothing registered at that id could have run
    expectsBounceBack(response, "unknown server function");
  });

  it("tells the next render that the stale-id submission failed", async () => {
    const response = await handleServerFunctionRequest(formNavigation("nojs-refusal-retired-id-2"));

    // a silent bounce back to the same form reads as "nothing happened",
    // which is the read that makes a user submit again
    const submission = flashed(response);
    expect(submission, "no outcome cookie — the form re-renders as if untouched").toBeDefined();
    expect(submission?.error).toBeInstanceOf(Error);
    expect(submission?.result).toBeUndefined();
  });

  it("returns to the form when the multipart body is malformed", async () => {
    const before = ran;
    const response = await handleServerFunctionRequest(
      formNavigation("nojs-refusal-save", {
        contentType: "multipart/form-data; boundary=----SolidBoundary",
        body: "this is not a multipart body"
      })
    );

    expect(ran - before).toBe(0);
    expectsBounceBack(response, "malformed arguments");
  });

  it("returns to the form when the upload runs past bodySizeLimit", async () => {
    const before = ran;
    const response = await handleServerFunctionRequest(
      formNavigation("nojs-refusal-save", { body: "note=" + "A".repeat(5000) }),
      { bodySizeLimit: 100 }
    );

    expect(ran - before).toBe(0);
    expectsBounceBack(response, "body over the limit");
  });

  it("returns to the app when the origin check cannot vouch for the post", async () => {
    // a privacy extension, a `Referrer-Policy: no-referrer` page, an
    // embedded webview: no fetch metadata, so the gate refuses — and there
    // is no referer to return to either, which is what `base` is for
    const before = ran;
    const response = await handleServerFunctionRequest(
      new Request(`${ORIGIN}/_server/nojs-refusal-save`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "name=Ada"
      })
    );

    expect(ran - before).toBe(0);
    expectsBounceBack(response, "origin check refused");
  });
});
