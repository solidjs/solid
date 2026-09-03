/**
 * A call that is over must END its connection, and it must decide that from
 * the payload rather than from the peer closing the body.
 *
 * The transport mints an AbortController per call precisely so a streaming
 * result can be ENDED and not merely abandoned — aborting the fetch closes
 * the response body here and fires `request.signal` on the server. That
 * controller is wired into exactly one place: the `return()` of the
 * async-iterator wrapper, the leg a `break` in a `for await` walks. Every
 * other way a call finishes leaves it unfired, so nothing ever cancels the
 * reader; and because the codec's ChunkReader holds the body lock, the
 * application cannot cancel it either. The connection stays open for as
 * long as the peer keeps it open.
 *
 * That is not a leak while the peer behaves — a server that ends its body
 * ends the connection. The trigger is any peer that does not: a hung
 * origin, a proxy, a CDN holding the socket after the payload. In a browser
 * over HTTP/1.1 the six-connections-per-origin cap turns six such calls
 * into a wedged origin while every one of them reported success.
 *
 * Two ends are pinned here, both cases where NOTHING is outstanding:
 *
 *  - a streamed result drained to completion. `for await` calls `return()`
 *    on a `break` but not on a natural end, so the guard that exists on the
 *    abandoned leg was never mirrored onto the finished one — the same call,
 *    consumed to the last item, keeps its connection.
 *  - a result that is not an async iterable at all. Once the head chunk has
 *    been interpreted and the value holds no unsettled references, there is
 *    nothing left for a later chunk to say.
 *
 * A result still awaiting values — a promise inside it that has not
 * resolved — is deliberately NOT pinned: that call is not over, and its
 * connection is load-bearing.
 *
 * The transport only owns the signal when the caller brought none; a
 * caller-supplied signal already owns the wire and cancellation stays
 * theirs, which is the escape hatch these calls do not have.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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

type Connections = {
  /** Bodies handed to the transport. */
  opened: number;
  /** Bodies the transport cancelled, or that `init.signal` closed. */
  cancelled: number;
  /** Bodies the peer itself finished. */
  endedByPeer: number;
  readonly open: number;
};

const disconnects: (() => void)[] = [];
afterEach(() => {
  while (disconnects.length) disconnects.pop()!();
});

/**
 * A transport that behaves like a connection rather than a buffer: the
 * response body is a socket, `init.signal` closes it the way a browser's
 * fetch does, and `hold` models the peer that never sends the terminating
 * frame — the payload arrives complete and the socket stays open behind it.
 */
function connectTransport({ hold = false }: { hold?: boolean } = {}): Connections {
  const original = globalThis.fetch;
  const counts: Connections = {
    opened: 0,
    cancelled: 0,
    endedByPeer: 0,
    get open() {
      return this.opened - this.cancelled - this.endedByPeer;
    }
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const address = input instanceof Request ? input.url : input.toString();
    const request = new Request(
      new URL(address, "http://localhost"),
      input instanceof Request ? input : init
    );
    request.headers.set("Sec-Fetch-Site", "same-origin");
    const upstream = await handleServerFunctionRequest(request);
    if (!upstream.body) return upstream;
    counts.opened++;
    const reader = upstream.body.getReader();
    let settled = false;
    const close = () => {
      if (settled) return;
      settled = true;
      counts.cancelled++;
      reader.cancel().catch(() => {});
    };
    init?.signal?.addEventListener("abort", close);
    const body = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          // the peer holding on: the payload is all there, the socket is not
          // closed, and only the reader's own cancel can reclaim it
          if (hold) return new Promise<void>(() => {});
          if (!settled) {
            settled = true;
            counts.endedByPeer++;
          }
          controller.close();
          return;
        }
        controller.enqueue(value);
      },
      cancel: close
    });
    return new Response(body, { status: upstream.status, headers: upstream.headers });
  }) as typeof fetch;
  disconnects.push(() => {
    globalThis.fetch = original;
  });
  return counts;
}

/** Lets the transport's own teardown, if any, run before the count is read. */
const settle = () => new Promise(resolve => setTimeout(resolve, 50));

describe("server-function connection teardown", () => {
  it("ends the connection when a streamed result is drained to its last item", async () => {
    registerServerFunction("teardown-stream", async function* () {
      yield 1;
      yield 2;
      yield 3;
    });

    // The leg that works, kept here because it is what makes the other one a
    // defect rather than a design: abandoning the stream fires the
    // controller through the wrapper's `return()`.
    const abandoned = connectTransport({ hold: true });
    for await (const value of (await createServerReference(
      "teardown-stream"
    )()) as AsyncIterable<number>) {
      expect(value).toBe(1);
      break;
    }
    await settle();
    expect({ ...abandoned, open: abandoned.open }).toMatchObject({
      opened: 1,
      cancelled: 1,
      open: 0
    });

    // The same call consumed to the end. `for await` calls `return()` only
    // on an early exit, so the finished stream — which has strictly less
    // left to say than the abandoned one — keeps its connection forever.
    const drained = connectTransport({ hold: true });
    const seen: number[] = [];
    for await (const value of (await createServerReference(
      "teardown-stream"
    )()) as AsyncIterable<number>) {
      seen.push(value);
    }
    expect(seen).toEqual([1, 2, 3]);
    await settle();
    expect({ ...drained, open: drained.open }).toMatchObject({
      opened: 1,
      cancelled: 1,
      open: 0
    });
  });

  it("ends the connection when the result is not an async iterable", async () => {
    // A `Date` needs the streaming codec (JSON cannot carry it), so the call
    // reads a framed body — but the value holds no unsettled reference, so
    // the head chunk is the whole answer and no later chunk can add to it.
    registerServerFunction("teardown-value", async () => new Date(0));

    const held = connectTransport({ hold: true });
    const value = await createServerReference("teardown-value")();
    expect(value).toBeInstanceOf(Date);
    expect((value as Date).getTime()).toBe(0);
    await settle();
    expect({ ...held, open: held.open }).toMatchObject({ opened: 1, cancelled: 1, open: 0 });
  });

  it("does not wedge a browser's per-origin connection pool", async () => {
    // HTTP/1.1 allows six connections per origin. Six successful calls
    // against a peer that holds its sockets must not be able to stop the
    // seventh — every one of these resolved, so nothing in the application
    // has any reason to suspect the origin is now unreachable.
    registerServerFunction("teardown-pool", async () => new Date(0));
    const pool = connectTransport({ hold: true });
    for (let call = 0; call < 8; call++) {
      expect(await createServerReference("teardown-pool")()).toBeInstanceOf(Date);
    }
    await settle();
    expect(
      pool.open,
      `${pool.open} of ${pool.opened} connections still open after 8 resolved calls`
    ).toBe(0);
  });
});
