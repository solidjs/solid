/**
 * A `GET()` grant is made ABOUT a function, and dispatch must never honor
 * it for anything else.
 *
 * `GET(fn)` writes two places: the id-keyed `METHODS` map, which alone
 * governs dispatch AND the CSRF origin-gate exemption, and the reference's
 * metadata channel, which is what tools and hooks read back
 * (`getServerFunctionMetadata(fn).method`). The grant is a safety
 * assertion, not a transport preference — a GET-declared function is
 * executable from any origin, with caller-chosen arguments, carrying the
 * user's ambient cookies (#3114) — so the two writes disagreeing is not a
 * cosmetic drift: whatever `METHODS` says is what a cross-site
 * `<form method="GET">` can reach.
 *
 * #3129 closed one way for them to disagree: re-registering an id drops the
 * grant, so `register -> GET -> register` cannot leave a mutation reachable
 * over an un-gated GET. Two more remain, and both are the same shape — a
 * write to one channel that the other never hears:
 *
 *  - `withMeta(fn, { method: "POST" })` writes only the metadata. The
 *    reference reads back as a POST function while the wire still executes
 *    it on a cross-site GET. Whether `withMeta` should revoke or refuse the
 *    write, it cannot be allowed to report a revocation it did not perform.
 *
 *  - `GET(fn)` writes `METHODS` for `fn.id` unconditionally, so the
 *    symmetric interleaving `register -> register -> GET` re-arms the grant
 *    against the binding that is live NOW, which is not the function the
 *    declaration was made about. #3129's fix verifies the binding at REBIND
 *    time; this is the same check owed at GRANT time.
 *
 * The two share a fix if the fix is "a grant is verified against the
 * binding it names", which is why they are pinned together.
 *
 * Reachability is asserted the way an attacker gets it: an unscripted
 * cross-site GET, the request a hostile page can cause a browser to send
 * with the victim's cookies. A function that never declared GET answers
 * that request with 403 (the origin gate) and never runs its body — that
 * is the shape every test below expects.
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
    // refusing the grant loudly at declaration time is an equally good
    // answer to a declaration that names a binding that is gone; what is
    // not an answer is granting it
    let declarationThrew = false;
    try {
      GET(declared);
    } catch {
      declarationThrew = true;
    }

    const response = await handleServerFunctionRequest(crossSiteGet("grant-rebound-before"), {
      createEvent
    });

    // today: declarationThrew false, { status: 200, mutationRan: 1 } — the
    // mutation ran from a cross-site GET, with no origin gate, under the
    // victim's cookies
    expect({ status: response.status, mutationRan, declarationThrew }).toStrictEqual({
      status: 403,
      mutationRan: 0,
      declarationThrew
    });
  });
});

describe("what the metadata channel reports about the grant", () => {
  it("does not let withMeta report a revocation the wire did not perform", async () => {
    let ran = 0;
    const fn = createServerSideReference(
      registerServerReference("grant-withmeta-revoke", () => {
        ran++;
        return "a read";
      })
    );
    GET(fn);
    // an app narrowing a declaration back down — the only spelling the
    // metadata channel offers
    let withMetaThrew = false;
    try {
      withMeta(fn, { method: "POST" });
    } catch {
      withMetaThrew = true;
    }

    const response = await handleServerFunctionRequest(crossSiteGet("grant-withmeta-revoke"), {
      createEvent
    });
    const outcome = {
      withMetaThrew,
      reportedMethod: getServerFunctionMetadata(fn)!.method,
      status: response.status,
      ran
    };

    // Two honest answers, and the choice between them is a design call the
    // fix makes, not something this spec should decide: either `method` is
    // declaration-scoped and `withMeta` refuses to write it (pointing at
    // `GET(fn)`, the way the invoke channel already redirects `method`), or
    // the write is a revocation and dispatch stops honoring the grant.
    // Today's behavior is neither: the write is accepted, the reference
    // reports POST, and the wire still executes the body for a cross-site
    // GET.
    const refusedTheWrite = { withMetaThrew: true, reportedMethod: "GET", status: 200, ran: 1 };
    const performedTheRevocation = {
      withMetaThrew: false,
      reportedMethod: "POST",
      status: 403,
      ran: 0
    };
    expect([refusedTheWrite, performedTheRevocation]).toContainEqual(outcome);
  });
});
