/**
 * The flash cookie is a decode boundary, and it is missing the two guards
 * the other decode boundary has.
 *
 * The argument road strips the prototype-mutating keys at the seam
 * (`stripUnsafeArgumentKeys`, server.ts ~1199; the reasoning and the table
 * of roads live in server-functions-proto-keys.spec.tsx, #3168/#3202) on
 * the grounds that a decoded value's most ordinary downstream move is a
 * merge, and a merge by [[Set]] fires the inherited setter. `JSON.parse`
 * creates `__proto__` as an ordinary own property, so the flash road
 * produces exactly the same graph — and hands it straight to the
 * integration, unstripped, on BOTH fields it carries: `input` (the echo an
 * integration re-populates the form from) and `result` (the value it
 * renders).
 *
 * Reachability is narrower than the argument road's: setting a cookie on
 * the origin is the price of entry. It is not zero — the flash cookie is
 * unsigned, and it is not host-locked, so a sibling subdomain can toss one
 * (see server-functions-flash-cookie-attributes.spec.tsx). A guard that
 * exists on one leg of a decode boundary and not the other is a guard the
 * next reader will assume covers both.
 *
 * The same asymmetry shows in the field the decoder copies without looking:
 * `FlashSubmission.url` is typed `string` and every integration reads it as
 * one (`url.startsWith("/")`, `new URL(url, base)`), but the decoder passes
 * `payload.url` through whatever it is. An object there does not fail the
 * decode — it fails the RENDER, which is the one place flash.ts's own
 * header promises a malformed cookie can never reach ("a malformed cookie
 * never takes down the render").
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { afterEach, describe, expect, it } from "vitest";
import { FLASH_COOKIE, decodeFlashCookie } from "@solidjs/web/server-functions/server";

afterEach(() => {
  delete (Object.prototype as any).polluted;
  delete (Object.prototype as any).isAdmin;
});

/** A cookie header carrying a payload no honest encoder would write. */
function cookieHeader(payload: string) {
  return `${FLASH_COOKIE}=${encodeURIComponent(payload)}`;
}

/** The naive recursive merge #3168's own rationale names as the sink. */
function deepMerge(target: any, source: any) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === "object") {
      target[key] ??= {};
      deepMerge(target[key], source[key]);
    } else target[key] = source[key];
  }
  return target;
}

describe("the flash decode strips what the argument decode strips", () => {
  it("carries no live __proto__ out of the submission echo", () => {
    const submission = decodeFlashCookie(
      cookieHeader(
        '{"url":"/_server/save","result":"ok","error":false,"thrown":false,' +
          '"input":[{"name":"Ada","__proto__":{"polluted":"yes"}}]}'
      )
    )!;

    // the shallow merge #3168 fixed for the argument road
    expect(Object.getPrototypeOf(Object.assign({}, submission.input[0]))).toBe(Object.prototype);
    expect(Object.keys(submission.input[0])).toEqual(["name"]);
  });

  it("carries no live constructor out of the result an integration renders", () => {
    const submission = decodeFlashCookie(
      cookieHeader(
        '{"url":"/_server/save","error":false,"thrown":false,"input":[],' +
          '"result":{"ok":true,"constructor":{"prototype":{"isAdmin":true}}}}'
      )
    )!;

    deepMerge({}, submission.result);
    expect(({} as any).isAdmin, "Object.prototype was written through the result").toBeUndefined();
  });

  it("never hands the render a url that is not a string", () => {
    const submission = decodeFlashCookie(
      cookieHeader('{"url":{"href":"/x"},"result":"ok","error":false,"thrown":false,"input":[]}')
    );

    // the read every integration makes to decide whether the outcome belongs
    // to the page it is rendering
    expect(typeof submission?.url).not.toBe("object");
    expect(() => submission?.url.startsWith("/")).not.toThrow();
  });
});
