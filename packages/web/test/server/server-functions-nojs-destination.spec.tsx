/**
 * `createNoJSHandler` — where a form post lands when the client runtime
 * never loaded. A browser submitting a `<form action={fn.url} method="post">`
 * has no channel to receive a return value, so the convention answers a
 * redirect and flashes the outcome into a one-shot cookie for the next
 * render to read.
 *
 * The choice of destination is the whole contract, and every branch of it is
 * a way to strand the user: a form post that answered 200 would leave the
 * browser sitting on `/_server/data/<id>` looking at a serialized payload,
 * so the handler redirects even when it has nothing good to redirect TO —
 * an absent referer, an unparseable one, a result that is already a
 * `Response`. `303 See Other` is what turns the POST back into a GET
 * (RFC 9110 §15.4.4) unless the result named a redirect status itself.
 *
 * `handleServerFunctionRequest` applies this to browser form posts already;
 * the constructor is public so an app can set a `base` or extend the
 * convention to direct HTTP callers.
 *
 * `createNoJSHandler`'s destination choice had no coverage;
 * `server-functions-redirect-status.spec.tsx` pins the same convention
 * end-to-end through the handler (#3139).
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { describe, expect, it } from "vitest";
import { redirect } from "@solidjs/web";
import {
  FLASH_COOKIE,
  createNoJSHandler,
  decodeFlashCookie
} from "@solidjs/web/server-functions/server";

/** A browser form post to a server function, as the no-JS leg receives it. */
function formPost(headers: Record<string, string> = {}) {
  // fn.url is the BARE address; /data/ is the scripted transport's own (#3094)
  return new Request("https://app.example/app/_server/save-profile", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: "name=Ada"
  });
}

/** The flash payload the next render would decode from the answer. */
function flashed(response: Response) {
  const cookie = response.headers
    .getSetCookie()
    .find(entry => entry.startsWith(`${FLASH_COOKIE}=`));
  return cookie ? decodeFlashCookie(cookie.split(";")[0]) : undefined;
}

describe("the browser is never left on the endpoint", () => {
  it("returns to the referring page, carrying the outcome in the flash cookie", () => {
    const handler = createNoJSHandler({ base: "/app" });

    const response = handler(
      { saved: true },
      formPost({ referer: "https://app.example/app/settings" }),
      ["Ada"],
      false
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("https://app.example/app/settings");
    expect(flashed(response)).toEqual({
      result: { saved: true },
      input: ["Ada"],
      url: "/app/_server/save-profile"
    });
  });

  it("falls back to the app's mount when there is no referer to return to", () => {
    const response = createNoJSHandler({ base: "/app" })({ saved: true }, formPost(), []);

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("https://app.example/app");
  });

  it("falls back rather than trusting a referer it cannot parse", () => {
    const response = createNoJSHandler({ base: "/app" })(
      { saved: true },
      formPost({ referer: "://not a url" }),
      []
    );

    expect(response.headers.get("Location")).toBe("https://app.example/app");
  });

  it("uses the origin root when the app has no mount path", () => {
    const response = createNoJSHandler()({ saved: true }, formPost(), []);

    expect(response.headers.get("Location")).toBe("https://app.example/");
  });

  it("carries a thrown outcome as an error, not as a result", () => {
    const response = createNoJSHandler({ base: "/app" })(
      new Error("the field is required"),
      formPost({ referer: "https://app.example/app/settings" }),
      ["Ada"],
      true
    );

    expect(response.status).toBe(303);
    const submission = flashed(response);
    expect(submission?.error).toBeInstanceOf(Error);
    expect((submission?.error as Error).message).toBe("the field is required");
    expect(submission?.result).toBeUndefined();
  });
});

describe("a result that is already a Response", () => {
  it("navigates to its Location and keeps its redirect status", () => {
    const response = createNoJSHandler()(
      redirect("/orders/9", 307),
      formPost({ referer: "https://app.example/app/cart" }),
      []
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("Location")).toBe("https://app.example/orders/9");
    // a Response carries its own meaning — nothing is flashed
    expect(flashed(response)).toBeUndefined();
  });

  it("still turns the POST into a GET when the status is not a redirect", () => {
    // a 201's Location is where the thing was CREATED, not a navigation the
    // browser may repeat as a POST
    const response = createNoJSHandler()(
      new Response(null, { status: 201, headers: { Location: "/orders/9" } }),
      formPost({ referer: "https://app.example/app/cart" }),
      []
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("https://app.example/orders/9");
  });

  it("returns to the referring page when it names no Location at all", () => {
    const response = createNoJSHandler()(
      new Response(null, { status: 200 }),
      formPost({ referer: "https://app.example/app/cart" }),
      []
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("https://app.example/app/cart");
  });

  it("keeps its cookies and headers but never advertises a body it dropped", () => {
    const result = new Response("<h1>saved</h1>", {
      status: 200,
      headers: {
        "Content-Type": "text/html",
        "Content-Length": "14",
        "X-Trace": "abc123"
      }
    });
    result.headers.append("Set-Cookie", "session=fresh; Path=/");
    result.headers.append("Set-Cookie", "theme=dark; Path=/");

    const response = createNoJSHandler()(
      result,
      formPost({ referer: "https://app.example/app/cart" }),
      []
    );

    // the redirect it builds has no body, so these would be lies
    expect(response.headers.get("Content-Type")).toBeNull();
    expect(response.headers.get("Content-Length")).toBeNull();
    // a login that answers a Response still gets its cookies to the browser,
    // each as its own entry
    expect(response.headers.getSetCookie()).toEqual([
      "session=fresh; Path=/",
      "theme=dark; Path=/"
    ]);
    expect(response.headers.get("X-Trace")).toBe("abc123");
  });
});
