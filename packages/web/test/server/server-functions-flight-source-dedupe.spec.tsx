/**
 * The single-flight source list is a first-seen-order set, not a multiset
 * (#3251).
 *
 * `X-Single-Flight` names the sources the caller can consume, and the
 * handler resolves that list to hooks by splitting on commas — one entry,
 * one hook run. The list is a set on the client (one consumer per source
 * id, later registrations replace), and the envelope is built with
 * `Object.fromEntries`, so a repeated id cannot contribute a second slice:
 * every run past the first is duplicate work whose result is thrown away,
 * plus an echoed response header N ids long. A collector is the most
 * expensive per-request work single-flight does, and the request-leg list
 * is caller-controlled — the multiplier must not be the caller's to choose.
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

describe("single-flight source list is a set, not a multiset", () => {
  it("runs a repeated source's collector exactly once", async () => {
    let collectorRuns = 0;
    registerServerFunction("sf-dedupe-runs", async () => "committed");
    unregisters.push(
      registerFlightDataSource("expensive", () => {
        collectorRuns++;
        return { "/orders": ["fresh"] };
      })
    );

    const repeats = 2000;
    await handleServerFunctionRequest(
      flightRequest("sf-dedupe-runs", Array(repeats).fill("expensive").join(","))
    );

    expect(
      collectorRuns,
      `${repeats} repetitions of one id ran the collector ${collectorRuns} times`
    ).toBe(1);
  });

  it("echoes a repeated source once in the response header", async () => {
    registerServerFunction("sf-dedupe-header", async () => "committed");
    unregisters.push(registerFlightDataSource("expensive", () => ({ "/orders": ["fresh"] })));

    const repeats = 2000;
    const response = await handleServerFunctionRequest(
      flightRequest("sf-dedupe-header", Array(repeats).fill("expensive").join(","))
    );

    // Compared by shape, not by string: the failing value is the whole
    // echoed header, and printing 20 KB of it helps nobody.
    const folded = response.headers.get(SINGLE_FLIGHT_HEADER) ?? "";
    const ids = folded ? folded.split(",") : [];
    expect(
      { ids: ids.length, bytes: folded.length },
      `${SINGLE_FLIGHT_HEADER} began "${folded.slice(0, 40)}…"`
    ).toEqual({ ids: 1, bytes: "expensive".length });
    expect(ids[0]).toBe("expensive");
  });

  it("still folds each distinct source once, in first-seen order, when the list repeats several", async () => {
    // Deduping must not cost a caller its second cache: the guard is on
    // repetition, not on multiple sources — and first-seen order holds.
    const runs: Record<string, number> = { a: 0, b: 0 };
    registerServerFunction("sf-dedupe-distinct", async () => "committed");
    unregisters.push(
      registerFlightDataSource("cacheA", () => {
        runs.a++;
        return { "/a": ["fresh"] };
      })
    );
    unregisters.push(
      registerFlightDataSource("cacheB", () => {
        runs.b++;
        return { "/b": ["fresh"] };
      })
    );

    const response = await handleServerFunctionRequest(
      flightRequest("sf-dedupe-distinct", "cacheA,cacheB,cacheA,cacheB,cacheA")
    );

    expect(runs, `collector runs were ${JSON.stringify(runs)}`).toEqual({ a: 1, b: 1 });
    expect(response.headers.get(SINGLE_FLIGHT_HEADER)).toBe("cacheA,cacheB");
    expect(await decodeResponse(response)).toEqual({
      value: "committed",
      data: { cacheA: { "/a": ["fresh"] }, cacheB: { "/b": ["fresh"] } }
    });
  });
});
