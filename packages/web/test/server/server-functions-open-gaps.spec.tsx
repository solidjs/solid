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
import { createRequestEvent } from "@solidjs/web";

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
      "X-Server-Function-Format": "8",
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

  // The gate has to REOPEN, not merely close, and nothing above proves it:
  // a consumer that reads in a tight loop always has a read request
  // pending, so `desiredSize` never drops and the producer never parks.
  // Pausing between reads is what puts it on the gate. Deleting `pull()`
  // outright leaves every other test in this file green and deadlocks this
  // one, which is the whole point of it.
  test("keeps delivering after the consumer pauses long enough to park it", async () => {
    registerServerFunction("gap-backpressure-park", async function* () {
      for (let n = 0; n < 12; n++) yield { n };
    });

    const response = await handleServerFunctionRequest(scriptedPost("gap-backpressure-park"));
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let body = "";

    for (;;) {
      // long enough for the queue to drain and the next pull to park
      for (let turn = 0; turn < 5; turn++) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      const next = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("the gate parked and never reopened")), 2000)
        )
      ]);
      if (next.done) break;
      body += decoder.decode(next.value as Uint8Array);
    }

    // every item arrived, so the gate released each park in turn. Counted
    // by this test's own key rather than by the codec's node shapes, which
    // are not what it is about.
    expect(body.split('["n"]').length - 1).toBe(12);
  });

  // A pull parked on the gate holds the source open, and `desiredSize` is 0
  // after close and null after error — so the gate never reopens on its own
  // and every path that ends the stream has to release it. Without that the
  // source's cleanup silently never runs, once per failed request.
  test("a codec failure landing while a pull is parked still closes the source", async () => {
    let cleanedUp = false;
    let produced = 0;
    // The failure has to ride INSIDE a yielded chunk of the top-level
    // source. Putting it on a sibling branch makes the generator nested,
    // and a nested iterable never reaches the gate at all — which is why
    // `produced` is asserted too: it proves the source really parked, so
    // this cannot quietly decay into testing nothing.
    registerServerFunction("gap-backpressure-teardown", async function* () {
      try {
        produced++;
        yield {
          late: Promise.resolve().then(() => ({
            get boom(): never {
              throw new Error("unencodable, discovered after the gate parked");
            }
          }))
        };
        for (let n = 0; n < 20; n++) {
          produced++;
          yield { n };
        }
      } finally {
        cleanedUp = true;
      }
    });

    const response = await handleServerFunctionRequest(scriptedPost("gap-backpressure-teardown"));
    const reader = response.body!.getReader();
    await reader.read();
    for (let turn = 0; turn < 20; turn++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    expect(produced).toBe(1);
    expect(cleanedUp).toBe(true);
  });

  // Closed (#3125): the demand gate and the teardown registry now ride
  // guardFailures' walk, so a stream NESTED inside the result — `{ items:
  // rows() }`, the cursor-beside-a-total shape — gets the same two
  // guarantees as `return rows()`. Before, only the top-level value was
  // wrapped: a nested generator produced unbounded (200k items in 300ms in
  // the report) and its `finally` never ran after cancel — a permanent
  // resource leak per abandoned request.
  test("a nested stream does not run ahead of the consumer (#3125)", async () => {
    let produced = 0;
    registerServerFunction("gap-nested-backpressure", async () => {
      const rows = (async function* () {
        while (produced < 100_000) {
          produced++;
          yield { n: produced };
          await new Promise(resolve => setImmediate(resolve));
        }
      })();
      return { items: rows, total: 100_000 };
    });

    const response = await handleServerFunctionRequest(scriptedPost("gap-nested-backpressure"));
    const reader = response.body!.getReader();
    await reader.read();
    for (let turn = 0; turn < 200; turn++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    await reader.cancel();

    expect(produced).toBeLessThan(50);
  });

  test("cancel tears down a nested stream — its finally runs (#3125)", async () => {
    let produced = 0;
    let finallyRan = false;
    registerServerFunction("gap-nested-teardown", async () => {
      const rows = (async function* () {
        try {
          for (;;) {
            produced++;
            yield { n: produced };
            await new Promise(resolve => setImmediate(resolve));
          }
        } finally {
          finallyRan = true;
        }
      })();
      return { items: rows };
    });

    const response = await handleServerFunctionRequest(scriptedPost("gap-nested-teardown"));
    const reader = response.body!.getReader();
    await reader.read();
    const atCancel = produced;
    await reader.cancel();
    for (let turn = 0; turn < 50; turn++) {
      await new Promise(resolve => setImmediate(resolve));
    }

    expect(finallyRan).toBe(true);
    // give or take the pull in flight when the cancel landed
    expect(produced).toBeLessThanOrEqual(atCancel + 1);
  });

  test("an abort of the request signal tears down a nested stream (#3125)", async () => {
    let finallyRan = false;
    registerServerFunction("gap-nested-abort", async () => {
      const rows = (async function* () {
        try {
          for (let n = 0; ; n++) {
            yield { n };
            await new Promise(resolve => setImmediate(resolve));
          }
        } finally {
          finallyRan = true;
        }
      })();
      return { items: rows };
    });

    const controller = new AbortController();
    const request = new Request("https://app.example/_server/data/gap-nested-abort", {
      method: "POST",
      body: "[]",
      signal: controller.signal,
      headers: {
        "Sec-Fetch-Site": "same-origin",
        "X-Server-Function-Format": "8",
        "X-Server-Function-Instance": "server-function:test"
      }
    });
    const response = await handleServerFunctionRequest(request);
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    for (let turn = 0; turn < 50; turn++) {
      await new Promise(resolve => setImmediate(resolve));
    }

    expect(finallyRan).toBe(true);
  });

  // The multi-source half of #3125: the codec pumps every stream in the
  // graph concurrently, so the gate is a waiter LIST and a pull wakes all
  // of it. Waking one would strand the rest the first time a woken source
  // stepped to done (no chunk enqueued, no further pull). Both sources
  // must drain fully — this is the nested analog of the "parked and never
  // reopened" test above — and both finallys must run at the end.
  test("two nested streams share the gate, both drain, both close (#3125)", async () => {
    const closed: string[] = [];
    registerServerFunction("gap-nested-pair", async () => {
      const make = (name: string, count: number) =>
        (async function* () {
          try {
            for (let n = 0; n < count; n++) yield `${name}${n}`;
          } finally {
            closed.push(name);
          }
        })();
      return { a: make("a", 7), b: make("b", 3) };
    });

    const response = await handleServerFunctionRequest(scriptedPost("gap-nested-pair"));
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let body = "";
    for (;;) {
      // pause long enough for the queue to drain and the pulls to park
      for (let turn = 0; turn < 5; turn++) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      const next = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("a parked nested source was never woken")), 2000)
        )
      ]);
      if (next.done) break;
      body += decoder.decode(next.value as Uint8Array);
    }

    for (let n = 0; n < 7; n++) expect(body).toContain(`"a${n}"`);
    for (let n = 0; n < 3; n++) expect(body).toContain(`"b${n}"`);
    expect(closed.sort()).toEqual(["a", "b"]);
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

    // This pins the CANCEL half — that a departed consumer stops the
    // producer. It does not catch a gate that never reopens: reading in a
    // tight loop keeps a read request pending, so `desiredSize` never
    // drops and nothing ever parks. The pausing test above is the one that
    // catches that, and it took two attempts to learn the difference.
    expect(whileReading).toBeGreaterThanOrEqual(10);
    // ...and a departed consumer stops it, give or take the pull in flight
    expect(produced).toBeLessThanOrEqual(atCancel + 1);
  });
});

describe("composed header bounds at the transport edge (#3158)", () => {
  // Closed (#3158): redirect() refused an over-long target but a raw
  // Response reached the wire with a ~1 MB redirect header, to die at the
  // proxy after the mutation committed. The bound is now a property of the
  // transport — enforced where the composed headers leave, for every
  // producer — with the helpers' authoring-time throws as the fast path.
  test("a raw Response's over-long Location is refused, not shipped", async () => {
    registerServerFunction(
      "gap-bigloc-raw",
      async () => new Response(null, { status: 302, headers: { Location: "/" + "x".repeat(1e6) } })
    );
    const response = await handleServerFunctionRequest(scriptedPost("gap-bigloc-raw"));
    expect(response.status).toBe(500);
    expect(response.headers.get("X-Server-Function-Redirect")).toBeNull();
    expect(response.headers.get("X-Server-Function-Error")).not.toBeNull();
  });

  test("a raw Response's over-long X-Revalidate is refused too", async () => {
    registerServerFunction(
      "gap-bigreval-raw",
      async () =>
        new Response(null, {
          status: 200,
          headers: { "X-Revalidate": Array.from({ length: 2000 }, (_, i) => `key-${i}`).join(",") }
        })
    );
    const response = await handleServerFunctionRequest(scriptedPost("gap-bigreval-raw"));
    expect(response.status).toBe(500);
    expect(response.headers.get("X-Revalidate")).toBeNull();
  });

  test("controls: a small raw redirect masks normally; the helper still refuses in-body", async () => {
    registerServerFunction(
      "gap-smallloc-raw",
      async () => new Response(null, { status: 302, headers: { Location: "/next" } })
    );
    const small = await handleServerFunctionRequest(scriptedPost("gap-smallloc-raw"));
    expect(small.status).toBe(200);
    expect(small.headers.get("X-Server-Function-Redirect")).toBe("302 https://app.example/next");

    // The helper's own refusal (the authoring-time TypeError) rides the
    // ordinary error road — same terminal shape, better message, and the
    // transport check never fires for it.
    const { redirect } = await import("@solidjs/web");
    registerServerFunction("gap-bigloc-helper", async () => redirect("/" + "x".repeat(1e6)));
    const helper = await handleServerFunctionRequest(scriptedPost("gap-bigloc-helper"));
    expect(helper.status).toBe(500);
    expect(helper.headers.get("X-Server-Function-Redirect")).toBeNull();
  });
});

describe("refusals after createEvent carry the response stub (#3159)", () => {
  // Closed (#3159): the post-createEvent refusals returned their response
  // directly instead of through commitEventResponse, so a Set-Cookie the
  // integration wrote onto the event's stub — a rotated session, a fresh
  // CSRF token: the shape createEvent is the documented place for — was
  // silently dropped on exactly the requests where something already went
  // wrong. Every exit past createEvent now folds the stub.
  const createEvent = (request: Request) => {
    const event = createRequestEvent(request);
    event.response.headers.append("Set-Cookie", "sid=abc; Path=/");
    return event;
  };
  const H = {
    "Sec-Fetch-Site": "same-origin",
    "X-Server-Function-Format": "8",
    "X-Server-Function-Instance": "server-function:test"
  };

  test("the 200 control carries the cookie", async () => {
    registerServerFunction("gap-refusal-control", async () => "ok");
    const response = await handleServerFunctionRequest(scriptedPost("gap-refusal-control"), {
      createEvent
    });
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toContain("sid=abc; Path=/");
  });

  test("the maxArguments 400 carries the cookie", async () => {
    registerServerFunction("gap-refusal-args", async () => "unreached");
    const response = await handleServerFunctionRequest(
      new Request("https://app.example/_server/data/gap-refusal-args", {
        method: "POST",
        headers: H,
        body: JSON.stringify(Array.from({ length: 2000 }, (_, i) => i))
      }),
      { createEvent }
    );
    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie()).toContain("sid=abc; Path=/");
  });

  test("the malformed-body 400 carries the cookie", async () => {
    registerServerFunction("gap-refusal-malformed", async () => "unreached");
    const response = await handleServerFunctionRequest(
      new Request("https://app.example/_server/data/gap-refusal-malformed", {
        method: "POST",
        headers: H,
        body: "not the encoding it claims["
      }),
      { createEvent }
    );
    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie()).toContain("sid=abc; Path=/");
  });

  test("the scripted form-post 400 carries the cookie", async () => {
    registerServerFunction("gap-refusal-form", async () => "unreached");
    const response = await handleServerFunctionRequest(
      new Request("https://app.example/_server/gap-refusal-form", {
        method: "POST",
        headers: {
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "cors",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "a=1"
      }),
      { createEvent }
    );
    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie()).toContain("sid=abc; Path=/");
  });
});

describe("a deep result (#3160)", () => {
  // Closed (#3160): guardFailures walked the result recursively, so a
  // deep-but-legal return value overflowed the stack and the RangeError
  // escaped into dispatch's catch — a successful, committed call reported
  // as a generic 500 (the #3117 phantom-failure shape, and the exact hazard
  // the function's own getter policy names). The walk now carries an
  // explicit stack, like isJSONSafe before it, and any residual synchronous
  // throw on the codec road is renamed to an encode error before rethrow.
  const deep = (n: number) => {
    let o: any = {};
    const root = o;
    for (let i = 0; i < n; i++) {
      o.n = {};
      o = o.n;
    }
    return root;
  };

  test("is never reported as a failed call", async () => {
    // 20k overflowed the recursive walk; 200k pins that the cliff is gone,
    // not relocated.
    for (const depth of [20_000, 200_000]) {
      let ran = 0;
      registerServerFunction(`gap-deep-${depth}`, async () => {
        ran++;
        return deep(depth);
      });
      const response = await handleServerFunctionRequest(scriptedPost(`gap-deep-${depth}`));
      expect(ran, `depth ${depth}: function ran`).toBe(1);
      // The phantom shape was status=500 + generic error header with an
      // empty body. The honest answer commits the head and streams.
      expect(response.status, `depth ${depth}`).toBe(200);
      expect(response.headers.get("X-Server-Function-Error")).toBeNull();
      const body = await response.text();
      expect(body.length).toBeGreaterThan(0);
    }
  });

  test("cycle identity survives the iterative walk", async () => {
    // The rewrite carries the recursive walk's cycle contract: a container
    // with a failure channel below rebuilds, and the cycle resolves to the
    // rebuilt container (a back-reference, not a second copy). The nested
    // rejection sanitizes instead of leaking.
    registerServerFunction("gap-cycle-guard", async () => {
      const root: any = { late: Promise.reject(new Error("secret driver detail")) };
      root.self = root;
      return root;
    });
    const restore = connectBufferedTransport();
    try {
      const call = createServerReference("gap-cycle-guard") as any;
      const result = await call();
      expect(result.self).toBe(result);
      await expect(result.late).rejects.toThrow("Internal Server Error");
      await expect(result.late).rejects.not.toThrow("secret driver detail");
    } finally {
      restore();
    }
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

describe("the rc.5 guard batch (#3169, #3170, #3171)", () => {
  const H = {
    "X-Server-Function-Format": "8",
    "X-Server-Function-Instance": "server-function:test"
  };

  // #3169: the CSRF origin matcher's verdict is a security gate, so only a
  // literal `true` may open it. Coercion read a truthy non-boolean — the
  // natural return of a matcher that names or explains its decision — as
  // "allow", failing open cross-origin. No Sec-Fetch-Site on these
  // requests: with it present the gate short-circuits before the matcher.
  test("a truthy non-boolean from the origin matcher fails closed", async () => {
    let ran = 0;
    registerServerFunction("guard-csrf-string", async () => {
      ran++;
      return "should not run";
    });
    for (const verdict of ["no", { allowed: false }, 1] as any[]) {
      const response = await handleServerFunctionRequest(
        new Request("https://app.example/_server/data/guard-csrf-string", {
          method: "POST",
          body: "[]",
          headers: { ...H, Origin: "https://evil.example" }
        }),
        { csrf: { origin: () => verdict } }
      );
      expect(response.status).toBe(403);
    }
    expect(ran).toBe(0);
  });

  test("a literal true from the origin matcher still allows", async () => {
    let ran = 0;
    registerServerFunction("guard-csrf-true", async () => {
      ran++;
      return "ok";
    });
    const response = await handleServerFunctionRequest(
      new Request("https://app.example/_server/data/guard-csrf-true", {
        method: "POST",
        body: "[]",
        headers: { ...H, Origin: "https://partner.example" }
      }),
      { csrf: { origin: async () => true } }
    );
    expect(response.status).toBe(200);
    expect(ran).toBe(1);
  });

  // #3170: an async createEvent is out of contract, but handing its pending
  // Promise downstream as the event dropped every header the integration
  // wrote while still answering 200. The runtime now awaits it.
  test("an async createEvent's cookies reach the wire", async () => {
    registerServerFunction("guard-async-event", async () => "ok");
    const response = await handleServerFunctionRequest(scriptedPost("guard-async-event"), {
      createEvent: async (request: Request) => {
        await Promise.resolve();
        const event = createRequestEvent(request);
        event.response.headers.append("Set-Cookie", "sid=fresh; Path=/");
        return event;
      }
    });
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toContain("sid=fresh; Path=/");
  });

  // #3171: the thrown-path transformResult sat inside the catch with no try
  // of its own — the same throwing hook that answered a contained 500 on
  // the return path escaped the handler entirely on the thrown path.
  test("a throwing transformResult on the thrown path answers a contained 500", async () => {
    registerServerFunction("guard-hook-thrown", async () => {
      throw new Response(null, { status: 418 });
    });
    const response = await handleServerFunctionRequest(scriptedPost("guard-hook-thrown"), {
      createEvent: (request: Request) => {
        const event = createRequestEvent(request);
        event.response.headers.append("Set-Cookie", "sid=kept; Path=/");
        return event;
      },
      transformResult: () => {
        throw new Error("HOOK-BOOM");
      }
    });
    expect(response.status).toBe(500);
    // the event's stub still folds onto the contained failure (#3159)
    expect(response.headers.getSetCookie()).toContain("sid=kept; Path=/");
  });
});
