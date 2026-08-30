/**
 * `sanitizeServerError` guards the one road a thrown error takes out of
 * dispatch. A failure can also escape through the RESULT GRAPH — a
 * rejected promise, an async iterable that throws, a stream that errors —
 * where it reaches the codec as a value to encode rather than as a throw.
 * Same failure, different road, and the leak is the one the sanitizer
 * exists to stop: a driver error's message and own-properties (failing
 * query, connection string, bound params) riding the wire verbatim, under
 * a 200 carrying no error tag because the head is already committed.
 *
 * Every case here round-trips through the client as well as reading the
 * wire. Asserting only that the body lacks the secret passes just as
 * happily when the body is empty or undecodable, which is how a broken
 * first attempt at this fix went green.
 *
 * Like the other server-function specs, these run against the built
 * bundles (server-functions/dist/*, wired up in vite.config.server.mjs),
 * which are the production variant — `DEV` is false, so the sanitizer is
 * live.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { markSafeError } from "@solidjs/web";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";
import { createServerReference } from "@solidjs/web/server-functions/client";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

/** A driver error as one actually arrives: secrets in message and own-props. */
function databaseError() {
  return Object.assign(new Error("connect ECONNREFUSED postgres://app:hunter2@10.0.0.5:5432"), {
    connectionString: "postgres://app:hunter2@10.0.0.5:5432",
    query: "SELECT * FROM users WHERE token = 'abc123'"
  });
}

const SECRETS = ["hunter2", "10.0.0.5", "SELECT * FROM users", "abc123"];

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

async function wireBody(id: string) {
  const response = await handleServerFunctionRequest(
    new Request(`https://app.example/_server/data/${id}`, {
      method: "POST",
      body: "[]",
      headers: {
        "Sec-Fetch-Site": "same-origin",
        "X-Server-Function-Instance": "server-function:test"
      }
    })
  );
  return response.text();
}

async function callThrough(id: string) {
  const restore = connectTransport();
  try {
    return { resolved: true as const, value: await createServerReference(id)() };
  } catch (error) {
    return { resolved: false as const, error };
  } finally {
    restore();
  }
}

describe("a failure escaping through the result graph", () => {
  it("is sanitized when an async iterable throws", async () => {
    registerServerFunction("graph-failure-iterable", async function* () {
      yield { page: 1 };
      throw databaseError();
    });

    const body = await wireBody("graph-failure-iterable");
    for (const secret of SECRETS) expect(body).not.toContain(secret);
    expect(body).toContain("Internal Server Error");
  });

  it("is sanitized when a promise in the graph rejects", async () => {
    registerServerFunction("graph-failure-promise", async () => ({
      deferred: Promise.reject(databaseError())
    }));

    const body = await wireBody("graph-failure-promise");
    for (const secret of SECRETS) expect(body).not.toContain(secret);
    expect(body).toContain("Internal Server Error");
  });

  it("is sanitized when a stream in the graph errors", async () => {
    registerServerFunction("graph-failure-stream", async () => ({
      rows: new ReadableStream({
        start(controller) {
          controller.enqueue("first");
          queueMicrotask(() => controller.error(databaseError()));
        }
      })
    }));

    const body = await wireBody("graph-failure-stream");
    for (const secret of SECRETS) expect(body).not.toContain(secret);
    expect(body).toContain("Internal Server Error");
  });

  it("keeps an error the author branded as intentional", async () => {
    registerServerFunction("graph-failure-safe", async function* () {
      yield { page: 1 };
      throw markSafeError(new Error("Order 42 not found"));
    });

    expect(await wireBody("graph-failure-safe")).toContain("Order 42 not found");
  });
});

describe("what the guard must not disturb", () => {
  // The road that already worked. A first attempt at this fix replaced the
  // encoded Error with a node the client could not read, breaking every
  // sanitized error rather than only the unsanitized ones — and no test
  // noticed, because nothing decoded a sanitized error through the client.
  it("still delivers an ordinary thrown error as a readable Error", async () => {
    registerServerFunction("graph-failure-thrown", async () => {
      throw databaseError();
    });

    const outcome = await callThrough("graph-failure-thrown");
    expect(outcome.resolved).toBe(false);
    expect((outcome as { error: any }).error).toBeInstanceOf(Error);
    expect((outcome as { error: Error }).error.message).toBe("Internal Server Error");
  });

  // An Error reached as a VALUE was never thrown, so it is data and the
  // author's to ship. The guard wraps failure channels, not errors.
  it("leaves an error that is a value alone", async () => {
    registerServerFunction("graph-value-error", async () => ({
      ok: 1,
      failure: new Error("returned, not thrown")
    }));

    const outcome = await callThrough("graph-value-error");
    expect(outcome.resolved).toBe(true);
    expect((outcome as { value: any }).value.failure.message).toBe("returned, not thrown");
  });

  it("passes a healthy result through untouched, nested promise included", async () => {
    registerServerFunction("graph-healthy", async () => ({
      items: [1, 2],
      nested: { deferred: Promise.resolve("value") }
    }));

    const outcome = await callThrough("graph-healthy");
    expect(outcome.resolved).toBe(true);
    const value = (outcome as { value: any }).value;
    expect(value.items).toEqual([1, 2]);
    await expect(value.nested.deferred).resolves.toBe("value");
  });
});
