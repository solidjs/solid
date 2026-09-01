/**
 * live()'s reconnect classification (#3100): retry gives up when repeating
 * the request cannot help, and 408/425/429 are the statuses that say it
 * explicitly can — 408 invites a repeat (RFC 9110 §15.5.9), 425 means
 * "after the handshake" (RFC 8470), 429 exists to say "come back later"
 * (RFC 6585 §4). They are also the 4xx most likely to be infrastructure's
 * answer (a rate limiter, a gateway) rather than the application's. A
 * Retry-After on any status is the peer inviting the retry in as many
 * words — and naming the wait, which the transport honors in place of its
 * own backoff guess.
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
import { createServerReference, live } from "@solidjs/web/server-functions/client";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const restores: (() => void)[] = [];
afterEach(() => {
  while (restores.length) restores.pop()!();
});

/**
 * A source that connects once and dies, with every RECONNECT answered by
 * `reconnect()` until `recoverAt` fetches have gone out — then a bodiless
 * 204 carrying the runtime's Void format tag (what the real handler stamps
 * on a bodiless answer — an untagged 2xx is refused as not the runtime's
 * since #3173), which the client resolves as a one-value stream,
 * completing the iteration.
 */
function connectDyingSource(id: string, reconnect: () => Response, recoverAt = 3) {
  registerServerFunction(id, async function* () {
    yield { tick: 1 };
    throw new Error("connection lost");
  });
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    if (calls === 1) {
      const request = new Request(
        new URL(input instanceof Request ? input.url : input.toString(), "http://localhost"),
        input instanceof Request ? input : init
      );
      request.headers.set("Sec-Fetch-Site", "same-origin");
      return handleServerFunctionRequest(request);
    }
    if (calls >= recoverAt)
      return Promise.resolve(
        new Response(null, { status: 204, headers: { "X-Server-Function-Format": "9" } })
      );
    return Promise.resolve(reconnect());
  }) as typeof fetch;
  restores.push(() => {
    globalThis.fetch = original;
  });
  return () => calls;
}

async function drain(iterable: AsyncIterable<unknown>) {
  const values: unknown[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

async function rejectionOf(promise: Promise<unknown>) {
  return promise.then(
    () => {
      throw new Error("expected rejection");
    },
    (x: unknown) => x
  );
}

describe("retryable 4xx reconnects survive (#3100)", () => {
  for (const status of [408, 425, 429]) {
    it(`a ${status} on reconnect retries instead of closing the stream`, async () => {
      const calls = connectDyingSource(
        `live-retry-${status}`,
        () => new Response("nope", { status })
      );
      const values = await drain(live(createServerReference(`live-retry-${status}`))());
      expect(values[0]).toEqual({ tick: 1 });
      expect(calls()).toBe(3); // connect, refused reconnect, recovery
    });
  }

  it("a 503 still retries (the boundary that already worked)", async () => {
    const calls = connectDyingSource("live-retry-503", () => new Response(null, { status: 503 }));
    const values = await drain(live(createServerReference("live-retry-503"))());
    expect(values[0]).toEqual({ tick: 1 });
    expect(calls()).toBe(3);
  });

  it("a bare 403 still fails fast — definite rejections have not loosened", async () => {
    const calls = connectDyingSource("live-retry-403", () => new Response(null, { status: 403 }));
    const error = await rejectionOf(drain(live(createServerReference("live-retry-403"))()));
    expect((error as { status?: number }).status).toBe(403);
    expect(calls()).toBe(2); // connect, refusal — no third attempt
  });
});

describe("Retry-After is the peer naming the wait (#3100)", () => {
  it("invites the retry on any status, and replaces the backoff guess", async () => {
    const calls = connectDyingSource(
      "live-retry-after",
      () => new Response(null, { status: 403, headers: { "Retry-After": "0" } })
    );
    const started = Date.now();
    const values = await drain(live(createServerReference("live-retry-after"))());
    expect(values[0]).toEqual({ tick: 1 });
    expect(calls()).toBe(3);
    // Two deaths: the stream's own (no status — the 500ms backoff floor
    // applies) and the 403's, whose named 0s wait replaces what would
    // otherwise be the DOUBLED 1000ms backoff — the total distinguishes
    // ~500ms (honored) from ~1500ms (guessed).
    expect(Date.now() - started).toBeLessThan(1100);
  });

  it("is stamped on the surfaced error, in seconds, for policy layers", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(null, { status: 429, headers: { "Retry-After": "7" } })) as typeof fetch;
    restores.push(() => {
      globalThis.fetch = original;
    });

    // a FIRST-connect failure always surfaces (retry is for streams that
    // had connected), carrying the classification the retry layers read
    const error = await rejectionOf(createServerReference("live-retry-stamp")());
    expect((error as { status?: number }).status).toBe(429);
    expect((error as { retryAfter?: number }).retryAfter).toBe(7);
  });

  it("converts the HTTP-date form", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 503,
        headers: { "Retry-After": new Date(Date.now() + 5000).toUTCString() }
      })) as typeof fetch;
    restores.push(() => {
      globalThis.fetch = original;
    });

    const error = await rejectionOf(createServerReference("live-retry-date")());
    const retryAfter = (error as { retryAfter?: number }).retryAfter;
    expect(retryAfter).toBeGreaterThanOrEqual(4);
    expect(retryAfter).toBeLessThanOrEqual(6);
  });

  it("drops a header the peer got wrong rather than guessing", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(null, { status: 429, headers: { "Retry-After": "soon" } })) as typeof fetch;
    restores.push(() => {
      globalThis.fetch = original;
    });

    const error = await rejectionOf(createServerReference("live-retry-garbage")());
    expect((error as { status?: number }).status).toBe(429);
    expect("retryAfter" in (error as object)).toBe(false);
  });
});
