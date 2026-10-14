/**
 * `respond(value, init)` must accept every value a plain return accepts
 * (#4060). It used to build its passthrough body eagerly with
 * `JSON.stringify(value)`, which throws on a `bigint` — failing the
 * function on both legs (the direct call rejected, the HTTP call answered
 * 500) although neither leg reads that body: the direct leg unwraps `value`
 * (#3910) and the scripted leg re-encodes it through the codec. The body is
 * only for consumers without the client runtime, so it is now encoded when
 * read, and the handler hands an unscripted caller the carried JSON only
 * when JSON carries the value faithfully — otherwise the value negotiates
 * exactly like a plain return.
 *
 * Like the other server-function specs, these run against the built
 * bundles (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestEvent, respond } from "@solidjs/web";
import {
  createServerReference,
  decodeResponse,
  handleServerFunctionRequest,
  registerServerFunction,
  registerServerReference
} from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");
const requestContext = new AsyncLocalStorage<any>();

beforeAll(() => {
  (globalThis as any)[RequestContext] = requestContext;
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

function scripted(id: string) {
  return new Request(`https://app.example/_server/data/${id}`, {
    method: "POST",
    headers: { "Sec-Fetch-Site": "same-origin" }
  });
}

// at the bare address, not a form post: a direct HTTP caller (curl, a script)
function unscripted(id: string) {
  return new Request(`https://app.example/_server/${id}`, {
    method: "POST",
    headers: { "Sec-Fetch-Site": "same-origin" }
  });
}

describe("respond() carries values JSON cannot (#4060)", () => {
  it("constructing the envelope does not throw", () => {
    expect(() => respond({ n: 1n }, { status: 201 })).not.toThrow();
  });

  it("the direct leg resolves with the bigint", async () => {
    const fn = createServerReference(
      registerServerReference("respond-bigint-direct-4060", async () =>
        respond({ n: 1n }, { headers: { "x-extra": "1" } })
      )
    ) as unknown as () => Promise<{ n: bigint }>;
    const event = createRequestEvent(new Request("https://app.example/page"));
    expect(await requestContext.run(event, () => fn())).toEqual({ n: 1n });
  });

  it("the scripted HTTP leg answers 200 with the bigint decoded", async () => {
    registerServerFunction("respond-bigint-scripted-4060", async () =>
      respond({ n: 1n }, { headers: { "x-extra": "1" } })
    );
    const response = await handleServerFunctionRequest(scripted("respond-bigint-scripted-4060"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-extra")).toBe("1");
    expect(await decodeResponse(response)).toEqual({ n: 1n });
  });

  it("the unscripted leg gets a readable body, as a plain return would", async () => {
    registerServerFunction("respond-bigint-unscripted-4060", async () =>
      respond({ n: 1n }, { status: 201, headers: { "x-extra": "1" } })
    );
    const response = await handleServerFunctionRequest(
      unscripted("respond-bigint-unscripted-4060")
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("x-extra")).toBe("1");
    const body = await response.text();
    expect(body.length).toBeGreaterThan(0);
  });

  it("a JSON value is unchanged: real JSON for unscripted callers and envelope readers", async () => {
    registerServerFunction("respond-json-unscripted-4060", async () =>
      respond({ id: 7 }, { status: 201 })
    );
    const response = await handleServerFunctionRequest(unscripted("respond-json-unscripted-4060"));
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ id: 7 });

    const envelope: any = respond({ id: 7 });
    expect(await envelope.json()).toEqual({ id: 7 });
    expect(envelope.value).toEqual({ id: 7 });
  });
});
