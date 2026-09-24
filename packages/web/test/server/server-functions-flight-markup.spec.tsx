/**
 * Single-flight with markup in the payload (#3638), against the built
 * bundles (server-functions/dist, frames/dist — see vite.config.server.mjs).
 *
 * The fold keys flight data by source (`{ [source]: slice }`, the unnamed
 * collector's slice under "true"), so a component an integration collected
 * sits one level down. `frameTransformFlightResult` scanned only the top
 * level, framed nothing, and the handler fell back to the plain codec —
 * which cannot encode a function. Now the transform scans each slice,
 * keeps the source keys, and the fold owns the single-flight header on the
 * frame-stream body too.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  SINGLE_FLIGHT_HEADER,
  configureServerFunctionsServer,
  handleServerFunctionRequest,
  registerFlightDataSource,
  registerServerFunction
} from "@solidjs/web/server-functions/server";
import { ChunkReader, createChunk, deserializeStream } from "@solidjs/web/server-functions/client";
import {
  ServerComponentPlugin,
  frameTransformDirectResult,
  frameTransformFlightResult,
  frameTransformResult
} from "@solidjs/web/frames/server";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
  // The flight reference's decode-side fallback (no transport installed):
  // the document registry's per-function placeholder. Stubbed so a decoded
  // envelope shows WHAT was referenced.
  (globalThis as any)._$SC = { r: (id: string) => ({ component: id }) };
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
  delete (globalThis as any)._$SC;
});

// The frame-stream body: length-prefixed JSON chunks (the server-function
// wire framing), read back into chunk objects.
async function readFrameStream(response: Response) {
  const reader = new ChunkReader(response.body!);
  const chunks: any[] = [];
  for (let next = await reader.next(); !next.done; next = await reader.next()) {
    chunks.push(JSON.parse(next.value));
  }
  return chunks;
}

// The `{ value, data }` envelope the outcome chunks carry, decoded through
// the flight codec exactly as the frames client decodes it.
async function decodeOutcome(chunks: any[]) {
  const payloads = chunks.filter(chunk => chunk.type === "outcome").map(chunk => chunk.payload);
  expect(payloads.length).toBeGreaterThan(0);
  const body = new ReadableStream({
    start(controller) {
      for (const payload of payloads) controller.enqueue(createChunk(payload));
      controller.close();
    }
  });
  return deserializeStream(new Response(body), {
    plugins: [ServerComponentPlugin]
  }) as Promise<any>;
}

function flightRequest(id: string, sources = "true") {
  return new Request(`http://localhost/_server/data/${id}`, {
    method: "POST",
    body: "[]",
    headers: {
      "Content-Type": "application/json",
      "Sec-Fetch-Site": "same-origin",
      "X-Server-Function-Format": "8",
      [SINGLE_FLIGHT_HEADER]: sources
    }
  });
}

// What a query cache holds for a server component route: the direct call's
// result through `transformDirectResult` — branded with its function id and
// call address, wrapping the component.
const View = () => "fresh markup";
const brandedView = () => frameTransformDirectResult(View, { id: "view", args: [7] });

describe("frameTransformFlightResult reads consumer-keyed flight data", () => {
  it("scans each source's slice for components, frames their markup, keeps the source keys", async () => {
    const response = await frameTransformFlightResult(null, {
      value: "ok",
      data: {
        true: { "view[7]": brandedView(), "/notes": ["fresh"] },
        sq: { queries: ["fresh"] }
      }
    });
    expect(response).toBeInstanceOf(Response);
    expect(response!.headers.get("Content-Type")).toBe("application/x-frame-stream");
    // no primary: the mutation's own value is data
    expect(response!.headers.get("X-Frame-Stream")).toBe("");
    const chunks = await readFrameStream(response!);
    // the component's content rides once, as a region addressed by the CALL
    const html = chunks.filter(chunk => chunk.type === "html");
    expect(html).toHaveLength(1);
    expect(html[0].html).toBe("fresh markup");
    expect(html[0].id).toBe((brandedView() as any)[Symbol.for("solid.server-component-address")]);
    // the envelope keeps the fold's shape — every source key intact, the
    // component entry a reference beside the plain data
    expect(await decodeOutcome(chunks)).toEqual({
      value: "ok",
      data: {
        true: { "view[7]": { component: "view" }, "/notes": ["fresh"] },
        sq: { queries: ["fresh"] }
      }
    });
  });

  it("declines when no slice holds markup, whatever shape the slices take", async () => {
    expect(
      await frameTransformFlightResult(null, {
        value: "ok",
        data: { true: { "/notes": ["fresh"] }, sq: ["a", "b"], other: 42 }
      })
    ).toBeUndefined();
  });

  it("a bare function entry is a server component addressed by its key", async () => {
    // The "a function is a server component" convention, applied to a
    // flight entry that never crossed a direct call (so carries no brand):
    // its key is the one name both peers share, so the region is addressed
    // by it and the envelope's reference carries it.
    const response = await frameTransformFlightResult(null, {
      value: "ok",
      data: { true: { "view[]": View } }
    });
    const chunks = await readFrameStream(response!);
    expect(chunks.filter(chunk => chunk.type === "html")).toEqual([
      { type: "html", id: "view[]", version: 1, html: "fresh markup" }
    ]);
    expect(await decodeOutcome(chunks)).toEqual({
      value: "ok",
      data: { true: { "view[]": { component: "view[]" } } }
    });
  });
});

describe("single-flight mutations that revalidate a server component (built bundles)", () => {
  const unregisters: (() => void)[] = [];
  afterEach(() => {
    for (const unregister of unregisters.splice(0)) unregister();
    configureServerFunctionsServer({
      collectFlightData: null as any,
      transformResult: null as any,
      transformFlightResult: null as any,
      transformDirectResult: null as any
    });
  });

  it("answers with a frame stream carrying the region and the envelope (#3638)", async () => {
    // The issue's reproduction: the frames policy installed as an app does,
    // the unnamed collector answering with one invalidated key whose value
    // is a component.
    registerServerFunction("flight-markup-3638", async () => "ok");
    configureServerFunctionsServer({
      transformResult: frameTransformResult,
      transformDirectResult: frameTransformDirectResult,
      transformFlightResult: frameTransformFlightResult,
      collectFlightData: async () => ({ "view[]": View })
    });

    const response = await handleServerFunctionRequest(flightRequest("flight-markup-3638"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/x-frame-stream");
    expect(response.headers.get(SINGLE_FLIGHT_HEADER)).toBe("true");
    const chunks = await readFrameStream(response);
    expect(chunks.map(chunk => chunk.type)).toEqual(
      expect.arrayContaining(["start", "html", "complete", "outcome"])
    );
    expect(chunks.find(chunk => chunk.type === "html")).toMatchObject({
      id: "view[]",
      html: "fresh markup"
    });
    expect(JSON.stringify(chunks)).not.toContain("could not be encoded");
    expect(await decodeOutcome(chunks)).toEqual({
      value: "ok",
      data: { true: { "view[]": { component: "view[]" } } }
    });
  });

  it("the fold's header names every folded source on the frame-stream body too", async () => {
    registerServerFunction("flight-markup-named", async () => undefined);
    unregisters.push(registerFlightDataSource("sq", () => ({ queries: ["fresh"] })));
    configureServerFunctionsServer({
      transformFlightResult: frameTransformFlightResult,
      collectFlightData: () => ({ "view[7]": brandedView() })
    });

    const response = await handleServerFunctionRequest(
      flightRequest("flight-markup-named", "true,sq")
    );

    expect(response.headers.get("Content-Type")).toBe("application/x-frame-stream");
    // the frame policy used to stamp a bare "true" that won the header merge
    // and dropped the named source the client routes by
    expect(response.headers.get(SINGLE_FLIGHT_HEADER)).toBe("true,sq");
    const chunks = await readFrameStream(response);
    expect(chunks.filter(chunk => chunk.type === "html")).toHaveLength(1);
    expect(await decodeOutcome(chunks)).toEqual({
      data: {
        true: { "view[7]": { component: "view" } },
        sq: { queries: ["fresh"] }
      }
    });
  });

  it("one failed entry in a slice costs neither the mutation nor the other entries", async () => {
    registerServerFunction("flight-markup-partial", async () => "ok");
    configureServerFunctionsServer({
      transformFlightResult: frameTransformFlightResult,
      collectFlightData: () => ({
        "view[7]": brandedView(),
        "broken[]": Promise.reject(new Error("connection string: postgres://secret"))
      })
    });

    const response = await handleServerFunctionRequest(flightRequest("flight-markup-partial"));

    expect(response.headers.get("Content-Type")).toBe("application/x-frame-stream");
    const chunks = await readFrameStream(response);
    expect(chunks.find(chunk => chunk.type === "html")).toMatchObject({ html: "fresh markup" });
    // the rejection rides as a rejected entry, sanitized like any other
    // failure in flight data (the production artifact's default)
    const text = JSON.stringify(chunks);
    expect(text).not.toContain("postgres://secret");
    expect(text).toContain("Internal Server Error");
  });
});
