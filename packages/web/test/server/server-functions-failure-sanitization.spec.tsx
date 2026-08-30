/**
 * `sanitizeServerError` guards the one road a thrown error takes out of
 * dispatch. A failure can also escape through the RESULT GRAPH — a
 * rejected promise, an async iterable that throws, a stream that errors —
 * where it reaches the codec as a value to encode rather than as a throw.
 * Same failure, different road, and the leak is the exact one the
 * sanitizer exists to stop: an ORM error's message and own-properties
 * (failing query, connection string, bound params) riding the wire
 * verbatim, under a 200 carrying no error tag because the head is already
 * committed.
 *
 * `markSafeError` stays the escape hatch on both roads.
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

function scriptedPost(id: string) {
  return new Request(`https://app.example/_server/data/${id}`, {
    method: "POST",
    body: "[]",
    headers: {
      "Sec-Fetch-Site": "same-origin",
      "X-Server-Function-Instance": "server-function:test"
    }
  });
}

async function bodyOf(id: string) {
  const response = await handleServerFunctionRequest(scriptedPost(id));
  try {
    return await response.text();
  } catch {
    return "";
  }
}

describe("a failure escaping through the result graph is sanitized", () => {
  const channels: Record<string, () => unknown> = {
    "an async iterable that throws": async function* () {
      yield { page: 1 };
      throw databaseError();
    },
    "a rejected promise in the graph": async () => ({ deferred: Promise.reject(databaseError()) }),
    "a stream that errors in the graph": async () => ({
      rows: new ReadableStream({
        start(controller) {
          controller.enqueue("first");
          queueMicrotask(() => controller.error(databaseError()));
        }
      })
    })
  };

  it.each(Object.keys(channels))("%s", async channel => {
    const id = `graph-failure-${Object.keys(channels).indexOf(channel)}`;
    registerServerFunction(id, channels[channel] as () => unknown);

    const body = await bodyOf(id);

    expect(body).not.toContain("hunter2");
    expect(body).not.toContain("10.0.0.5");
    expect(body).not.toContain("SELECT * FROM users");
    expect(body).not.toContain("abc123");
  });

  it("keeps an error the author branded as intentional", async () => {
    registerServerFunction("graph-failure-safe", async function* () {
      yield { page: 1 };
      throw markSafeError(new Error("Order 42 not found"));
    });

    expect(await bodyOf("graph-failure-safe")).toContain("Order 42 not found");
  });
});
