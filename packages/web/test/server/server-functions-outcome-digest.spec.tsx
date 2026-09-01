/**
 * The outcome a single-flight hook is handed. `collectFlightData` re-runs
 * reads on the server immediately after a mutation, so the generic halves
 * of that job arrive pre-digested on the outcome and the hook supplies only
 * the data strategy. Each of those three is a correctness hazard the hook
 * cannot fix for itself:
 *
 *  - `foldedHeaders` — the re-read starts from the request that TRIGGERED
 *    the mutation, whose cookies are pre-mutation by definition. Without the
 *    fold, a read behind a session the mutation just established sees the
 *    logged-out state and the page renders as if the login failed.
 *  - `targetUrl` — the page the data is for: the redirect's destination
 *    when there is one, the referring page otherwise, and nothing at all
 *    when the redirect leaves the origin (there is no page of ours to
 *    produce data for).
 *  - `revalidateKeys` — the invalidation scope the mutation declared.
 *
 * `foldSetCookies` is the same fold as a public helper, for integrations
 * that assemble the re-read themselves.
 *
 * `foldedHeaders`, `targetUrl` and `revalidateKeys` had zero references
 * anywhere in the test tree.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestEvent, getRequestEvent, redirect } from "@solidjs/web";
import {
  SINGLE_FLIGHT_HEADER,
  foldSetCookies,
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";
import type { ServerFunctionOutcome } from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

// the handler's default event carries no `response`; the cookie writes below
// set headers on it, so the tests must supply a real one
const createEvent = (request: Request) => createRequestEvent(request);

/** A scripted POST that opted into the single-flight fold. */
function post(id: string, headers: Record<string, string> = {}) {
  return new Request(`https://app.example/_server/data/${id}`, {
    method: "POST",
    body: "[]",
    headers: {
      "Sec-Fetch-Site": "same-origin",
      "content-type": "application/json",
      "X-Server-Function-Format": "8",
      "X-Server-Function-Instance": "server-function:test",
      [SINGLE_FLIGHT_HEADER]: "true",
      ...headers
    }
  });
}

/** Dispatches `id` and hands back the outcome the flight hook saw. */
async function collect(request: Request) {
  let outcome!: ServerFunctionOutcome;
  await handleServerFunctionRequest(request, {
    createEvent,
    collectFlightData: (_event, received) => {
      outcome = received;
      return { collected: true };
    }
  });
  return outcome;
}

describe("the headers a re-read starts from", () => {
  it("carries the mutation's own cookie, overriding the request's stale one", async () => {
    let ran = 0;
    registerServerFunction("digest-login", async () => {
      ran++;
      const event = getRequestEvent()! as ReturnType<typeof createEvent>;
      event.response.headers.append("Set-Cookie", "session=fresh; Path=/; HttpOnly");
      return "ok";
    });

    const outcome = await collect(post("digest-login", { cookie: "session=stale; theme=dark" }));

    expect(ran).toBe(1);
    // the re-read sees the session the mutation just established, and the
    // cookies it did not touch survive
    expect(outcome.foldedHeaders.get("cookie")).toBe("session=fresh; theme=dark");
    // the original request is untouched — the fold is a copy
    expect(outcome.request.headers.get("cookie")).toBe("session=stale; theme=dark");
  });

  it("carries a cookie the outcome's own Response set, not only the event's", async () => {
    let ran = 0;
    registerServerFunction("digest-outcome-cookie", async () => {
      ran++;
      const event = getRequestEvent()! as ReturnType<typeof createEvent>;
      event.response.headers.append("Set-Cookie", "theme=dark; Path=/");
      // a thrown redirect carries headers of its own, and they never reach
      // the event response — the fold has to read both sources
      throw redirect("/dashboard", {
        headers: { "Set-Cookie": "session=fresh; Path=/; HttpOnly" }
      });
    });

    const outcome = await collect(
      post("digest-outcome-cookie", {
        cookie: "session=stale",
        referer: "https://app.example/login"
      })
    );

    expect(ran).toBe(1);
    expect(outcome.foldedHeaders.get("cookie")).toBe("session=fresh; theme=dark");
  });

  it("honours a deletion the mutation made", async () => {
    let ran = 0;
    registerServerFunction("digest-logout", async () => {
      ran++;
      const event = getRequestEvent()! as ReturnType<typeof createEvent>;
      event.response.headers.append("Set-Cookie", "session=; Max-Age=0; Path=/");
      return "ok";
    });

    const outcome = await collect(post("digest-logout", { cookie: "session=live; cart=3" }));

    expect(ran).toBe(1);
    expect(outcome.foldedHeaders.get("cookie")).toBe("cart=3");
  });
});

describe("the page the data is for", () => {
  it("names the redirect's destination, resolved against the call", async () => {
    registerServerFunction("digest-redirect", async () => {
      throw redirect("/orders/9");
    });

    const outcome = await collect(post("digest-redirect", { referer: "https://app.example/cart" }));

    expect(outcome.targetUrl).toBe("https://app.example/orders/9");
    expect(outcome.thrown).toBe(true);
  });

  it("names the referring page when the mutation stays put", async () => {
    registerServerFunction("digest-plain", async () => "saved");

    const outcome = await collect(post("digest-plain", { referer: "https://app.example/cart" }));

    expect(outcome.targetUrl).toBe("https://app.example/cart");
    expect(outcome.thrown).toBe(false);
    expect(outcome.value).toBe("saved");
  });

  it("names nothing when the redirect leaves the origin — there is no page of ours", async () => {
    registerServerFunction("digest-offsite", async () => {
      throw redirect("https://payments.example/checkout");
    });

    const outcome = await collect(post("digest-offsite", { referer: "https://app.example/cart" }));

    expect(outcome.targetUrl).toBeUndefined();
  });

  it("names nothing without a referer — a non-browser caller has no page", async () => {
    registerServerFunction("digest-bare", async () => "saved");

    const outcome = await collect(post("digest-bare"));

    expect(outcome.targetUrl).toBeUndefined();
  });
});

describe("the invalidation scope", () => {
  it("splits the declared revalidate keys, and is absent when none were declared", async () => {
    registerServerFunction("digest-keys", async () => {
      throw redirect("/orders", { revalidate: ["orders", "cart"] });
    });
    registerServerFunction("digest-nokeys", async () => "saved");

    const keyed = await collect(post("digest-keys", { referer: "https://app.example/cart" }));
    expect(keyed.revalidateKeys).toEqual(["orders", "cart"]);

    const bare = await collect(post("digest-nokeys", { referer: "https://app.example/cart" }));
    expect(bare.revalidateKeys).toBeUndefined();
  });
});

describe("foldSetCookies, the same fold as a public helper", () => {
  it("applies the set in order, later winning, and leaves the input alone", () => {
    const request = new Headers({ cookie: "sid=old; theme=dark" });

    const folded = foldSetCookies(request, [
      "sid=first; Path=/",
      "sid=second; Path=/; HttpOnly",
      "added=yes; Path=/"
    ]);

    expect(folded.get("cookie")).toBe("sid=second; theme=dark; added=yes");
    expect(request.get("cookie")).toBe("sid=old; theme=dark");
  });

  it("deletes on an expiry that has passed, and only on one that has", () => {
    const folded = foldSetCookies(new Headers({ cookie: "a=1; b=2; c=3; d=4" }), [
      "a=; Max-Age=0; Path=/",
      "b=; Max-Age=-1; Path=/",
      // the comma inside an Expires date must not read as a second cookie
      "c=; Expires=Wed, 09 Jun 2021 10:18:14 GMT; Path=/",
      // and a future Expires is an ordinary SET: deleting on the attribute's
      // mere presence would drop every persistent cookie from the re-read
      "e=5; Expires=Sat, 01 Jan 2050 00:00:00 GMT; Path=/"
    ]);

    expect(folded.get("cookie")).toBe("d=4; e=5");
  });

  it("keeps a value containing '=' whole — a JWT or base64 payload survives", () => {
    const folded = foldSetCookies(new Headers(), ["token=aGVsbG8=; Path=/; HttpOnly"]);

    expect(folded.get("cookie")).toBe("token=aGVsbG8=");
  });

  it("copies through untouched when nothing was set", () => {
    const request = new Headers({ cookie: "a=1", "x-trace": "abc" });

    const folded = foldSetCookies(request, []);

    expect(folded.get("cookie")).toBe("a=1");
    expect(folded.get("x-trace")).toBe("abc");
    expect(folded).not.toBe(request);
  });
});
