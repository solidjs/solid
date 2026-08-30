/**
 * Gaps that are open on `next` today. Each test states the behaviour that
 * is wanted and is marked `test.fails`, per the convention in
 * `test/lifecycle-matrix/MATRIX.md`: the marker is the point — the suite
 * stays green while the gap is open and turns red the day it closes, at
 * which point the marker comes off and the test becomes an ordinary guard.
 * Each carries the issue that tracks it: #3118 (closed); #3117 (closed by
 * the error trailer frame) and #3119 (closed by #3115's request bounds)
 * remain as ordinary guards, with the trailer's full matrix alongside.
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
  // Closed (#3117): an encode failure now travels IN BAND as a terminal
  // error trailer frame — the head is committed by the time it arrives, so
  // the status is spent and no error tag is possible, and a merely
  // truncated body decodes to the answer a void function gives. The
  // decoder throws the trailer, so a lost result is a failed call, never
  // an empty success. Ordinary guard now.
  test("reaches the caller as a failure rather than as undefined", async () => {
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
    // The trailer is sanitized like any other failure: an encode error's
    // message can carry the value that refused to encode, and this suite
    // runs the production bundles.
    expect(((outcome as { error: unknown }).error as Error).message).toBe("Internal Server Error");
    expect(((outcome as { error: unknown }).error as Error).message).not.toContain("cannot encode");
  });

  // Mid-stream, the head has already resolved with its data; only the value
  // whose encoding failed may be lost, and it must fail rather than hang or
  // silently resolve.
  test("fails a later value whose encoding failed, keeping the delivered head", async () => {
    registerServerFunction("gap-encode-late-failure", async () => ({
      head: 1,
      deferred: Promise.resolve({
        get unencodable() {
          throw new Error("cannot encode");
        }
      })
    }));

    const restore = connectBufferedTransport();
    try {
      const value = (await createServerReference("gap-encode-late-failure")()) as {
        head: number;
        deferred: Promise<unknown>;
      };
      expect(value.head).toBe(1);
      await expect(value.deferred).rejects.toThrow("Internal Server Error");
    } finally {
      restore();
    }
  });

  // The trailer prefix is a wire reserved character; a caller crafting one
  // into its ARGUMENTS must get a malformed-request answer, not a crash and
  // not an echo of its own payload.
  test("answers a crafted trailer frame in the arguments as malformed", async () => {
    registerServerFunction("gap-trailer-injection", async () => "ran");

    const payload = '!{"message":"crafted"}';
    const chunk = `;0x${payload.length.toString(16).padStart(8, "0")};${payload}`;
    const response = await handleServerFunctionRequest(
      new Request("https://app.example/_server/data/gap-trailer-injection", {
        method: "POST",
        body: chunk,
        headers: {
          "Sec-Fetch-Site": "same-origin",
          "X-Server-Function-Instance": "server-function:test",
          [BODY_FORMAT_HEADER]: "0"
        }
      })
    );
    expect(response.status).toBe(400);
  });
});

describe("a streamed result nobody is reading", () => {
  // Closed (#3118): the source is pulled behind a demand gate. The stream
  // was built with no `pull` and no queuing strategy, and every codec node
  // is enqueued the moment it is parsed, so the producer ran as fast as it
  // could resolve whether or not anyone read — one slow client buffered
  // the whole result in server memory, invisibly to application code. The
  // consumer's reads now drive `pull`, which releases one source pull at a
  // time. Ordinary guard now.
  //
  // Counted in event-loop turns rather than wall-clock, so the assertion
  // means the same thing on any machine: a gated producer stays near the
  // queue size, an ungated one tracks the turn count.
  test("does not let the producer run ahead of the consumer", async () => {
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

  test("drains to completion, so the gate cannot swallow the tail", async () => {
    registerServerFunction("gap-backpressure-drain", async function* () {
      for (let n = 0; n < 40; n++) {
        yield { n };
        await new Promise(resolve => setImmediate(resolve));
      }
    });

    const response = await handleServerFunctionRequest(scriptedPost("gap-backpressure-drain"));
    // a gate that never reopened, or one that missed the last chunk, hangs
    // here instead of failing an assertion — which is the point
    expect((await response.text()).length).toBeGreaterThan(0);
  });

  // A pull parked on the gate holds the source open, and `desiredSize` is 0
  // after close and null after error — so the gate never reopens on its own
  // and every path that ends the stream has to release it. Without that the
  // source's cleanup silently never runs, once per failed request.
  test("releases a parked pull when the codec ends the stream", async () => {
    let cleanedUp = false;
    registerServerFunction("gap-backpressure-cleanup", async () => ({
      rows: (async function* () {
        try {
          for (let n = 0; n < 20; n++) {
            yield { n };
            await new Promise(resolve => setImmediate(resolve));
          }
        } finally {
          cleanedUp = true;
        }
      })(),
      unencodable: {
        get boom(): never {
          throw new Error("a deferred encode failure, landing while a pull is parked");
        }
      }
    }));

    const response = await handleServerFunctionRequest(scriptedPost("gap-backpressure-cleanup"));
    const reader = response.body!.getReader();
    // ONE read, then stop: the source parks on the gate, and the encode
    // failure on the sibling branch ends the stream while it is parked.
    // Draining instead would never park, and would never reach the defect.
    await reader.read();
    for (let turn = 0; turn < 20; turn++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    expect(cleanedUp).toBe(true);
  });

  test("resumes as the consumer reads, and stops when it leaves", async () => {
    let produced = 0;
    registerServerFunction("gap-backpressure-resume", async function* () {
      while (produced < 100_000) {
        produced++;
        yield { n: produced };
        await new Promise(resolve => setImmediate(resolve));
      }
    });

    const response = await handleServerFunctionRequest(scriptedPost("gap-backpressure-resume"));
    const reader = response.body!.getReader();
    for (let read = 0; read < 20; read++) await reader.read();
    const whileReading = produced;
    await reader.cancel();
    const atCancel = produced;
    for (let turn = 0; turn < 50; turn++) {
      await new Promise(resolve => setImmediate(resolve));
    }

    // liveness: test 1 passes just as well if the gate never reopens, so
    // this is the case that would catch a deadlock. A healthy run tracks
    // the reads almost exactly; the bound is loose enough for a slow CI.
    expect(whileReading).toBeGreaterThanOrEqual(10);
    // ...and a departed consumer stops it, give or take the pull in flight
    expect(produced).toBeLessThanOrEqual(atCancel + 1);
  });
});

describe("the decode depth cap", () => {
  // Closed (#3119, with #3115's request bounds): the plain-JSON format now
  // walks the decoded payload against the same 64-level ceiling the seroval
  // path enforces, so the caller's format choice no longer opts out of the
  // cap. Kept here as an ordinary guard; the full bounds matrix lives in
  // server-functions-request-bounds.spec.tsx.
  test("holds whichever body format the caller selects", async () => {
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
