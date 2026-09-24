/**
 * Single-flight delivery is ONE path (#3638): the frames client decodes a
 * flight frame stream's `outcome` chunks into the `{ value, data }` envelope
 * and then hands it to the same `deliverFlightData` the plain transport
 * uses — each registered consumer receives its source's slice of the
 * consumer-keyed envelope, in registration order, with identical metadata
 * handling. Before, the frames path handed the WHOLE keyed envelope to the
 * unnamed consumer and never delivered to named ones.
 *
 * The frame stream is built by hand here (the producer is server-only); its
 * outcome chunks are the codec's own nodes, exactly as `frameFlightResponse`
 * writes them.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createFrameHost } from "../frames/src/client.js";
import {
  COMPONENT_BINDING,
  SERVER_COMPONENT,
  SERVER_COMPONENT_ADDRESS,
  createServerComponentHandler,
  flightCodec
} from "../frames/src/frame-transport.js";
import {
  BODY_FORMAT_HEADER,
  BodyFormat,
  ChunkReader,
  ERROR_HEADER,
  SINGLE_FLIGHT_HEADER,
  createChunk,
  serializeStream,
  subscribeFlightData
} from "../server-functions/src/shared.js";
import { createServerReference } from "../server-functions/src/client.js";
import { REVALIDATE_HEADER } from "../src/response.js";

// A flight reference as the server's transform serializes it: a function
// branded with its id and call address (see `ServerComponentPlugin`).
function flightReference(id: string, address: string) {
  const reference: any = () => undefined;
  reference[SERVER_COMPONENT] = id;
  reference[SERVER_COMPONENT_ADDRESS] = address;
  return reference;
}

// The frame-stream body `frameFlightResponse` produces: each region's
// chunks, then the envelope as `outcome` chunks carrying the codec's nodes.
async function flightFrameResponse(
  regions: { id: string; html: string }[],
  envelope: unknown,
  headers: Record<string, string>
) {
  const chunks: string[] = [];
  for (const { id, html } of regions) {
    chunks.push(JSON.stringify({ type: "start", id, version: 1 }));
    chunks.push(JSON.stringify({ type: "html", id, version: 1, html }));
    chunks.push(JSON.stringify({ type: "complete", id, version: 1 }));
  }
  const reader = new ChunkReader(serializeStream(envelope, flightCodec(undefined)));
  for (let node = await reader.next(); !node.done; node = await reader.next()) {
    chunks.push(JSON.stringify({ type: "outcome", payload: node.value }));
  }
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(createChunk(chunk));
      controller.close();
    }
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-frame-stream",
      // No primary (the mutation returned data, not markup): the root id is
      // empty, and the header's PRESENCE is what tags the frame stream.
      "X-Frame-Stream": "",
      ...headers
    }
  });
}

// The plain single-flight body the fold produces for a data-only payload.
function plainFlightResponse(envelope: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify(envelope), {
    headers: { [BODY_FORMAT_HEADER]: BodyFormat.Json, ...headers }
  });
}

describe("single-flight delivery over the frames transport (#3638)", () => {
  const unsubscribes: (() => void)[] = [];
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    globalThis.fetch = originalFetch;
  });

  function handler() {
    const streams: string[] = [];
    const created = createServerComponentHandler({
      host: createFrameHost(),
      component: (fnId: string) => fnId as any,
      onStream: address => {
        streams.push(address);
      }
    });
    return { handler: created, streams };
  }

  function subscribe() {
    const order: string[] = [];
    const unnamed = vi.fn((_data: unknown, _info: { response: Response }) => {
      order.push("true");
    });
    const named = vi.fn((_data: unknown, _info: { response: Response }) => {
      order.push("sq");
    });
    unsubscribes.push(subscribeFlightData(unnamed), subscribeFlightData("sq", named));
    return { order, unnamed, named };
  }

  test("each consumer receives its own slice, the component resolved to its binding", async () => {
    const { handler: h, streams } = handler();
    const { order, unnamed, named } = subscribe();
    const response = await flightFrameResponse(
      [{ id: "view", html: "fresh markup" }],
      {
        value: "ok",
        data: {
          true: { "view[]": flightReference("view", "view") },
          sq: { queries: ["fresh"] }
        }
      },
      { [SINGLE_FLIGHT_HEADER]: "true,sq" }
    );

    const result = await h.handle(response, {
      id: "mutate",
      meta: undefined,
      args: [],
      context: undefined
    });

    // the caller gets the mutation's value, like a plain body
    expect(result).toBe("ok");
    // the region streamed into the address the entry references
    expect(streams).toEqual(["view"]);
    // the unnamed consumer got ITS slice — not the keyed envelope — with the
    // component resolved to the call's binding (the value a boundary showing
    // that call holds, so a cache seeded with it passes the equals-gate)
    expect(unnamed).toHaveBeenCalledTimes(1);
    const slice: any = unnamed.mock.calls[0][0];
    expect(Object.keys(slice)).toEqual(["view[]"]);
    expect(slice["view[]"][COMPONENT_BINDING]).toEqual({ component: "view", address: "view" });
    // the named consumer got its slice, after the unnamed one
    expect(named).toHaveBeenCalledWith({ queries: ["fresh"] }, { response });
    expect(order).toEqual(["true", "sq"]);
  });

  test("a consumer whose source was not folded is skipped — unless the response carries metadata", async () => {
    const { handler: h } = handler();
    const { unnamed, named } = subscribe();

    await h.handle(
      await flightFrameResponse(
        [{ id: "view", html: "fresh" }],
        { value: "ok", data: { true: { "view[]": flightReference("view", "view") } } },
        { [SINGLE_FLIGHT_HEADER]: "true" }
      ),
      { id: "mutate", meta: undefined, args: [], context: undefined }
    );
    expect(unnamed).toHaveBeenCalledTimes(1);
    expect(named).not.toHaveBeenCalled();

    // revalidation keys are envelope-level: every consumer runs, `undefined`
    // where nothing was folded for it
    const withMetadata = await flightFrameResponse(
      [{ id: "view", html: "fresh" }],
      { value: "ok", data: { true: { "view[]": flightReference("view", "view") } } },
      { [SINGLE_FLIGHT_HEADER]: "true", [REVALIDATE_HEADER]: "*" }
    );
    await h.handle(withMetadata, { id: "mutate", meta: undefined, args: [], context: undefined });
    expect(unnamed).toHaveBeenCalledTimes(2);
    expect(named).toHaveBeenCalledTimes(1);
    expect(named).toHaveBeenCalledWith(undefined, { response: withMetadata });
  });

  test("a bare error-tagged envelope throws after delivery; one with metadata is control flow", async () => {
    const { handler: h } = handler();
    const { unnamed } = subscribe();
    const failed = await flightFrameResponse(
      [{ id: "view", html: "fresh" }],
      { value: "boom", data: { true: { "view[]": flightReference("view", "view") } } },
      { [SINGLE_FLIGHT_HEADER]: "true", [ERROR_HEADER]: "true" }
    );
    await expect(
      h.handle(failed, { id: "mutate", meta: undefined, args: [], context: undefined })
    ).rejects.toBe("boom");
    expect(unnamed).toHaveBeenCalledTimes(1);

    const redirected = await flightFrameResponse(
      [{ id: "view", html: "fresh" }],
      { value: "boom", data: { true: { "view[]": flightReference("view", "view") } } },
      {
        [SINGLE_FLIGHT_HEADER]: "true",
        [ERROR_HEADER]: "true",
        [REVALIDATE_HEADER]: "*"
      }
    );
    await expect(
      h.handle(redirected, { id: "mutate", meta: undefined, args: [], context: undefined })
    ).resolves.toBe("boom");
  });

  test("a call whose own result is markup resolves to its binding when the header names the frame (#3641)", async () => {
    // A POST server-component call with a flight source registered: the
    // server answers with the component's markup as the PRIMARY frame and
    // the outcome's `value` undefined (the component is the frame). The
    // binding comes from `X-Frame-Stream` naming the call — the header the
    // server's bundled copy of the invocation ledger left empty (#3641),
    // which made this path resolve to the envelope's `undefined`.
    const { handler: h, streams } = handler();
    const { unnamed } = subscribe();
    const envelope = { value: undefined, data: { true: { "route-data[]": { title: "x" } } } };
    const headers = { [SINGLE_FLIGHT_HEADER]: "true", "X-Frame-Stream": "view-1" };

    const bound: any = await h.handle(
      await flightFrameResponse([{ id: "view-1", html: "view markup" }], envelope, headers),
      { id: "view-1", meta: undefined, args: [], context: undefined }
    );
    expect(typeof bound).toBe("function");
    expect(bound[COMPONENT_BINDING]).toEqual({ component: "view-1", address: "view-1" });
    expect(streams).toEqual(["view-1"]);
    expect(unnamed).toHaveBeenCalledWith({ "route-data[]": { title: "x" } }, expect.anything());

    // The failure the issue reported, pinned as the contrast: the same body
    // under an empty header is a data-only stream and resolves to `value`.
    const unbound = await h.handle(
      await flightFrameResponse([{ id: "view-1", html: "view markup" }], envelope, {
        ...headers,
        "X-Frame-Stream": ""
      }),
      { id: "view-1", meta: undefined, args: [], context: undefined }
    );
    expect(unbound).toBeUndefined();
  });

  test("the plain transport delivers the same scenario identically", async () => {
    // Same envelope shape (data-only: markup never rides a plain body),
    // same header, same consumers — the plain client's fetch answers with
    // the fold's JSON body instead of a frame stream.
    const { order, unnamed, named } = subscribe();
    let sentHeader: string | null = null;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sentHeader = new Headers(init?.headers).get(SINGLE_FLIGHT_HEADER);
      return plainFlightResponse(
        { value: "ok", data: { true: { "view[]": "fresh data" }, sq: { queries: ["fresh"] } } },
        { [SINGLE_FLIGHT_HEADER]: "true,sq" }
      );
    }) as typeof fetch;

    const result = await createServerReference("mutate-plain")();

    expect(result).toBe("ok");
    // the request leg advertised both registrations
    expect(sentHeader).toBe("true,sq");
    expect(unnamed).toHaveBeenCalledWith({ "view[]": "fresh data" }, expect.anything());
    expect(named).toHaveBeenCalledWith({ queries: ["fresh"] }, expect.anything());
    expect(order).toEqual(["true", "sq"]);

    // metadata without a fold for the named source: same rule, same shape
    globalThis.fetch = (async () =>
      plainFlightResponse(
        { value: "ok", data: { true: { "view[]": "fresh data" } } },
        { [SINGLE_FLIGHT_HEADER]: "true", [REVALIDATE_HEADER]: "*" }
      )) as typeof fetch;
    await createServerReference("mutate-plain-2")();
    expect(named).toHaveBeenLastCalledWith(undefined, expect.anything());
    expect(order).toEqual(["true", "sq", "true", "sq"]);
  });
});
