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
  SINGLE_FLIGHT_HEADER,
  configureServerFunctionsServer,
  decodeResponse,
  handleServerFunctionRequest,
  registerServerFunction,
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
function flightRequest(id: string) {
  return new Request("http://localhost/_server", {
    method: "POST",
    headers: {
      "Sec-Fetch-Site": "same-origin",
      "X-Server-Function-Id": id,
      "X-Server-Function-Instance": "server-function:test",
      [SINGLE_FLIGHT_HEADER]: "true"
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
    expect(await decodeResponse(response)).toEqual({
      value: "mutated",
      data: { "/notes": ["fresh"] }
    });
    expect(seen.outcome.id).toBe("sf-bridge-0");
    expect(seen.outcome.value).toBe("mutated");
    expect(seen.outcome.thrown).toBe(false);
    expect(seen.event.request).toBe(seen.outcome.request);
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
        data: { from: "config" }
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
      const payload = await decodeResponse<SingleFlightPayload<string, { data: boolean }>>(
        response as Response
      );
      expect(payload).toEqual({
        value: "value",
        data: { data: true }
      });
    } finally {
      configureServerFunctionsClient({ prepareRequest: null as any });
      unsubscribe();
      restore();
    }
  });
});
