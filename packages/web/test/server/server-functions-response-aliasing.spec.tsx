/**
 * Response-object aliasing (#3155): the transport must never mutate a
 * `Response` the application still holds. A module-level cached Response —
 * `const REDIRECT_HOME = new Response(null, { status: 302, … })`, a memoized
 * per-tenant Response — is a normal thing to return from a server function,
 * and folding the request event's cookies onto it in place accumulated every
 * caller's `Set-Cookie` onto one shared object: one user's session cookie
 * served to the next, silently. Bodiless singletons have no tripwire (a
 * body-carrying one self-destructs on its second use), so the guarantee has
 * to come from the handler: it takes ownership of the dispatched Response
 * with a copy before any stamp (cookie fold, `Vary`, `Cache-Control`)
 * lands, and `commitEventResponse` itself folds onto a rebuild, never in
 * place, for every other handler edge that calls it.
 */
import { describe, expect, it } from "vitest";
import { commitEventResponse, createRequestEvent } from "@solidjs/web";
import {
  GET as serverGET,
  createServerReference,
  handleServerFunctionRequest,
  registerServerFunction,
  registerServerReference
} from "@solidjs/web/server-functions/server";

const provideEvent = <T,>(_event: unknown, run: () => T): T => run();

// A middleware-shaped event: each caller's session cookie is appended onto
// the event's response stub, exactly like session rotation or a CSRF token.
function sessionCall(id: string, user: string, init: RequestInit = {}) {
  return handleServerFunctionRequest(
    new Request(`https://app.example/_server/${id}`, {
      method: "POST",
      headers: { "Sec-Fetch-Site": "same-origin" },
      ...init
    }),
    {
      provideEvent,
      createEvent: request => {
        const event = createRequestEvent(request);
        event.response.headers.append("Set-Cookie", `sid=${user}; Path=/; HttpOnly`);
        return event;
      }
    }
  );
}

describe("a cached Response never accumulates other callers' state (#3155)", () => {
  it("serves each caller exactly their own cookie through a bodiless singleton", async () => {
    const REDIRECT_HOME = new Response(null, { status: 302, headers: { Location: "/" } });
    registerServerFunction("alias-redirect", async () => REDIRECT_HOME);

    for (const user of ["alice", "bob", "carol"]) {
      const response = await sessionCall("alias-redirect", user);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/");
      // exactly this caller's cookie — not the accumulated history
      expect(response.headers.getSetCookie()).toEqual([`sid=${user}; Path=/; HttpOnly`]);
      expect(response).not.toBe(REDIRECT_HOME);
    }
    // the application's object is untouched: no cookies, no transport stamps
    expect(REDIRECT_HOME.headers.getSetCookie()).toEqual([]);
    expect(REDIRECT_HOME.headers.get("Vary")).toBeNull();
    expect(REDIRECT_HOME.headers.get("Cache-Control")).toBeNull();
  });

  it("keeps the singleton clean on the no-cookie path too — Vary and Cache-Control land on a copy", async () => {
    // No cookies and no stub gaps: commitEventResponse short-circuits, so
    // this pins the ownership copy specifically — before it, withCSRFVary
    // and finalizeTransportResponse stamped the app's object permanently.
    const NO_CONTENT = new Response(null, { status: 204 });
    registerServerFunction("alias-no-content", async () => NO_CONTENT);

    const response = await handleServerFunctionRequest(
      new Request("https://app.example/_server/alias-no-content", {
        method: "POST",
        headers: { "Sec-Fetch-Site": "same-origin" }
      }),
      { provideEvent }
    );
    expect(response.status).toBe(204);
    // the wire response carries the stamps…
    expect(response.headers.get("Vary")).toContain("Origin");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    // …the singleton carries none of them
    expect(NO_CONTENT.headers.get("Vary")).toBeNull();
    expect(NO_CONTENT.headers.get("Cache-Control")).toBeNull();
  });

  it("covers the gateless road: a GET-declared read returning a cached Response", async () => {
    // Declared reads skip the origin gate, so this was the leak reachable
    // with NO origin proof at all — a bare curl GET.
    const CACHED = new Response(null, { status: 302, headers: { Location: "/menu" } });
    serverGET(
      createServerReference(registerServerReference("alias-declared-read", async () => CACHED))
    );

    for (const user of ["alice", "bob"]) {
      const response = await sessionCall("alias-declared-read", user, { method: "GET" });
      expect(response.headers.getSetCookie()).toEqual([`sid=${user}; Path=/; HttpOnly`]);
    }
    expect(CACHED.headers.getSetCookie()).toEqual([]);
  });

  it("commitEventResponse folds onto a rebuild for every handler edge, not just this one", () => {
    // The public seam other handler edges (API routes, middleware early
    // returns) exit through: the fold must never write through to the
    // caller's object.
    const singleton = new Response(null, { status: 302, headers: { Location: "/" } });

    const event = createRequestEvent(new Request("https://app.example/page"));
    event.response.headers.append("Set-Cookie", "sid=alice; Path=/");
    const folded = commitEventResponse(singleton, event);

    expect(folded).not.toBe(singleton);
    expect(folded.status).toBe(302);
    expect(folded.headers.get("Location")).toBe("/");
    expect(folded.headers.getSetCookie()).toEqual(["sid=alice; Path=/"]);
    expect(singleton.headers.getSetCookie()).toEqual([]);

    // nothing to fold: the response passes through by reference, unmodified
    const untouched = commitEventResponse(
      singleton,
      createRequestEvent(new Request("https://app.example/page"))
    );
    expect(untouched).toBe(singleton);
    expect(singleton.headers.getSetCookie()).toEqual([]);
  });
});
