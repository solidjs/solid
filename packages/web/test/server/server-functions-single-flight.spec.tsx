/**
 * Single-flight protocol through the @solidjs/web/server-functions bridge.
 *
 * These specs run against the built bundles (server-functions/dist/*, wired
 * up in vite.config.server.mjs) — the same artifacts the package publishes —
 * so they verify the rollup builds actually carry the new surface, not just
 * that the runtime source has it. Patterns adapted from dom-expressions'
 * packages/runtime/test/ssr/server-functions.spec.js.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  GET as serverGET,
  SINGLE_FLIGHT_HEADER,
  configureServerFunctionsServer,
  createServerReference as createServerSideReference,
  decodeResponse,
  handleServerFunctionRequest,
  registerFlightDataSource,
  registerServerFunction,
  registerServerReference,
  subscribeFlightData
} from "@solidjs/web/server-functions/server";
import type {
  CollectFlightDataHook,
  SingleFlightPayload
} from "@solidjs/web/server-functions/server";
import {
  configureServerFunctionsClient,
  createServerReference,
  subscribeFlightData as subscribeFlightDataClient
} from "@solidjs/web/server-functions/client";
import type { FlightDataConsumer } from "@solidjs/web/server-functions/client";

// The event-scope fallback the handler uses is the AsyncLocalStorage that
// @solidjs/web/storage's provideRequestEvent parks on the global under the
// registered RequestContext symbol — park a real one there.
const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

// A scripted call that opted into single-flight, like a router mutation.
// `sources` is the request-leg header value: the source ids the client's
// registered consumers can use ("true" is the unnamed registration's
// reserved id).
function flightRequest(id: string, sources = "true") {
  return new Request(`http://localhost/_server/data/${id}`, {
    method: "POST",
    headers: {
      "Sec-Fetch-Site": "same-origin",
      "X-Server-Function-Instance": "server-function:test",
      [SINGLE_FLIGHT_HEADER]: sources
    }
  });
}

describe("single-flight server bridge (built server bundle)", () => {
  it("folds collectFlightData hook data into the response as { value, data }", async () => {
    registerServerFunction("sf-bridge-0", async () => "mutated");
    const seen: any = {};
    const response = await handleServerFunctionRequest(flightRequest("sf-bridge-0"), {
      collectFlightData: (event, outcome) => {
        seen.event = event;
        seen.outcome = outcome;
        return { "/notes": ["fresh"] };
      }
    });
    expect(response.headers.get(SINGLE_FLIGHT_HEADER)).toBe("true");
    // one envelope shape: the unnamed hook's slice is keyed like any other
    expect(await decodeResponse(response)).toEqual({
      value: "mutated",
      data: { true: { "/notes": ["fresh"] } }
    });
    expect(seen.outcome.id).toBe("sf-bridge-0");
    expect(seen.outcome.value).toBe("mutated");
    expect(seen.outcome.thrown).toBe(false);
    expect(seen.event.request).toBe(seen.outcome.request);
  });

  it("never folds on a GET: a read's body cannot be reshaped by a request header (#3128)", async () => {
    // A GET is a cacheable url, and a shared cache stores one body per key.
    // Folding on it would put a second body at that key — an envelope
    // carrying data the hook computed from THAT caller's request — under
    // whatever public Cache-Control the author wrote, with nothing naming
    // the variance. The shipped client already refuses to send the header
    // on a read (client.ts: reads "stay plain"); this is the server half
    // of the same rule, so a curl carrying the header cannot poison the
    // key for everyone behind the cache.
    serverGET(
      createServerSideReference(
        registerServerReference("sf-bridge-read-0", async () => "PUBLIC MENU")
      )
    );
    const collector = vi.fn(() => ({ "/account": { seenBy: "session=CALLER" } }));

    const response = await handleServerFunctionRequest(
      new Request("http://localhost/_server/data/sf-bridge-read-0", {
        method: "GET",
        headers: { [SINGLE_FLIGHT_HEADER]: "true" }
      }),
      { collectFlightData: collector }
    );

    expect(response.status).toBe(200);
    // no fold: the plain value is the ONLY body this url ever answers,
    // whatever headers arrive with the call — and the hook never ran, so
    // a read costs no collection work either
    expect(response.headers.get(SINGLE_FLIGHT_HEADER)).toBeNull();
    expect(await decodeResponse(response)).toBe("PUBLIC MENU");
    expect(collector).not.toHaveBeenCalled();
  });

  it("registers the hook through configureServerFunctionsServer", async () => {
    registerServerFunction("sf-bridge-config-0", async () => "value");
    // the config option's type surfaces through the copied .d.ts chain
    const hook: CollectFlightDataHook = () => ({ from: "config" });
    configureServerFunctionsServer({ collectFlightData: hook });
    try {
      const response = await handleServerFunctionRequest(flightRequest("sf-bridge-config-0"));
      expect(await decodeResponse(response)).toEqual({
        value: "value",
        data: { true: { from: "config" } }
      });
    } finally {
      configureServerFunctionsServer({ collectFlightData: null as any });
    }
  });

  it("exports subscribeFlightData universally (register + unsubscribe)", () => {
    // Routers are universal code — the registration must be importable from
    // the server build even though the server never delivers to it.
    expect(typeof subscribeFlightData).toBe("function");
    const unsubscribe = subscribeFlightData(() => {});
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });

  it("folds named sources into a keyed envelope and names them in the header", async () => {
    registerServerFunction("sf-bridge-multi-0", async () => "mutated");
    // A named source folding alongside the unnamed hook, and one declining
    // (undefined omits it from the envelope AND the header).
    const unregisterQuery = registerFlightDataSource("sq", () => ({ queries: ["fresh"] }));
    const unregisterSkip = registerFlightDataSource("skip", () => undefined);
    try {
      const response = await handleServerFunctionRequest(
        flightRequest("sf-bridge-multi-0", "true,sq,skip"),
        { collectFlightData: () => ({ "/notes": ["fresh"] }) }
      );
      expect(response.headers.get(SINGLE_FLIGHT_HEADER)).toBe("true,sq");
      expect(await decodeResponse(response)).toEqual({
        value: "mutated",
        data: { true: { "/notes": ["fresh"] }, sq: { queries: ["fresh"] } }
      });
    } finally {
      unregisterQuery();
      unregisterSkip();
    }
  });

  it("a named source alone folds keyed — the envelope is one shape", async () => {
    registerServerFunction("sf-bridge-named-0", async () => "mutated");
    const unregister = registerFlightDataSource("sq", () => ({ queries: ["fresh"] }));
    try {
      // No unnamed hook anywhere: the client only advertised "sq".
      const response = await handleServerFunctionRequest(flightRequest("sf-bridge-named-0", "sq"));
      expect(response.headers.get(SINGLE_FLIGHT_HEADER)).toBe("sq");
      expect(await decodeResponse(response)).toEqual({
        value: "mutated",
        data: { sq: { queries: ["fresh"] } }
      });
    } finally {
      unregister();
    }
  });

  it("sources the client did not advertise never run", async () => {
    registerServerFunction("sf-bridge-unadvertised-0", async () => "mutated");
    const collector = vi.fn(() => ({ queries: ["fresh"] }));
    const unregister = registerFlightDataSource("sq", collector);
    try {
      // The client only advertised the unnamed source: the named source
      // does no collection work and only the unnamed slice folds.
      const response = await handleServerFunctionRequest(
        flightRequest("sf-bridge-unadvertised-0", "true"),
        { collectFlightData: () => ({ "/notes": ["fresh"] }) }
      );
      expect(collector).not.toHaveBeenCalled();
      expect(response.headers.get(SINGLE_FLIGHT_HEADER)).toBe("true");
      expect(await decodeResponse(response)).toEqual({
        value: "mutated",
        data: { true: { "/notes": ["fresh"] } }
      });
    } finally {
      unregister();
    }
  });

  it("a throwing collector loses only its own slice", async () => {
    registerServerFunction("sf-bridge-throw-0", async () => "mutated");
    const unregisterBroken = registerFlightDataSource("broken", () => {
      throw new Error("collector exploded");
    });
    const unregisterQuery = registerFlightDataSource("sq", () => ({ queries: ["fresh"] }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await handleServerFunctionRequest(
        flightRequest("sf-bridge-throw-0", "broken,sq")
      );
      // The mutation's outcome and the healthy cache's slice both survive —
      // a thrown hook must not fall into the handler's error path (the
      // client would receive an error for a mutation that succeeded) or
      // take the other sources down with it.
      expect(response.headers.get(SINGLE_FLIGHT_HEADER)).toBe("sq");
      expect(await decodeResponse(response)).toEqual({
        value: "mutated",
        data: { sq: { queries: ["fresh"] } }
      });
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('"broken"'),
        expect.any(Error)
      );
    } finally {
      consoleError.mockRestore();
      unregisterBroken();
      unregisterQuery();
    }
  });

  it("an id naming no registered hook folds nothing", async () => {
    // Only exact source ids run collection — an unrecognized value is not
    // an opt-in to anything, so the response is a plain call's response.
    registerServerFunction("sf-bridge-handtag-0", async () => "mutated");
    const unnamedHook = vi.fn(() => ({ "/notes": ["fresh"] }));
    const response = await handleServerFunctionRequest(flightRequest("sf-bridge-handtag-0", "1"), {
      collectFlightData: unnamedHook
    });
    expect(unnamedHook).not.toHaveBeenCalled();
    expect(response.headers.has(SINGLE_FLIGHT_HEADER)).toBe(false);
    expect(await decodeResponse(response)).toBe("mutated");
  });

  it("rejects reserved and malformed source ids on both halves", () => {
    expect(() => registerFlightDataSource("true", () => ({}))).toThrow(TypeError);
    expect(() => registerFlightDataSource("a,b", () => ({}))).toThrow(TypeError);
    expect(() => registerFlightDataSource("", () => ({}))).toThrow(TypeError);
    expect(() => subscribeFlightData("true", () => {})).toThrow(TypeError);
    expect(() => subscribeFlightData("a,b", () => {})).toThrow(TypeError);
  });
});

describe("single-flight client bridge (built client bundle)", () => {
  // The client transport's fetch dispatches straight into the built server
  // handler — a full round trip through both published bundles.
  function connectTransport(options?: Parameters<typeof handleServerFunctionRequest>[1]) {
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const request = new Request(new URL(url, "http://localhost"), init);
      request.headers.set("Sec-Fetch-Site", "same-origin");
      return handleServerFunctionRequest(request, options);
    }) as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  }

  it("delivers data to the registered consumer and value to the caller", async () => {
    registerServerFunction("sf-bridge-client-0", async () => "mutated");
    const restore = connectTransport({
      collectFlightData: () => ({ "/notes": ["fresh"] })
    });
    const delivered: any[] = [];
    const consumer: FlightDataConsumer<Record<string, string[]>> = async (data, context) => {
      // async consumers settle before the caller sees the value
      await Promise.resolve();
      delivered.push({ data, context });
    };
    // subscribing IS the opt-in: the transport sends the request-leg
    // header itself while a consumer is registered
    const unsubscribe = subscribeFlightDataClient(consumer);
    try {
      const result = await createServerReference("sf-bridge-client-0")();
      expect(result).toBe("mutated");
      expect(delivered).toHaveLength(1);
      expect(delivered[0].data).toEqual({ "/notes": ["fresh"] });
      expect(delivered[0].context.response.headers.get(SINGLE_FLIGHT_HEADER)).toBe("true");
    } finally {
      unsubscribe();
      restore();
    }
  });

  it("routes keyed slices to their subscribed consumers", async () => {
    registerServerFunction("sf-bridge-multi-client-0", async () => "mutated");
    let requestLeg: string | null = null;
    const unregister = registerFlightDataSource("sq", () => ({ fromQuery: true }));
    const restore = connectTransport({
      collectFlightData: (_event, outcome) => {
        requestLeg = outcome.request.headers.get(SINGLE_FLIGHT_HEADER);
        return { fromRouter: true };
      }
    });
    const routerSeen: any[] = [];
    const querySeen: any[] = [];
    // registration order is header order: the unnamed consumer first
    const unsubscribeRouter = subscribeFlightDataClient(data => {
      routerSeen.push(data);
    });
    const unsubscribeQuery = subscribeFlightDataClient("sq", data => {
      querySeen.push(data);
    });
    try {
      const result = await createServerReference("sf-bridge-multi-client-0")();
      expect(result).toBe("mutated");
      // the request leg advertised both consumers' sources
      expect(requestLeg).toBe("true,sq");
      // each cache saw only its own slice, seeded before the caller's await
      expect(routerSeen).toEqual([{ fromRouter: true }]);
      expect(querySeen).toEqual([{ fromQuery: true }]);
    } finally {
      unsubscribeRouter();
      unsubscribeQuery();
      unregister();
      restore();
    }
  });

  it("a named consumer alone advertises and receives only its source", async () => {
    registerServerFunction("sf-bridge-named-client-0", async () => "mutated");
    const legacyHook = vi.fn(() => ({ fromRouter: true }));
    const unregister = registerFlightDataSource("sq", () => ({ fromQuery: true }));
    const restore = connectTransport({ collectFlightData: legacyHook });
    const querySeen: any[] = [];
    const unsubscribe = subscribeFlightDataClient("sq", data => {
      querySeen.push(data);
    });
    try {
      const result = await createServerReference("sf-bridge-named-client-0")();
      expect(result).toBe("mutated");
      expect(querySeen).toEqual([{ fromQuery: true }]);
      // no unnamed consumer on the page: the router hook never ran
      expect(legacyHook).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
      unregister();
      restore();
    }
  });

  it("a source with no server hook simply starves its consumer", async () => {
    // The client advertises "true,sq" but the server has no "sq" collector
    // registered. Only the unnamed hook folds, the echo is "true", the
    // unnamed consumer receives its slice — the named consumer starves and
    // its cache revalidates the normal way.
    registerServerFunction("sf-bridge-degrade-0", async () => "mutated");
    const restore = connectTransport({
      collectFlightData: () => ({ fromRouter: true })
    });
    const routerSeen: any[] = [];
    const queryConsumer = vi.fn();
    const unsubscribeRouter = subscribeFlightDataClient(data => {
      routerSeen.push(data);
    });
    const unsubscribeQuery = subscribeFlightDataClient("sq", queryConsumer);
    try {
      const result = await createServerReference("sf-bridge-degrade-0")();
      expect(result).toBe("mutated");
      expect(routerSeen).toEqual([{ fromRouter: true }]);
      expect(queryConsumer).not.toHaveBeenCalled();
    } finally {
      unsubscribeRouter();
      unsubscribeQuery();
      restore();
    }
  });

  it("unsubscribing restores whole-response passthrough", async () => {
    registerServerFunction("sf-bridge-unsub-0", async () => "value");
    const restore = connectTransport({
      collectFlightData: () => ({ data: true })
    });
    const consumer = vi.fn();
    const unsubscribe = subscribeFlightDataClient(consumer);
    // an integration can still tag calls by hand through the session-level
    // prepareRequest hook — with no consumer registered the tagged response
    // reaches the caller whole
    configureServerFunctionsClient({
      prepareRequest: init => ({
        ...init,
        headers: { ...(init.headers as Record<string, string>), [SINGLE_FLIGHT_HEADER]: "true" }
      })
    });
    try {
      await createServerReference("sf-bridge-unsub-0")();
      expect(consumer).toHaveBeenCalledTimes(1);

      unsubscribe();
      const response = await createServerReference("sf-bridge-unsub-0")();
      expect(consumer).toHaveBeenCalledTimes(1);
      // no consumer registered: the integration decodes the response itself
      expect(response).toBeInstanceOf(Response);
      const payload = await decodeResponse<
        SingleFlightPayload<string, { true: { data: boolean } }>
      >(response as Response);
      expect(payload).toEqual({
        value: "value",
        data: { true: { data: true } }
      });
    } finally {
      configureServerFunctionsClient({ prepareRequest: null as any });
      unsubscribe();
      restore();
    }
  });
});
