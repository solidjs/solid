/**
 * A redirecting mutation knows where the client is going without being told
 * by a `Referer`.
 *
 * `digestOutcome` computes `targetUrl` — "the URL the client will show after
 * the mutation" — and its own comment gives the rule as two cases: "the
 * redirect `Location` when the outcome carries one (resolved against the
 * request URL, as a browser would), the referring page otherwise". Only the
 * second case actually needs a referer; the first is derived from the
 * outcome the server itself produced. Both sit inside one `if (referrer)`.
 *
 * So a site that sends `Referrer-Policy: no-referrer` — a routine security
 * header, and the default under several CSP/hardening presets — silently
 * loses single-flight on every redirecting mutation: `targetUrl` is
 * undefined, the router's collector has no destination to produce data for,
 * nothing folds, and the mutation costs a second round trip. Nothing warns;
 * the feature just stops paying.
 *
 * The `otherwise` half must keep needing a referer (a non-browser caller
 * has no page to produce data for), and the cross-origin guard must keep
 * holding on both halves — a redirect leaving the app's origin produces no
 * target either way. These specs pin the rule as the comment states it.
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

/**
 * Registers a mutation that throws the given redirect and a router-shaped
 * collector that only produces data when it knows the destination. Returns
 * a caller and the digested outcomes the collector saw.
 */
function redirectingMutation(id: string, location: string) {
  const outcomes: any[] = [];
  registerServerFunction(id, async () => {
    throw new Response(null, { status: 303, headers: { Location: location } });
  });
  unregisters.push(
    registerFlightDataSource("router", (_event: any, outcome: any) => {
      outcomes.push(outcome);
      return outcome.targetUrl ? { [outcome.targetUrl]: ["destination data"] } : undefined;
    })
  );
  const call = (referer?: string) =>
    handleServerFunctionRequest(
      new Request(`http://localhost/_server/data/${id}`, {
        method: "POST",
        headers: {
          "Sec-Fetch-Site": "same-origin",
          "X-Server-Function-Instance": "server-function:test",
          [SINGLE_FLIGHT_HEADER]: "router",
          ...(referer ? { referer } : {})
        }
      })
    );
  return { call, outcomes };
}

describe("single-flight target url for a redirecting mutation", () => {
  it("derives the target from the redirect Location when the caller sends no Referer", async () => {
    const sameOrigin = redirectingMutation("sf-target-noreferer", "/orders/42");
    await sameOrigin.call();
    const derived = sameOrigin.outcomes.at(-1);

    expect(
      derived.targetUrl,
      `Location was ${derived.response?.headers?.get("Location")} but targetUrl was ` +
        `${derived.targetUrl}`
    ).toBe("http://localhost/orders/42");

    // The guards the referer gate was incidentally providing have to keep
    // holding once the Location half no longer sits behind it: a redirect
    // leaving the app's origin has no page of ours to produce data for, and
    // a non-redirecting mutation still falls back to the referring page —
    // which a caller that sends none does not have.
    const crossOrigin = redirectingMutation(
      "sf-target-crossorigin",
      "https://elsewhere.example/orders/42"
    );
    await crossOrigin.call();
    expect(
      crossOrigin.outcomes.at(-1).targetUrl,
      "a redirect leaving the origin must still produce no target"
    ).toBeUndefined();

    registerServerFunction("sf-target-plain", async () => "committed");
    const plain: any[] = [];
    unregisters.push(
      registerFlightDataSource("router", (_event: any, outcome: any) => {
        plain.push(outcome);
        return undefined;
      })
    );
    await handleServerFunctionRequest(
      new Request("http://localhost/_server/data/sf-target-plain", {
        method: "POST",
        headers: {
          "Sec-Fetch-Site": "same-origin",
          "X-Server-Function-Instance": "server-function:test",
          [SINGLE_FLIGHT_HEADER]: "router"
        }
      })
    );
    expect(
      plain.at(-1).targetUrl,
      "a non-redirecting mutation without a Referer must still produce no target"
    ).toBeUndefined();
  });

  it("still folds destination data for a mutation sent under Referrer-Policy: no-referrer", async () => {
    // The wire-visible cost of the gate: the response is byte-identical to
    // a call with no hooks at all, so the client has to go back for the
    // destination it was already redirected to.
    const { call } = redirectingMutation("sf-target-fold", "/orders/42");

    const response = await call();
    const body = await response.clone().text();

    expect(
      response.headers.get(SINGLE_FLIGHT_HEADER),
      `nothing folded — the mutation costs a second round trip; body was ${body}`
    ).toBe("router");
    expect(await decodeResponse(response)).toEqual({
      value: null,
      data: { router: { "http://localhost/orders/42": ["destination data"] } }
    });
  });
});
