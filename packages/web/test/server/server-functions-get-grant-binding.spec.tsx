/**
 * A `GET()` grant is made ABOUT a function, and dispatch must never honor
 * it for anything else (#3237).
 *
 * `GET(fn)` writes two places: the id-keyed `METHODS` map, which alone
 * governs dispatch AND the CSRF origin-gate exemption, and the reference's
 * metadata channel, which is what tools and hooks read back
 * (`getServerFunctionMetadata(fn).method`). The grant is a safety
 * assertion, not a transport preference — a GET-declared function is
 * executable from any origin, with caller-chosen arguments, carrying the
 * user's ambient cookies (#3114) — so a grant keyed by id alone follows
 * the id, not the function: `register -> register -> GET(oldReference)`
 * hands the NEW function cross-site GET execution on the strength of a
 * declaration the old one signed.
 *
 * The ruled fix: the grant records the function identity it was granted
 * to, and one `declaresRead(id)` check — used by dispatch AND the 405
 * `Allow` advertisement — honors it only while the id still names that
 * function. A stale or unverifiable declaration fails CLOSED (GET refused,
 * POST + origin gate still required). Declarations that would CHANGE an
 * existing grant's binding (re-declaring `GET` against a rebound id,
 * `withMeta({ method })` on a granted reference) throw in dev and fail
 * closed in prod, never silently rebind.
 *
 * Reachability is asserted the way an attacker gets it: an unscripted
 * cross-site GET, the request a hostile page can cause a browser to send
 * with the victim's cookies. A function that never (validly) declared GET
 * answers that request with 403 (the origin gate) and never runs its body.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestEvent } from "@solidjs/web";
import {
  GET,
  createServerReference as createServerSideReference,
  getServerFunctionMetadata,
  handleServerFunctionRequest,
  registerServerFunction,
  registerServerReference,
  setServerFunctionsDev,
  withMeta
} from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const createEvent = (request: Request) => createRequestEvent(request);

/** The request a hostile page can cause: cross-site, no client runtime. */
function crossSiteGet(id: string) {
  return new Request(`https://app.example/_server/data/${id}`, {
    method: "GET",
    headers: { "Sec-Fetch-Site": "cross-site" }
  });
}

/** The same read spelled same-origin, to see past the origin gate. */
function sameOriginGet(id: string) {
  return new Request(`https://app.example/_server/data/${id}`, {
    method: "GET",
    headers: { "Sec-Fetch-Site": "same-origin" }
  });
}

describe("the grant tracks the function it was granted about", () => {
  it("lets a cross-site GET through for a function that declared it", async () => {
    let ran = 0;
    GET(
      createServerSideReference(
        registerServerReference("grant-control", () => {
          ran++;
          return "a read";
        })
      )
    );

    const response = await handleServerFunctionRequest(crossSiteGet("grant-control"), {
      createEvent
    });

    // the control: without this passing, every expectation below is green
    // for the wrong reason
    expect({ status: response.status, ran }).toStrictEqual({ status: 200, ran: 1 });
  });

  it("refuses a cross-site GET for a function that never declared it", async () => {
    let ran = 0;
    registerServerFunction("grant-undeclared", () => {
      ran++;
      return "a mutation";
    });

    const response = await handleServerFunctionRequest(crossSiteGet("grant-undeclared"), {
      createEvent
    });

    expect({ status: response.status, ran }).toStrictEqual({ status: 403, ran: 0 });
  });

  it("drops the grant when the id is rebound after the declaration (#3129)", async () => {
    let mutationRan = 0;
    GET(createServerSideReference(registerServerReference("grant-rebound-after", () => "a read")));
    registerServerFunction("grant-rebound-after", () => {
      mutationRan++;
      return "a mutation";
    });

    const response = await handleServerFunctionRequest(crossSiteGet("grant-rebound-after"), {
      createEvent
    });

    expect({ status: response.status, mutationRan }).toStrictEqual({ status: 403, mutationRan: 0 });
  });

  it("does not grant to a binding installed before the declaration ran", async () => {
    let mutationRan = 0;
    // the declaration is made about THIS function...
    const declared = createServerSideReference(
      registerServerReference("grant-rebound-before", () => "a read")
    );
    // ...but by the time it runs, the id belongs to another one — an id
    // collision between integrations, or a module re-evaluated in a live
    // process after an edit dropped the wrapper
    registerServerFunction("grant-rebound-before", () => {
      mutationRan++;
      return "a mutation";
    });
    // the declaration is stale: it names a binding the id no longer has.
    // It fails CLOSED (no throw ruled here — the throw is reserved for
    // declarations that would change an EXISTING grant's binding).
    GET(declared);

    const response = await handleServerFunctionRequest(crossSiteGet("grant-rebound-before"), {
      createEvent
    });

    // today: { status: 200, mutationRan: 1 } — the mutation ran from a
    // cross-site GET, with no origin gate, under the victim's cookies
    expect({ status: response.status, mutationRan }).toStrictEqual({
      status: 403,
      mutationRan: 0
    });
  });

  it("stops advertising GET in Allow once the grant is stale", async () => {
    const declared = createServerSideReference(
      registerServerReference("grant-stale-allow", () => "a read")
    );
    registerServerFunction("grant-stale-allow", () => "a mutation");
    GET(declared);

    // same-origin, past the origin gate: the method gate itself must
    // refuse the read and advertise POST only — the same declaresRead
    // answer dispatch gave
    const response = await handleServerFunctionRequest(sameOriginGet("grant-stale-allow"), {
      createEvent
    });

    expect({ status: response.status, allow: response.headers.get("Allow") }).toStrictEqual({
      status: 405,
      allow: "POST"
    });
  });

  it("throws in dev when a declaration would rebind an existing live grant", async () => {
    let mutationRan = 0;
    const declared = createServerSideReference(
      registerServerReference("grant-live-rebind", () => "a read")
    );
    GET(declared);
    // a second reference under the same id, wrapping a different function —
    // an id collision that never re-registered (the registered binding is
    // still the declared read)
    const collided = createServerSideReference({
      id: "grant-live-rebind",
      fn: () => {
        mutationRan++;
        return "a mutation";
      }
    } as any);

    setServerFunctionsDev(true);
    try {
      expect(() => GET(collided as any)).toThrow(/GET/);
    } finally {
      setServerFunctionsDev(false);
    }

    // the live grant survived the refused rebind: the declared read still
    // answers, and the collided function never gained the grant
    const response = await handleServerFunctionRequest(crossSiteGet("grant-live-rebind"), {
      createEvent
    });
    expect({ status: response.status, mutationRan }).toStrictEqual({ status: 200, mutationRan: 0 });
  });

  it("fails closed in prod when a declaration would rebind an existing live grant", async () => {
    let mutationRan = 0;
    const declared = createServerSideReference(
      registerServerReference("grant-live-rebind-prod", () => "a read")
    );
    GET(declared);
    const collided = createServerSideReference({
      id: "grant-live-rebind-prod",
      fn: () => {
        mutationRan++;
        return "a mutation";
      }
    } as any);

    // prod build: no throw — the grant dies instead of rebinding
    GET(collided as any);

    const response = await handleServerFunctionRequest(crossSiteGet("grant-live-rebind-prod"), {
      createEvent
    });
    expect({ status: response.status, mutationRan }).toStrictEqual({ status: 403, mutationRan: 0 });
  });
});

describe("what the metadata channel reports about the grant", () => {
  it("throws in dev when withMeta({ method }) would change a granted declaration", async () => {
    let ran = 0;
    const fn = createServerSideReference(
      registerServerReference("grant-withmeta-dev", () => {
        ran++;
        return "a read";
      })
    );
    GET(fn);

    setServerFunctionsDev(true);
    try {
      expect(() => withMeta(fn, { method: "POST" } as any)).toThrow(/method/);
    } finally {
      setServerFunctionsDev(false);
    }

    const response = await handleServerFunctionRequest(crossSiteGet("grant-withmeta-dev"), {
      createEvent
    });

    // the write was refused whole: the reference still reports the
    // declaration the wire enforces
    expect({
      reportedMethod: getServerFunctionMetadata(fn)!.method,
      status: response.status,
      ran
    }).toStrictEqual({ reportedMethod: "GET", status: 200, ran: 1 });
  });

  it("fails closed in prod: the write revokes the grant it disagrees with", async () => {
    let ran = 0;
    const fn = createServerSideReference(
      registerServerReference("grant-withmeta-prod", () => {
        ran++;
        return "a read";
      })
    );
    GET(fn);

    // prod build: no throw — but the grant must not survive a declaration
    // the metadata channel now contradicts
    withMeta(fn, { method: "POST" } as any);

    const response = await handleServerFunctionRequest(crossSiteGet("grant-withmeta-prod"), {
      createEvent
    });

    expect({
      reportedMethod: getServerFunctionMetadata(fn)!.method,
      status: response.status,
      ran
    }).toStrictEqual({ reportedMethod: "POST", status: 403, ran: 0 });
  });

  it("leaves method-free withMeta writes alone on a granted reference", async () => {
    const fn = createServerSideReference(
      registerServerReference("grant-withmeta-benign", () => "a read")
    );
    GET(fn);
    withMeta(fn, { requiresAuth: true });

    const response = await handleServerFunctionRequest(crossSiteGet("grant-withmeta-benign"), {
      createEvent
    });

    expect({
      meta: getServerFunctionMetadata(fn),
      status: response.status
    }).toMatchObject({ meta: { method: "GET", requiresAuth: true }, status: 200 });
  });
});
