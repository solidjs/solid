/**
 * Version skew is recognisable on the wire (#3110).
 *
 * A call whose id is not registered in the deployment that answers it is
 * the ordinary consequence of deploying: tabs stay open, bundles stay
 * cached, rolling deploys serve two versions at once. That 404 is now
 * labelled (`X-Server-Function-Unknown`) and the client names it on the
 * error (`unknownFunction: true`), so an integration can recover — reload
 * the document onto the current build — instead of surfacing a generic
 * failed call. A 404 for a path the address scheme gives no meaning to
 * stays bare: a mistyped route is not skew.
 *
 * Like the other server-function specs, these run against the built
 * bundles (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";
import { UNKNOWN_HEADER, createServerReference } from "@solidjs/web/server-functions/client";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

function post(path: string, headers: Record<string, string> = {}) {
  return new Request(`https://app.example${path}`, {
    method: "POST",
    headers: { "Sec-Fetch-Site": "same-origin", ...headers }
  });
}

/** Routes the client stub's fetch straight into the handler. */
function connectTransport() {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const address = input instanceof Request ? input.url : input.toString();
    const request = new Request(
      new URL(address, "http://localhost"),
      input instanceof Request ? input : init
    );
    request.headers.set("Sec-Fetch-Site", "same-origin");
    return handleServerFunctionRequest(request);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const disconnects: (() => void)[] = [];
afterEach(() => {
  while (disconnects.length) disconnects.pop()!();
});

describe("version skew on the wire (#3110)", () => {
  it("labels the unknown-id 404 at the data address", async () => {
    const wire = await handleServerFunctionRequest(post("/_server/data/getUser-c8cb6025"));
    expect(wire.status).toBe(404);
    expect(wire.headers.get(UNKNOWN_HEADER)).toBe("true");
  });

  it("labels the unknown-id 404 at the bare address too", async () => {
    // The label is about dispatch, not answer shape: a rendered form
    // holding last deploy's action address is skew all the same.
    const wire = await handleServerFunctionRequest(post("/_server/getUser-c8cb6025"));
    expect(wire.status).toBe(404);
    expect(wire.headers.get(UNKNOWN_HEADER)).toBe("true");
  });

  it("labels it for a caller that sends no fetch metadata (#3136)", async () => {
    // The label is the recovery signal, and the callers that most need it
    // are exactly the ones outside a browser's fetch: a CDN revalidating a
    // GET-declared read, an uptime monitor, a server-to-server client.
    // None of them send `Sec-Fetch-Site`, and a removed id is not in
    // METHODS, so it cannot be recognised as a declared read — the CSRF
    // gate answered first with a 403 and the skew was invisible, reading
    // as auth/WAF in the edge logs. Nothing can execute at an unknown id,
    // so there is nothing there for the gate to protect, and the ids were
    // never secret: the compiler ships them in the client bundle.
    for (const path of ["/_server/getUser-c8cb6025", "/_server/data/getUser-c8cb6025"]) {
      const wire = await handleServerFunctionRequest(
        new Request(`https://app.example${path}`, { method: "GET" })
      );
      expect(wire.status).toBe(404);
      expect(wire.headers.get(UNKNOWN_HEADER)).toBe("true");
      // and it does not depend on origin proof, so it does not fragment
      // shared-cache entries on it
      expect(wire.headers.get("Vary")).toBeNull();
    }
  });

  it("leaves the meaningless-path 404 bare", async () => {
    for (const path of ["/_server/", "/_server/data/", "/_server/data/x/y"]) {
      const wire = await handleServerFunctionRequest(post(path));
      expect(wire.status).toBe(404);
      expect(wire.headers.get(UNKNOWN_HEADER)).toBeNull();
    }
  });

  it("names the failure on the client error", async () => {
    disconnects.push(connectTransport());
    const stale = createServerReference("getUser-c8cb6025") as (
      ...args: unknown[]
    ) => Promise<unknown>;
    const outcome = await stale().then(
      () => {
        throw new Error("resolved: the unknown id dispatched");
      },
      (error: any) => error
    );
    expect(outcome).toBeInstanceOf(Error);
    expect(outcome.unknownFunction).toBe(true);
    expect(outcome.status).toBe(404);
    expect(outcome.message).toMatch(/deployment/);
  });

  it("puts no skew flag on an ordinary failure", async () => {
    registerServerFunction("breaks-f00dfeed", async () => {
      throw new Error("broken");
    });
    disconnects.push(connectTransport());
    const breaks = createServerReference("breaks-f00dfeed") as () => Promise<unknown>;
    const outcome = await breaks().then(
      () => {
        throw new Error("resolved: the function did not throw");
      },
      (error: any) => error
    );
    expect(outcome).toBeInstanceOf(Error);
    expect(outcome.unknownFunction).toBeUndefined();
  });
});
