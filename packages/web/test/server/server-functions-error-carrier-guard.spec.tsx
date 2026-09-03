/**
 * A non-plain carrier must not shelter a failure channel from the result
 * guard (#3235, the Error-carrier half of the walk's reach).
 *
 * `guardFailures` walks a result before the codec encodes it and wraps
 * every failure channel it finds — a rejecting promise, a throwing async
 * iterable, an erroring stream — so the failure is sanitized before it
 * rides a 200 whose head is already committed, and so the response
 * teardown can close the source when the caller leaves.
 *
 * A walk protects only what it VISITS. A carrier whose prototype is not
 * `Object.prototype` used to be handed back untouched, channels and all —
 * but `Object.assign(new Error(...), { ... })` is the ordinary shape of a
 * domain failure carrying its context, and the codec does not share the
 * walk's opinion of it: seroval encodes an Error's own enumerable
 * properties like any other object's. So the payload underneath was
 * serialized having never been guarded. The control in every row is the
 * same channel under a plain object, which is sanitized today.
 *
 * Only ENUMERABLE own properties are the walk's business here — the codec
 * reads exactly those — and hidden accessors stay hidden and uninvoked
 * (see `server-functions-result-descriptors.spec.tsx`, and 47995412's
 * ruling). Reaching the payload by rebuilding the carrier through a PLAIN
 * shell is not a fix either: the codec would encode an ordinary object,
 * and the caller would be handed `{ message, code }` where the author
 * returned an Error. Every case here asserts the carrier's own message,
 * its extra own data and its identity survive ALONGSIDE the sanitization.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs), which are
 * the production variant — `DEV` is false, so the sanitizer is live.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
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

const H = {
  "Sec-Fetch-Site": "same-origin",
  "X-Server-Function-Format": "8",
  "X-Server-Function-Instance": "server-function:test"
};

/** The secret a driver error carries; it must never reach the wire. */
const SECRET = "postgres://app:hunter2@10.0.0.5:5432";
/** What the sanitizer puts on the wire in its place. */
const SANITIZED = "Internal Server Error";
/** The carrier's own message — the author's value, which must survive. */
const CARRIER = "checkout failed";

class ValidationError extends Error {}

/** A driver error as one actually arrives: secrets in message and own props. */
function databaseError() {
  return Object.assign(new Error(`connect ECONNREFUSED ${SECRET}`), {
    connectionString: SECRET
  });
}

function scriptedPost(id: string, signal?: AbortSignal) {
  return new Request(`https://app.example/_server/data/${id}`, {
    method: "POST",
    body: "[]",
    headers: H,
    signal
  });
}

async function wireBody(id: string, fn: () => unknown) {
  registerServerFunction(id, fn);
  const response = await handleServerFunctionRequest(scriptedPost(id));
  return { status: response.status, body: await response.text() };
}

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

describe("a non-plain carrier does not shelter a failure channel (#3235, result road)", () => {
  // Every row is the SAME channel under a different carrier, and every row
  // runs the plain-object control first: a row that fails while its control
  // passes is the walk declining to look, not a broken harness.
  const carriers: [string, () => object][] = [
    [
      "an Error carrying the channel as an own property",
      () => Object.assign(new Error(CARRIER), { chan: Promise.reject(databaseError()) })
    ],
    [
      "an Error subclass carrying the channel",
      () => Object.assign(new ValidationError(CARRIER), { chan: Promise.reject(databaseError()) })
    ],
    [
      "an AggregateError carrying the channel",
      () =>
        Object.assign(new AggregateError([], CARRIER), { chan: Promise.reject(databaseError()) })
    ],
    [
      "an Error nested one level inside a plain result",
      () => ({
        outcome: Object.assign(new Error(CARRIER), { chan: Promise.reject(databaseError()) })
      })
    ],
    [
      "an Error carrying an erroring stream",
      () =>
        Object.assign(new Error(CARRIER), {
          chan: new ReadableStream({
            start(controller) {
              controller.enqueue("first");
              queueMicrotask(() => controller.error(databaseError()));
            }
          })
        })
    ],
    [
      "an Error carrying an async iterable that throws",
      () =>
        Object.assign(new Error(CARRIER), {
          chan: (async function* () {
            yield { page: 1 };
            throw databaseError();
          })()
        })
    ]
  ];

  test.each(carriers)("%s is still sanitized", async (label, make) => {
    const slug = label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    let ran = 0;

    const control = await wireBody(`carrier-control-${slug}`, () => {
      ran++;
      return { chan: Promise.reject(databaseError()) };
    });
    // the control is the working road: the same channel under a plain
    // object. It has to pass, or this row proves nothing.
    expect({
      where: "control",
      status: control.status,
      leaked: control.body.includes(SECRET)
    }).toEqual({ where: "control", status: 200, leaked: false });

    const carried = await wireBody(`carrier-${slug}`, () => {
      ran++;
      return make();
    });

    expect(ran).toBe(2);
    expect({
      carrier: label,
      status: carried.status,
      secretOnWire: carried.body.includes(SECRET),
      sanitizedMarker: carried.body.includes(SANITIZED),
      carrierMessageKept: carried.body.includes(CARRIER)
    }).toEqual({
      carrier: label,
      status: 200,
      secretOnWire: false,
      sanitizedMarker: true,
      // the carrier is the author's returned value: sanitizing what it
      // holds must not cost it its own message
      carrierMessageKept: true
    });
  });

  test("the carrier reaches the client as the Error the author returned", async () => {
    registerServerFunction("carrier-roundtrip", async () =>
      Object.assign(new Error(CARRIER), {
        code: "E_CHECKOUT",
        chan: Promise.reject(databaseError())
      })
    );

    const restore = connectTransport();
    let carrier: any;
    try {
      carrier = await (createServerReference("carrier-roundtrip") as () => Promise<any>)();
    } finally {
      restore();
    }

    // shape first: a fix that rebuilds the carrier through a plain shell
    // changes the value the author returned, and fails right here
    expect({
      isError: carrier instanceof Error,
      message: carrier?.message,
      code: carrier?.code
    }).toEqual({ isError: true, message: CARRIER, code: "E_CHECKOUT" });

    // and the channel it carries arrives sanitized
    const settled = await carrier.chan.then(
      (value: unknown) => ({ rejected: false, message: String(value) }),
      (error: any) => ({ rejected: true, message: error?.message })
    );
    expect(settled).toEqual({ rejected: true, message: SANITIZED });
  });

  test("an endless generator carried by an Error is torn down when the caller leaves", async () => {
    let finallyRan = false;
    let produced = 0;
    registerServerFunction("carrier-teardown", async () =>
      Object.assign(new Error(CARRIER), {
        feed: (async function* () {
          try {
            for (;;) {
              produced++;
              yield { n: produced };
              await new Promise(resolve => setTimeout(resolve, 5));
            }
          } finally {
            finallyRan = true;
          }
        })()
      })
    );

    const response = await handleServerFunctionRequest(scriptedPost("carrier-teardown"));
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise(resolve => setTimeout(resolve, 50));

    // an unguarded producer keeps pumping into a response nobody reads:
    // the generator's `finally` (a DB cursor's close, in the shape this
    // exists for) never runs
    expect({ finallyRan, producedAfterCancel: produced > 0 }).toEqual({
      finallyRan: true,
      producedAfterCancel: true
    });
  });

  test("a hidden accessor on an Error carrier is not the guard's to invoke", async () => {
    // The rejected half of #3235 stays rejected (47995412, #3203): guarding
    // the enumerable channels an Error carries is not a licence for the
    // WALK to invoke what the author hid. The codec's own Error encoding
    // reads every own property name (that read is seroval's, and it was
    // there before the walk descended Errors) — so the getter is read
    // exactly once, by the codec, and the walk adds no read of its own.
    // Had the walk invoked it, the throw would surface through the guard's
    // sanitizer as a dispatch failure (a 500) instead of the codec's own
    // in-band encode failure on the already-committed 200.
    let accessorReads = 0;
    registerServerFunction("carrier-hidden-accessor", async () => {
      const carrier = Object.assign(new Error(CARRIER), {
        chan: Promise.reject(databaseError())
      });
      Object.defineProperty(carrier, "costBasis", {
        get() {
          accessorReads++;
          throw new Error("a hidden accessor is the codec's read, not the walk's");
        },
        enumerable: false,
        configurable: true
      });
      return carrier;
    });

    const response = await handleServerFunctionRequest(scriptedPost("carrier-hidden-accessor"));
    const body = await response.text();

    expect({
      status: response.status,
      accessorReads,
      secretOnWire: body.includes(SECRET)
    }).toEqual({ status: 200, accessorReads: 1, secretOnWire: false });
  });
});
