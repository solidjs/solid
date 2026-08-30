/**
 * Gaps that are open on `next` today, written as `it.fails` so the suite
 * stays green while they are open and turns RED the day each is fixed —
 * at which point the marker comes off and the test becomes an ordinary
 * guard. (The repo's existing idiom for "intended, not yet held" is
 * `test.skip`; these use `.fails` instead because the point is to notice
 * the fix, which a skipped test cannot do.)
 *
 * Each assertion states the behaviour that is wanted, not the behaviour
 * that happens.
 *
 * Like the other server-function specs, these run against the built
 * bundles (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BODY_FORMAT_HEADER,
  ERROR_HEADER,
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
 * reaches the client as a TRUNCATED body rather than as a live exception.
 * That is the difference between an in-process call and a deployed one.
 */
function connectWire() {
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
  // The function already ran and committed its side effects; only the
  // ENCODING failed, and it failed after the head was committed, so the
  // status is spent and no error tag can be added. The truncated body
  // then decodes to `undefined` — the same answer a void function gives.
  // A caller cannot tell "this mutation returned nothing" from "this
  // mutation's result was lost", which is the worst possible reading of a
  // write that succeeded.
  it.fails("reaches the caller as a failure rather than as undefined", async () => {
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

    const disconnect = connectWire();
    try {
      await expect(createServerReference("gap-encode-failure")()).rejects.toThrow();
      expect(ran).toBe(1);
    } finally {
      disconnect();
    }
  });
});

describe("a streamed result with a consumer that reads slowly", () => {
  // The response stream is built with no `pull` and no queuing strategy,
  // and every codec node is enqueued the moment it is parsed, so the
  // producer runs as fast as it can resolve regardless of whether anyone
  // is reading. One slow client on a large or infinite stream therefore
  // buffers the whole result in server memory — invisible to application
  // code, and unbounded.
  it.fails("does not let the producer run unboundedly ahead", async () => {
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
    for (let i = 0; i < 3; i++) {
      await reader.read();
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await reader.cancel();

    // A generous ceiling: a bounded producer stays near the queue size,
    // an unbounded one reaches five figures in this window.
    expect(produced).toBeLessThan(500);
  });
});

describe("the decode depth cap", () => {
  // The codec's `depthLimit: 64` exists "because payloads may come from an
  // untrusted peer", and it guards the seroval path only. The body format
  // is chosen by the CALLER, so selecting the JSON format opts out of the
  // cap entirely: `extractBody` hands the payload to a bare JSON.parse.
  it.fails("holds whichever body format the caller selects", async () => {
    registerServerFunction("gap-depth", async (value: unknown) => {
      let depth = 0;
      let cursor: any = value;
      while (cursor && typeof cursor === "object" && "a" in cursor) {
        depth++;
        cursor = cursor.a;
      }
      return { depth };
    });

    const root: any = {};
    let cursor = root;
    for (let i = 0; i < 5_000; i++) {
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

    // the seroval path answers 400 for a payload past the cap
    expect(response.status).toBe(400);
    expect(response.headers.has(ERROR_HEADER)).toBe(false);
  });
});
