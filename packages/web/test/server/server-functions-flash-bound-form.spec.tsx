/**
 * The flash url is the UNBOUND function base (#3239 ruling, submission-
 * shape half): the no-JS seed must be the SAME submission a scripted call
 * records, or the post-redirect render diverges from the scripted road for
 * exactly the forms the no-JS convention exists to cover.
 *
 * The router matches submissions structurally: `useSubmission(fn)` filters
 * `s.url === fn.base`, where `base` is the action's unbound address
 * (`<endpoint>/<id>`) — `.with()` rebinds `url` (adding `?args=…`) but
 * `base` survives the binding, and the scripted road records `base` as the
 * submission's `url` with the bound arguments prepended to `input`
 * (`[...boundArgs, ...args]`; the server's argument parser prepends `?args`
 * url arguments before natural-encoding bodies the same way).
 *
 * The no-JS leg used to flash `url.pathname + url.search` — the REQUEST
 * url. For a `.with()`-bound form the request url carries the `?args=`
 * query, so the flashed submission's `url` never equaled `fn.base` and the
 * post-redirect `useSubmission` read came back empty: the outcome stored,
 * decoded, and then matched nothing. The flash now records the unbound
 * base — the request's pathname, which for a server function is
 * `<endpoint>/<id>` with any binding riding the query — matching the
 * scripted shape; bound arguments already arrive in `input` through the
 * parser's prepend.
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
  (globalThis as any).__SOLID_SECRET__ = "flash-bound-form-spec-key";
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
  delete (globalThis as any).__SOLID_SECRET__;
});

/** The flash payload the next render would decode from the answer. */
function flashed(response: Response) {
  const cookie = response.headers
    .getSetCookie()
    .find(entry => entry.startsWith(`${FLASH_COOKIE}=`));
  return cookie ? decodeFlashCookie(cookie.split(";")[0]) : undefined;
}

/** A browser form post, as the no-JS leg receives it. */
function formPost(url: string, body = "qty=2") {
  return new Request(url, {
    method: "POST",
    headers: {
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "navigate",
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: "https://app.example/catalog"
    },
    body
  });
}

describe("the flash url is the unbound function base", () => {
  it("a .with()-bound form's flash matches the scripted submission shape", async () => {
    registerServerFunction("flash-bound-publish", async (tag: string, form: URLSearchParams) => ({
      tag,
      qty: form.get("qty")
    }));

    // what serverFunctionUrl(id, ["news"]) renders into the form's action:
    // the bound arguments ride the `?args=` query
    const response = await handleServerFunctionRequest(
      formPost(
        "https://app.example/_server/flash-bound-publish?args=" +
          encodeURIComponent(JSON.stringify(["news"]))
      )
    );

    expect(response.status).toBe(303);
    const submission = await flashed(response);
    expect(submission).toBeDefined();
    // the scripted road records the UNBOUND base — `s.url === fn.base` is
    // the router's whole matching contract — never the bound request url
    expect(submission!.url).toBe("/_server/flash-bound-publish");
    // ...with the bound arguments prepended to input, exactly like the
    // scripted `[...boundArgs, ...args]`
    expect(submission!.input[0]).toBe("news");
    expect(submission!.input[1]).toBeInstanceOf(URLSearchParams);
    expect((submission!.input[1] as URLSearchParams).get("qty")).toBe("2");
    expect(submission!.result).toEqual({ tag: "news", qty: "2" });
  });

  it("caller-decorated queries do not ride the flash url either", async () => {
    registerServerFunction("flash-bound-plain", async (form: URLSearchParams) => ({
      saved: form.get("qty")
    }));

    // the convention's own idiom decorates the action url with the caller's
    // query — matching is against the base, so none of it may ride the url
    const response = await handleServerFunctionRequest(
      formPost("https://app.example/_server/flash-bound-plain?return=%2Fcatalog")
    );

    expect(response.status).toBe(303);
    const submission = await flashed(response);
    expect(submission).toBeDefined();
    expect(submission!.url).toBe("/_server/flash-bound-plain");
  });
});
