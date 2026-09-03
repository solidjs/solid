/**
 * WHAT THE GUARD WALK REFUSES TO LOOK AT.
 *
 * `guardFailures` walks a result before the codec encodes it and wraps
 * every failure channel it finds — a rejecting promise, a throwing async
 * iterable, an erroring stream — so the failure is sanitized before it
 * rides a 200 whose head is already committed, and so the response
 * teardown can close the source when the caller leaves.
 *
 * A walk protects only what it VISITS, and a result reaches it only if the
 * format gate sent it that way. There are two places where that decision
 * goes against the channel:
 *
 * - A carrier whose prototype is not `Object.prototype` is handed back
 *   untouched, channels and all. `Object.assign(new Error(...), { ... })`
 *   is the ordinary shape of a domain failure carrying its context, and the
 *   codec does not share the walk's opinion of it: seroval encodes an
 *   Error's own enumerable properties like any other object's. So the
 *   payload underneath is serialized having never been guarded — the #3200
 *   shape ("a non-plain carrier does not shelter the payload"), which was
 *   closed on the ARGUMENT road only. The control in every row is the same
 *   channel under a plain object, which is sanitized today.
 *
 * - Own properties are picked by ENUMERABILITY, which correctly refuses to
 *   invoke hidden ACCESSORS but also drops non-enumerable DATA properties,
 *   which carry no invocation hazard. Hiding a channel changes nothing
 *   about the wire — every encoder drops it — and everything about whether
 *   anything owns it. Both gates read the same way: `isJSONSafe` calls such
 *   a result JSON-safe and sends it down the fast path, where the walk
 *   never runs at all, and the walk itself would have skipped the slot had
 *   it run. So a rejecting promise there belongs to nobody — it reaches no
 *   handler and takes the process down AFTER the 200 has been delivered —
 *   and a stream there is never registered with the response teardown.
 *
 * The two halves of that second one must hold AT ONCE, which is why the
 * hidden-slot tests park a throwing non-enumerable getter beside the hidden
 * data property: plainly restoring `Object.keys(descriptors)` passes the
 * data half by reintroducing the accessor hazard that commit removed — the
 * hazard `server-functions-result-descriptors.spec.tsx` pins from the other
 * side ("a non-enumerable getter is not invoked while another slot is
 * guarded").
 *
 * Reaching the payload by rebuilding the carrier through a PLAIN shell is
 * not a fix either: the codec would encode an ordinary object, and the
 * caller would be handed `{ message, code }` where the author returned an
 * Error. Every case here asserts the carrier's own message, its extra own
 * data and its identity survive ALONGSIDE the sanitization, so a fix has to
 * keep the carrier itself — its own properties walked in place, or copied
 * through a shell that still carries its prototype.
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

const tick = async (turns: number) => {
  for (let turn = 0; turn < turns; turn++) await new Promise(resolve => setImmediate(resolve));
};

describe("a non-plain carrier does not shelter a failure channel (#3200, result road)", () => {
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
});

describe("a channel on a non-enumerable own property is still the walk's (47995412)", () => {
  /** A hidden own DATA property — no accessor, so nothing to invoke. */
  function hide<T extends object>(target: T, key: string, value: unknown) {
    Object.defineProperty(target, key, {
      value,
      enumerable: false,
      writable: true,
      configurable: true
    });
    return target;
  }

  test("a rejecting promise there is sanitized instead of killing the process after the 200", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    // The other half of the same line: a hidden ACCESSOR must stay unread.
    // A fix that walks all descriptors invokes this and fails the call.
    let accessorReads = 0;
    try {
      registerServerFunction("hidden-slot-promise", async () => {
        const result: any = hide({ ok: 1 }, "audit", Promise.reject(databaseError()));
        Object.defineProperty(result, "costBasis", {
          get() {
            accessorReads++;
            throw new Error("a hidden accessor must not be invoked to guard a sibling");
          },
          enumerable: false,
          configurable: true
        });
        return result;
      });

      const response = await handleServerFunctionRequest(scriptedPost("hidden-slot-promise"));
      const body = await response.text();
      await tick(20);

      expect({
        status: response.status,
        accessorReads,
        // the hidden slot stays hidden: guarding it is not a licence to
        // serialize what `enumerable: false` kept off the wire
        hiddenSlotOnWire: body.includes("audit"),
        secretOnWire: body.includes(SECRET),
        // nobody owns an unguarded rejection in a slot the codec skips too
        unhandled: unhandled.map((error: any) => error?.message)
      }).toEqual({
        status: 200,
        accessorReads: 0,
        hiddenSlotOnWire: false,
        secretOnWire: false,
        unhandled: []
      });
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("a stream there is registered with the response teardown, so an abort closes it", async () => {
    let hiddenCancelled = false;
    let visibleTornDown = false;
    registerServerFunction("hidden-slot-stream", async () => {
      const hiddenFeed = new ReadableStream({
        pull(controller) {
          controller.enqueue("x");
        },
        cancel() {
          hiddenCancelled = true;
        }
      });
      const visible = (async function* () {
        try {
          for (let n = 0; ; n++) {
            yield { n };
            await new Promise(resolve => setImmediate(resolve));
          }
        } finally {
          visibleTornDown = true;
        }
      })();
      return hide({ items: visible }, "hiddenFeed", hiddenFeed);
    });

    const controller = new AbortController();
    const response = await handleServerFunctionRequest(
      scriptedPost("hidden-slot-stream", controller.signal)
    );
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await tick(60);

    // the visible source is the control — teardown reaches everything the
    // walk visited, and only that
    expect({ visibleTornDown, hiddenCancelled }).toEqual({
      visibleTornDown: true,
      hiddenCancelled: true
    });
  });
});
