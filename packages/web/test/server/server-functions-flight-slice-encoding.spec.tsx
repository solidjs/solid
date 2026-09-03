/**
 * A flight slice that cannot be encoded must cost only that slice.
 *
 * `foldFlightData` already states the containment rule in its own comment —
 * "one cache's collector failing must not cost the mutation's outcome or
 * the other caches' slices" — and implements it around the CALL to each
 * hook. But a collector has two ways to fail, and only one of them is a
 * throw: the other is returning a value the wire cannot carry. A query
 * cache handing back an entry that still holds a function, a class instance
 * or a live DB handle encodes nothing, and that failure lands far outside
 * the per-source try — in `encodeResult`, once the envelope is one object
 * and the individual slices are no longer separable.
 *
 * The cost is paid by a mutation that ALREADY COMMITTED. The charge went
 * through; the client's decode throws; the mutation's own return value and
 * every sibling cache's slice are destroyed with it; and the answer is a
 * 200 carrying no failure tag, so no CDN, load balancer or log sees a
 * failure either. The user retries a charge that already succeeded.
 *
 * The sibling case pins the other edge of the same rule: the slice that
 * survives carries a `Date`, so containment cannot be bought by narrowing
 * the fold to what JSON alone can carry. The codec exists precisely so a
 * result needn't be JSON, and cache entries built from ORM rows are the
 * common case, not the exotic one.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  SINGLE_FLIGHT_HEADER,
  decodeResponse,
  handleServerFunctionRequest,
  registerFlightDataSource,
  registerServerFunction
} from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const unregisters: (() => void)[] = [];
afterEach(() => {
  while (unregisters.length) unregisters.pop()!();
});

/** A scripted mutation that advertised `sources` on the request leg. */
function flightRequest(id: string, sources: string) {
  return new Request(`http://localhost/_server/data/${id}`, {
    method: "POST",
    headers: {
      "Sec-Fetch-Site": "same-origin",
      "X-Server-Function-Instance": "server-function:test",
      [SINGLE_FLIGHT_HEADER]: sources
    }
  });
}

/**
 * The whole response as the client sees it: what the transport's own decode
 * makes of the body, plus the wire facts a failure would have to announce
 * itself through.
 */
async function readAsClient(response: Response) {
  const raw = await response.clone().text();
  let payload: any;
  let decodeError: unknown;
  try {
    payload = await decodeResponse(response);
  } catch (error) {
    decodeError = error;
  }
  return {
    status: response.status,
    errorTag: response.headers.get("X-Server-Function-Error"),
    foldedSources: response.headers.get(SINGLE_FLIGHT_HEADER),
    decodeError: decodeError === undefined ? null : String(decodeError),
    payload,
    raw
  };
}

describe("single-flight slice encoding is contained per source", () => {
  it("does not destroy a committed mutation's result when the only slice cannot be encoded", async () => {
    let mutationRan = 0;
    registerServerFunction("sf-encode-solo", async () => {
      mutationRan++;
      return { orderId: "o-1", charged: true };
    });
    // A cache entry that still holds a live handle. Nothing about it is
    // exotic — a function, a class instance or a DB connection does it.
    unregisters.push(registerFlightDataSource("badCache", () => ({ handler: function () {} })));

    const seen = await readAsClient(
      await handleServerFunctionRequest(flightRequest("sf-encode-solo", "badCache"))
    );

    expect(mutationRan, "the mutation must have run — that is the whole point").toBe(1);
    // The client's own decode is the ground truth for "the caller saw a
    // failure": it throws on the codec's error trailer.
    expect(seen.decodeError, `decode threw for a mutation that committed: ${seen.raw}`).toBe(null);
    expect(seen.payload?.value ?? seen.payload, `the mutation's return value: ${seen.raw}`).toEqual(
      {
        orderId: "o-1",
        charged: true
      }
    );
  });

  it("does not take a healthy cache's slice down with an un-encodable sibling", async () => {
    let mutationRan = 0;
    registerServerFunction("sf-encode-pair", async () => {
      mutationRan++;
      return "committed";
    });
    // The healthy slice carries a Date on purpose: it is exactly the shape
    // that separates "the wire cannot carry this" from "JSON cannot carry
    // this". A cache entry off an ORM row is full of them, so a containment
    // rule that answered the second question would take single-flight away
    // from most applications to close the first.
    unregisters.push(
      registerFlightDataSource("goodCache", () => ({ "/orders": [{ at: new Date(0) }] }))
    );
    unregisters.push(registerFlightDataSource("badCache", () => ({ handler: function () {} })));

    const seen = await readAsClient(
      await handleServerFunctionRequest(flightRequest("sf-encode-pair", "goodCache,badCache"))
    );

    expect(mutationRan).toBe(1);
    expect(seen.decodeError, `decode threw; wire body was: ${seen.raw}`).toBe(null);
    expect(seen.payload?.value, `payload: ${seen.raw}`).toBe("committed");
    expect(
      seen.payload?.data?.goodCache,
      `the healthy cache's slice was destroyed by its sibling: ${seen.raw}`
    ).toEqual({ "/orders": [{ at: new Date(0) }] });
  });

  it("names in the response header only the sources whose slices the payload carries", async () => {
    // The client routes slices to consumers by this header. Advertising a
    // source that is not in the envelope points a consumer at nothing.
    registerServerFunction("sf-encode-header", async () => "committed");
    unregisters.push(registerFlightDataSource("goodCache", () => ({ "/orders": ["fresh"] })));
    unregisters.push(registerFlightDataSource("badCache", () => ({ handler: function () {} })));

    const seen = await readAsClient(
      await handleServerFunctionRequest(flightRequest("sf-encode-header", "goodCache,badCache"))
    );

    const named = seen.foldedSources ? seen.foldedSources.split(",") : [];
    const carried = Object.keys(seen.payload?.data ?? {});
    expect(
      named,
      `header named [${named}] but the payload carries [${carried}]; body: ${seen.raw}`
    ).toEqual(carried);
  });
});
