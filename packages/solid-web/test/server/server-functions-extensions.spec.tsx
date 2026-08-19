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
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    handleServerFunctionRequest(
      input instanceof Request
        ? input
        : new Request(new URL(input.toString(), "http://localhost"), init)
    )) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
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
      new Request("http://localhost/_server", {
        method: "POST",
        headers: {
          "X-Server-Function-Id": "ext-get-0",
          "X-Server-Function-Instance": "server-function:test"
        }
      })
    );
    expect(granted.status).toBe(200);

    // and GET without a declaration answers 405 too
    registerServerFunction("ext-post-0", async () => "x");
    const undeclared = await handleServerFunctionRequest(
      new Request("http://localhost/_server?id=ext-post-0", { method: "GET" })
    );
    expect(undeclared.status).toBe(405);
    expect(undeclared.headers.get("Allow")).toBe("POST");
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
    expect(ref.url).toContain("id=ext-contract-0");
    expect((ref as any).GET).toBeUndefined();
    expect((ref as any).withOptions).toBeUndefined();
  });
});
