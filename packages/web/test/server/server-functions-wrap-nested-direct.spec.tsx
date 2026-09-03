/**
 * The per-handler `wrapInvocation` and the in-process call made UNDER it.
 *
 * A server function's body may call another server function directly — the
 * reference is in scope, and on the server calling it runs the original
 * in-process rather than going back out over HTTP (that is what
 * `createServerReference` is for). Both calls belong to one request.
 *
 * The configured wrap covers both, on purpose: `createServerReference`'s
 * apply trap reads `config.wrapInvocation`, so "per-function middleware
 * built on it can't be bypassed by calling the function during a render".
 * The per-handler OPTION reads nothing — it is threaded through the HTTP
 * dispatch tail only. For a document render that is a fact of scope: a
 * per-request option cannot exist for a call that is not a request, and
 * `HandleServerFunctionRequestOptions` says so ("it only applies to HTTP
 * dispatch"). Inside the handler it is not: the nested call happens within
 * the option's own dynamic extent, under the option's own event, and the
 * option is the only policy an adapter that wires per-request (per-tenant
 * policy derived from the request, a per-route gate) has.
 *
 * So an adapter that gates with the option gates the function the wire
 * addressed and nothing that function reaches in-process — the shape a
 * hop-by-hop authorization check exists to prevent. The invariant pinned
 * here: whichever wrap owns a request owns every server-function body
 * entered while handling it, not just the entry point.
 *
 * Only the nested leg is pinned. The render-time leg — a direct call made
 * during document SSR, outside any `handleServerFunctionRequest` — has no
 * per-request option to consult and cannot be fixed in code; there the
 * source comment above the apply trap, which advertises the guarantee
 * without naming which of the two hooks earns it, is what is wrong.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createRequestEvent } from "@solidjs/web";
import {
  configureServerFunctionsServer,
  createServerReference as createServerSideReference,
  handleServerFunctionRequest,
  registerServerFunction,
  registerServerReference
} from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");

/**
 * `configure` ignores `undefined` — that is its spelling of "not
 * overriding" — so undoing a hook between tests takes a value. `null` is
 * the falsy "nothing configured" every read site tests for; the cast is
 * only because the option type describes hooks, not their absence.
 */
const NO_HOOK = null as any;

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterEach(() => {
  configureServerFunctionsServer({ wrapInvocation: NO_HOOK });
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const createEvent = (request: Request) => createRequestEvent(request);

function post(id: string) {
  return new Request(`https://app.example/_server/data/${id}`, {
    method: "POST",
    body: "[]",
    headers: {
      "Sec-Fetch-Site": "same-origin",
      "content-type": "application/json",
      "X-Server-Function-Format": "8",
      "X-Server-Function-Instance": "server-function:test"
    }
  });
}

/** An entry function whose body calls a second server function in-process. */
function registerPair(prefix: string) {
  let innerRan = 0;
  const inner = createServerSideReference(
    registerServerReference(`${prefix}-inner`, () => {
      innerRan++;
      return "the inner secret";
    })
  );
  registerServerFunction(`${prefix}-outer`, async () => (inner as any)());
  return {
    ranInner: () => innerRan,
    reset: () => (innerRan = 0)
  };
}

describe("the wrap that owns a request owns the calls made under it", () => {
  it("names both the wire call and the call its body makes, when configured", async () => {
    const seen: string[] = [];
    const pair = registerPair("nested-configured");
    configureServerFunctionsServer({
      wrapInvocation: (run, context) => {
        seen.push(`${context.id}:${context.direct ? "direct" : "http"}`);
        return run();
      }
    });

    const response = await handleServerFunctionRequest(post("nested-configured-outer"), {
      createEvent
    });

    expect(response.status).toBe(200);
    expect(pair.ranInner()).toBe(1);
    // the configured hook is a real hop-by-hop seam: it sees the entry and
    // the in-process call the entry made
    expect(seen).toStrictEqual(["nested-configured-outer:http", "nested-configured-inner:direct"]);
  });

  it("names both when the wrap arrives as a per-handler option instead", async () => {
    const seen: string[] = [];
    const pair = registerPair("nested-option");

    const response = await handleServerFunctionRequest(post("nested-option-outer"), {
      createEvent,
      wrapInvocation: (run, context) => {
        seen.push(`${context.id}:${context.direct ? "direct" : "http"}`);
        return run();
      }
    });

    expect(response.status).toBe(200);
    expect(pair.ranInner()).toBe(1);
    // today: only ["nested-option-outer:http"] — the nested body ran with
    // no policy at all, inside the very request the option was given for
    expect(seen).toStrictEqual(["nested-option-outer:http", "nested-option-inner:direct"]);
  });

  it("stops the nested body when the request's wrap declines, not only the entry", async () => {
    const pair = registerPair("nested-deny");

    const response = await handleServerFunctionRequest(post("nested-deny-outer"), {
      createEvent,
      wrapInvocation: (run, context) => {
        // an authorization check that clears the entry point and refuses
        // what it reaches — the reason a gate runs per invocation
        if (context.id === "nested-deny-inner") throw new Response(null, { status: 403 });
        return run();
      }
    });

    // today: 200, and `ranInner()` is 1 — the refusal never had the chance
    // to fire because the nested invocation never consulted the option
    expect(pair.ranInner()).toBe(0);
    expect(response.status).toBe(403);
  });
});
