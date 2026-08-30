/**
 * Gaps that are open on `next` today. Each test states the behaviour that
 * is wanted and is marked `test.fails`, per the convention in
 * `test/lifecycle-matrix/MATRIX.md`: the marker is the point — the suite
 * stays green while the gap is open and turns red the day it closes, at
 * which point the marker comes off and the test becomes an ordinary guard.
 *
 * Like the other server-function specs, these run against the built
 * bundles (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";
import { createServerReference } from "@solidjs/web/server-functions/client";

const RequestContext = Symbol.for("solid.RequestContext");
const BODY_FORMAT_HEADER = "X-Server-Function-Format";

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

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

/**
 * Routes the client stub through the handler the way a socket does: the
 * body is drained into a buffer first, so a stream that errors mid-flight
 * arrives as a TRUNCATED body rather than as a live exception. That is the
 * difference between an in-process call and a deployed one, and it is the
 * difference this gap hides behind.
 */
function connectBufferedTransport() {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const address = input instanceof Request ? input.url : input.toString();
    const request = new Request(new URL(address, "https://app.example"), init);
    request.headers.set("Sec-Fetch-Site", "same-origin");
    const response = await handleServerFunctionRequest(request);

    const chunks: Uint8Array[] = [];
    try {
      for await (const chunk of response.body ?? []) chunks.push(chunk as Uint8Array);
    } catch {
      /* the wire cut here; whatever arrived is what the client sees */
    }
    return new Response(chunks.length ? Buffer.concat(chunks) : null, {
      status: response.status,
      headers: response.headers
    });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe("a result the codec cannot encode", () => {
  // GAP: the caller receives `undefined`. The function already ran and
  // committed its side effects; only the ENCODING failed, and it failed
  // after the head was committed, so the status is spent and no error tag
  // can be added. The truncated body decodes to the answer a void function
  // gives, so a write that succeeded is indistinguishable from one that
  // returned nothing — and a data layer may retry it.
  test.fails("reaches the caller as a failure rather than as undefined", async () => {
    let ran = 0;
    registerServerFunction("gap-encode-failure", async () => {
      ran++;
      return {
        ok: true,
        get unencodable() {
          throw new Error("cannot encode");
        }
      };
    });

    const restore = connectBufferedTransport();
    let outcome: { resolved: true; value: unknown } | { resolved: false; error: unknown };
    try {
      outcome = { resolved: true, value: await createServerReference("gap-encode-failure")() };
    } catch (error) {
      outcome = { resolved: false, error };
    } finally {
      restore();
    }

    expect(ran).toBe(1);
    expect(outcome.resolved).toBe(false);
    expect((outcome as { error: unknown }).error).toBeInstanceOf(Error);
  });
});

describe("a streamed result nobody is reading", () => {
  // GAP: the producer runs unboundedly ahead. The response stream is built
  // with no `pull` and no queuing strategy, and every codec node is
  // enqueued the moment it is parsed, so the producer runs as fast as it
  // can resolve whether or not anyone reads. On a large or infinite stream
  // one slow client buffers the whole result in server memory, invisibly
  // to application code.
  //
  // Counted in event-loop turns rather than wall-clock: a bounded producer
  // stays near the queue size whatever the machine, an unbounded one
  // tracks the turn count.
  test.fails("does not let the producer run ahead of the consumer", async () => {
    let produced = 0;
    registerServerFunction("gap-backpressure", async function* () {
      while (produced < 100_000) {
        produced++;
        yield { n: produced };
        await new Promise(resolve => setImmediate(resolve));
      }
    });

    const response = await handleServerFunctionRequest(scriptedPost("gap-backpressure"));
    const reader = response.body!.getReader();
    await reader.read();
    for (let turn = 0; turn < 200; turn++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    await reader.cancel();

    expect(produced).toBeLessThan(50);
  });
});

describe("the decode depth cap", () => {
  // GAP: the cap is opt-out. `depthLimit: 64` exists "because payloads may
  // come from an untrusted peer" and guards the seroval path only, while
  // the body format is chosen by the CALLER — selecting the JSON format
  // hands the payload to a bare JSON.parse and skips the cap entirely.
  test.fails("holds whichever body format the caller selects", async () => {
    registerServerFunction("gap-depth", async (value: unknown) => {
      let depth = 0;
      let cursor: any = value;
      while (cursor && typeof cursor === "object" && "a" in cursor) {
        depth++;
        cursor = cursor.a;
      }
      return { depth };
    });

    // comfortably past the 64-level cap, and well short of the ~5900
    // nested objects that overflow V8's default stack in JSON.stringify
    const root: any = {};
    let cursor = root;
    for (let i = 0; i < 500; i++) {
      cursor.a = {};
      cursor = cursor.a;
    }

    const response = await handleServerFunctionRequest(
      new Request("https://app.example/_server/data/gap-depth", {
        method: "POST",
        body: JSON.stringify([root]),
        headers: {
          "Sec-Fetch-Site": "same-origin",
          "X-Server-Function-Instance": "server-function:test",
          [BODY_FORMAT_HEADER]: "8"
        }
      })
    );

    // the capped path answers 400 for a payload past the limit
    expect(response.status).toBe(400);
  });
});
