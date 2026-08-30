/**
 * Failure is the protocol's own error tag, not the HTTP status (#3097).
 *
 * The status line is the author's data channel: `respond(value, { status:
 * 500 })` RESOLVES with the value — return vs throw decides the outcome,
 * and the tag is how thrownness travels. The server agrees from its side:
 * a plain thrown error answers a real 500 (so CDN metrics, load-balancer
 * health checks and log alerts see what the tag tells the client) with the
 * tag and the encoded error in the body. A peer's own 5xx — proxy, load
 * balancer — carries no body-format header and is refused before decoding,
 * so the status never needs to double as the failure signal.
 *
 * Like the other server-function specs, these run against the built
 * bundles (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { markSafeError, respond } from "@solidjs/web";
import {
  ERROR_HEADER,
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";

// not re-exported from the server entry; the wire name is the contract here
const BODY_FORMAT_HEADER = "X-Server-Function-Format";
import { createServerReference } from "@solidjs/web/server-functions/client";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

function scripted(id: string) {
  return new Request(`https://app.example/_server/data/${id}`, {
    method: "POST",
    headers: {
      "Sec-Fetch-Site": "same-origin",
      "X-Server-Function-Instance": "server-function:test"
    }
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

describe("a thrown error answers a real 500 (#3097)", () => {
  it("wire: status 500, tagged, error encoded in the body", async () => {
    registerServerFunction("fs-plain-throw", async () => {
      throw markSafeError(new Error("the disk is gone"));
    });

    const wire = await handleServerFunctionRequest(scripted("fs-plain-throw"));
    expect(wire.status).toBe(500);
    expect(wire.headers.has(ERROR_HEADER)).toBe(true);
    // the runtime encoded it — what separates this 500 from a proxy's
    expect(wire.headers.has(BODY_FORMAT_HEADER)).toBe(true);
  });

  it("client: rejects with the decoded error, status stamped for policy layers", async () => {
    registerServerFunction("fs-plain-throw-client", async () => {
      throw markSafeError(new Error("the disk is gone"));
    });
    disconnects.push(connectTransport());

    const fn = createServerReference("fs-plain-throw-client");
    const error = await fn().then(
      () => {
        throw new Error("expected rejection");
      },
      (x: unknown) => x
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("the disk is gone");
    // 5xx classifies as transient for retry policy (live loops, routers)
    expect((error as Error & { status?: number }).status).toBe(500);
  });

  it("an unmarked error still sanitizes — at 500 now, not 200", async () => {
    registerServerFunction("fs-plain-throw-sanitized", async () => {
      throw new Error("secret internals");
    });
    disconnects.push(connectTransport());

    const wire = await handleServerFunctionRequest(scripted("fs-plain-throw-sanitized"));
    expect(wire.status).toBe(500);

    const fn = createServerReference("fs-plain-throw-sanitized");
    const error = await fn().then(
      () => {
        throw new Error("expected rejection");
      },
      (x: unknown) => x
    );
    expect((error as Error).message).not.toContain("secret internals");
  });
});

describe("the status is the author's data channel (#3097)", () => {
  it("respond(value, { status: 500 }) resolves with the value", async () => {
    registerServerFunction("fs-respond-500", async () =>
      respond({ degraded: true }, { status: 500 })
    );
    disconnects.push(connectTransport());

    const wire = await handleServerFunctionRequest(scripted("fs-respond-500"));
    expect(wire.status).toBe(500);
    expect(wire.headers.has(ERROR_HEADER)).toBe(false);

    const fn = createServerReference("fs-respond-500");
    await expect(fn()).resolves.toEqual({ degraded: true });
  });

  it("return vs throw decides, at the same status", async () => {
    registerServerFunction("fs-respond-404-return", async () =>
      respond({ found: false }, { status: 404 })
    );
    registerServerFunction("fs-respond-404-throw", async () => {
      throw respond({ found: false }, { status: 404 });
    });
    disconnects.push(connectTransport());

    // both directions carry the author's status on the wire
    const returnedWire = await handleServerFunctionRequest(scripted("fs-respond-404-return"));
    expect(returnedWire.status).toBe(404);
    const thrownWire = await handleServerFunctionRequest(scripted("fs-respond-404-throw"));
    expect(thrownWire.status).toBe(404);
    expect(thrownWire.headers.has(ERROR_HEADER)).toBe(true);

    const returned = createServerReference("fs-respond-404-return");
    await expect(returned()).resolves.toEqual({ found: false });

    // the rejection is the author's thrown value, verbatim — not an Error
    // synthesized around it
    const thrown = createServerReference("fs-respond-404-throw");
    const rejection = await thrown().then(
      () => {
        throw new Error("expected rejection");
      },
      (x: unknown) => x
    );
    expect(rejection).toEqual({ found: false });
  });
});

describe("a peer's own 5xx is still refused (#3097)", () => {
  it("no body format means the response is not the runtime's — throw, do not decode", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("<html>Bad Gateway</html>", { status: 502 })) as typeof fetch;
    disconnects.push(() => {
      globalThis.fetch = original;
    });

    const fn = createServerReference("fs-peer-502");
    const error = await fn().then(
      () => {
        throw new Error("expected rejection");
      },
      (x: unknown) => x
    );
    expect((error as Error).message).toBe("Server function call failed with status 502");
    expect((error as Error & { status?: number }).status).toBe(502);
  });
});
