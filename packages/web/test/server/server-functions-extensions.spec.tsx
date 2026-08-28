/**
 * The server-function extension surface through the @solidjs/web bridge:
 * `GET`, the metadata channel (`withMeta`, `getServerFunctionMetadata`,
 * `isServerFunction`), the `prepareRequest` client hook, and method
 * enforcement.
 *
 * Like the single-flight specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs) — the same
 * artifacts the package publishes. The client and server bundles each carry
 * their own copy of the shared layer, so cross-bundle assertions here also
 * verify the registered-symbol metadata brand does its job.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GET as serverGET,
  createServerReference as createServerSideReference,
  getServerFunctionInvocation,
  getServerFunctionMetadata as getServerFunctionMetadataServer,
  handleServerFunctionRequest,
  isServerFunction as isServerFunctionServer,
  registerServerFunction,
  registerServerReference,
  withMeta as withMetaServer
} from "@solidjs/web/server-functions/server";
import type { ServerFunctionInvocation } from "@solidjs/web/server-functions/server";
import {
  GET,
  configureServerFunctionsClient,
  createServerReference,
  getServerFunctionMetadata,
  isServerFunction,
  observeServerFunctionCalls,
  withMeta
} from "@solidjs/web/server-functions/client";
import type { PrepareRequestHook, ServerFunctionCall } from "@solidjs/web/server-functions/client";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

// The client transport's fetch dispatches straight into the built server
// handler — a full round trip through both published bundles.
function connectTransport() {
  const original = globalThis.fetch;
  // Both halves of the extension surface flow through here: observer tests
  // (#3025) pass a prepared Request through untouched, and the CSRF check
  // (#3027) requires the browser-stamped Sec-Fetch-Site header.
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request =
      input instanceof Request
        ? input
        : new Request(new URL(input.toString(), "http://localhost"), init);
    request.headers.set("Sec-Fetch-Site", "same-origin");
    return handleServerFunctionRequest(request);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/** Delivers a transport request to the built handler, as `connectTransport` does. */
function deliver(address: string, init?: RequestInit) {
  const request = new Request(new URL(address, "http://localhost"), init);
  request.headers.set("Sec-Fetch-Site", "same-origin");
  return handleServerFunctionRequest(request);
}

describe("server-function extension surface (built bundles)", () => {
  it("GET round-trips through both bundles and the handler enforces it", async () => {
    serverGET(
      createServerSideReference(registerServerReference("ext-get-0", async (n: number) => n * 2))
    );
    const restore = connectTransport();
    try {
      const declared = GET(createServerReference("ext-get-0"));
      expect(await declared(21)).toBe(42);
      expect(getServerFunctionMetadata(declared)?.method).toBe("GET");
      expect(declared.id).toBe("ext-get-0");
    } finally {
      restore();
    }

    // POST stays allowed on a GET declaration — declaring GET grants the
    // method, it does not revoke the default POST transport
    const granted = await handleServerFunctionRequest(
      new Request("http://localhost/_server/ext-get-0", {
        method: "POST",
        headers: {
          "Sec-Fetch-Site": "same-origin",
          "X-Server-Function-Instance": "server-function:test"
        }
      })
    );
    expect(granted.status).toBe(200);

    // and GET without a declaration answers 405 too
    registerServerFunction("ext-post-0", async () => "x");
    const undeclared = await handleServerFunctionRequest(
      new Request("http://localhost/_server/ext-post-0", {
        method: "GET",
        headers: { "Sec-Fetch-Site": "same-origin" }
      })
    );
    expect(undeclared.status).toBe(405);
    expect(undeclared.headers.get("Allow")).toBe("POST");
  });

  it("rejects non-function registrations at module eval (export-value boot check)", () => {
    // Module-level "use server" registers each export's *evaluated value* —
    // wrappers compose, and the compiler never inspects initializer shapes.
    // "Is it actually a function" is owned here: a non-function export fails
    // the server boot loudly instead of shipping a dead reference the client
    // discovers per-call.
    expect(() => registerServerReference("ext-boot-0", 5 as any)).toThrow(
      /\(ext-boot-0\) is not a function: a module-level "use server" export must evaluate to a server function \(got number\)/
    );
    expect(() => registerServerReference("ext-boot-1", null as any, "limit")).toThrow(
      /`limit`.*\(got null\)/
    );
  });

  it("exposes the in-flight invocation through the bridge (getServerFunctionInvocation)", async () => {
    // Distinct from getServerFunctionMetadata(fn) — this reads the call in
    // flight off the request event, not a reference's declaration metadata.
    let seen: ServerFunctionInvocation | undefined;
    registerServerFunction("ext-invocation-0", async () => {
      seen = getServerFunctionInvocation();
      return null;
    });
    const restore = connectTransport();
    try {
      await createServerReference("ext-invocation-0")();
      expect(seen).toEqual({ id: "ext-invocation-0" });
    } finally {
      restore();
    }
    // outside a call there is no invocation
    expect(getServerFunctionInvocation()).toBeUndefined();
  });

  it("metadata written by one bundle is read by the other", () => {
    // server bundle writes, client bundle reads — the registered-symbol
    // brand keeps the channel one channel across bundled copies
    const server = withMetaServer(
      createServerSideReference(registerServerReference("ext-meta-0", async () => {})),
      { requiresAuth: true }
    );
    expect(isServerFunction(server)).toBe(true);
    expect(getServerFunctionMetadata(server)).toEqual({ requiresAuth: true });

    // and the other direction
    const client = withMeta(createServerReference("ext-meta-0"), { tenant: "x" });
    expect(isServerFunctionServer(client)).toBe(true);
    expect(getServerFunctionMetadataServer(client)).toEqual({ tenant: "x" });

    expect(isServerFunction(() => {})).toBe(false);
    expect(getServerFunctionMetadata(() => {})).toBeUndefined();
  });

  it("prepareRequest keys per-function behavior on withMeta declarations", async () => {
    registerServerFunction("ext-auth-0", async () => {
      const store = (globalThis as any)[RequestContext].getStore();
      return store.request.headers.get("Authorization");
    });
    registerServerFunction("ext-auth-1", async () => {
      const store = (globalThis as any)[RequestContext].getStore();
      return store.request.headers.get("Authorization");
    });
    const hook: PrepareRequestHook = (init, { meta }) =>
      meta?.requiresAuth
        ? {
            ...init,
            headers: {
              ...(init.headers as Record<string, string>),
              Authorization: "Bearer secret"
            }
          }
        : init;
    configureServerFunctionsClient({ prepareRequest: hook });
    const restore = connectTransport();
    try {
      const authed = withMeta(createServerReference("ext-auth-0"), { requiresAuth: true });
      const plain = createServerReference("ext-auth-1");
      expect(await authed()).toBe("Bearer secret");
      expect(await plain()).toBe(null);
    } finally {
      configureServerFunctionsClient({ prepareRequest: null as any });
      restore();
    }
  });

  it("sends through a configured fetch, which can address a call however it likes", async () => {
    serverGET(
      createServerSideReference(
        registerServerReference("ext-fetch-0", async (word: string) => word.toUpperCase())
      )
    );
    const seen: string[] = [];
    // An app that wants a url of its own: the transport hands over the
    // canonical address, the wrapper sends an app-shaped one, and the app's
    // route rewrites it back before the handler sees it.
    configureServerFunctionsClient({
      fetch(address, init) {
        const app = new URL(address, "http://localhost");
        app.pathname = "/api/upper";
        seen.push(app.pathname + app.search);
        return deliver(
          app.pathname.replace("/api/upper", "/_server/ext-fetch-0") + app.search,
          init
        );
      }
    });
    try {
      expect(await GET(createServerReference("ext-fetch-0"))("solid")).toBe("SOLID");
      expect(seen).toEqual(["/api/upper?args=%5B%22solid%22%5D"]);
    } finally {
      configureServerFunctionsClient({ fetch: null });
    }
  });

  it("hands the fetch one shape whether or not observers are attached", async () => {
    registerServerFunction("ext-fetch-1", async () => "ok");
    const shapes: string[] = [];
    configureServerFunctionsClient({
      fetch(address, init) {
        shapes.push(`${typeof address}:${init?.method}`);
        return deliver(address, init);
      }
    });
    try {
      expect(await createServerReference("ext-fetch-1")()).toBe("ok");
      const stop = observeServerFunctionCalls(() => {});
      try {
        expect(await createServerReference("ext-fetch-1")()).toBe("ok");
      } finally {
        stop();
      }
      expect(shapes).toEqual(["string:POST", "string:POST"]);
    } finally {
      configureServerFunctionsClient({ fetch: null });
    }
  });

  it("hands the fetch the init prepareRequest produced", async () => {
    registerServerFunction("ext-fetch-2", async () => {
      const store = (globalThis as any)[RequestContext].getStore();
      return store.request.headers.get("X-Prepared");
    });
    configureServerFunctionsClient({
      prepareRequest: init => ({
        ...init,
        headers: { ...(init.headers as Record<string, string>), "X-Prepared": "yes" }
      }),
      fetch: (address, init) => deliver(address, init)
    });
    try {
      expect(await createServerReference("ext-fetch-2")()).toBe("yes");
    } finally {
      configureServerFunctionsClient({ prepareRequest: null as any, fetch: null });
    }
  });

  it("sends a GET-declared read through the configured fetch too", async () => {
    serverGET(
      createServerSideReference(registerServerReference("ext-fetch-5", async (n: number) => n * 2))
    );
    const seen: string[] = [];
    const restore = connectTransport();
    const send = globalThis.fetch;
    configureServerFunctionsClient({
      fetch: (address, init) => {
        seen.push(`${init?.method ?? "POST"} ${address}`);
        return send(address, init);
      }
    });
    try {
      expect(await GET(createServerReference("ext-fetch-5"))(21)).toBe(42);
      expect(seen).toEqual(["GET /_server/ext-fetch-5?args=%5B21%5D"]);
    } finally {
      configureServerFunctionsClient({ fetch: null });
      restore();
    }
  });

  it("keeps observers out of the call's way", async () => {
    registerServerFunction(
      "ext-fetch-6",
      async (value: unknown) => (value as any)?.constructor?.name ?? "none"
    );
    const restore = connectTransport();
    const send = globalThis.fetch;
    let seenBody: unknown;
    configureServerFunctionsClient({
      fetch: (address, init) => {
        seenBody = init.body;
        return send(address, init);
      }
    });
    const stop = observeServerFunctionCalls(() => {});
    try {
      // the observed request is reconstructed from the same init, so it must
      // not consume what the send is about to use
      const body = new FormData();
      body.set("k", "v");
      expect(await createServerReference("ext-fetch-6")(body)).toBe("FormData");
      expect(seenBody).toBe(body);
    } finally {
      stop();
      configureServerFunctionsClient({ fetch: null });
      restore();
    }
  });

  it("restores the global fetch when the option is set to null", async () => {
    registerServerFunction("ext-fetch-3", async () => "ok");
    let sends = 0;
    configureServerFunctionsClient({
      fetch: (address, init) => {
        sends++;
        return deliver(address, init);
      }
    });
    const restore = connectTransport();
    try {
      await createServerReference("ext-fetch-3")();
      configureServerFunctionsClient({ fetch: null });
      await createServerReference("ext-fetch-3")();
      expect(sends).toBe(1);
    } finally {
      configureServerFunctionsClient({ fetch: null });
      restore();
    }
  });

  it("observes calls through the client bridge", async () => {
    registerServerFunction("ext-observe-0", async (value: number) => value * 2);
    const calls: ServerFunctionCall[] = [];
    const stop = observeServerFunctionCalls(call => calls.push(call));
    const restore = connectTransport();
    try {
      expect(await createServerReference("ext-observe-0")(21)).toBe(42);
      expect(calls.map(call => call.type)).toEqual(["request", "response"]);
      expect(calls[0]).toMatchObject({
        id: "ext-observe-0",
        instance: expect.any(String)
      });
      expect(calls[1]).toMatchObject({
        id: "ext-observe-0",
        instance: calls[0].instance
      });
    } finally {
      stop();
      restore();
    }
  });

  it("references expose id and drop the legacy escape hatches", () => {
    const ref = createServerReference("ext-contract-0");
    expect(ref.id).toBe("ext-contract-0");
    expect(ref.url).toBe("/_server/ext-contract-0");
    expect((ref as any).GET).toBeUndefined();
    expect((ref as any).withOptions).toBeUndefined();
  });
});
