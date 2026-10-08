/**
 * A `respond()` envelope on the direct leg — a server function called
 * in-process during SSR. Over HTTP the handler unwraps the envelope and the
 * caller decodes its value; in-process the caller received the envelope
 * itself, so `await fn()` answered two different shapes depending on which
 * leg ran it, and a server component wrapped in `respond()` reached the
 * render as an object — the frames policy never branded it, and the
 * hydration serializer met an envelope holding a function.
 *
 * Of the metadata, `Set-Cookie` reaches the render's response head (state
 * the function established); the other headers describe the function's own
 * address and the status is the page's, so neither applies to the document.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ResponseEnvelope, createRequestEvent, isResponseEnvelope, respond } from "@solidjs/web";
import {
  configureServerFunctionsServer,
  createServerReference
} from "@solidjs/web/server-functions/server";
import { frameTransformDirectResult } from "@solidjs/web/frames/server";

const RequestContext = Symbol.for("solid.RequestContext");
const SERVER_COMPONENT = Symbol.for("solid.server-component");
const requestContext = new AsyncLocalStorage<any>();

beforeAll(() => {
  (globalThis as any)[RequestContext] = requestContext;
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

afterEach(() => {
  configureServerFunctionsServer({ transformDirectResult: null as any });
});

function reference<F extends (...args: any[]) => any>(id: string, fn: F) {
  return createServerReference({ id, fn } as any) as unknown as F;
}

function pageEvent() {
  return createRequestEvent(new Request("https://app.example/page"));
}

function cookieInit() {
  const headers = new Headers({ "cache-control": "public, max-age=60", "x-extra": "1" });
  headers.append("Set-Cookie", "a=1; Path=/");
  headers.append("Set-Cookie", "b=2; Path=/");
  return { status: 201, headers };
}

describe("respond() is a Response", () => {
  it("carries the JSON body, status and headers, with the value in memory", async () => {
    const envelope: any = respond({ id: 7 }, cookieInit());
    expect(envelope).toBeInstanceOf(Response);
    expect(isResponseEnvelope(envelope)).toBe(true);
    expect(envelope.value).toEqual({ id: 7 });
    expect(envelope.response).toBe(envelope);
    expect(envelope.status).toBe(201);
    expect(envelope.headers.get("content-type")).toBe("application/json");
    expect(envelope.headers.get("cache-control")).toBe("public, max-age=60");
    expect(envelope.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(await envelope.json()).toEqual({ id: 7 });
  });

  it("a null-body status stays bodiless", () => {
    const envelope: any = respond(undefined, { status: 304 });
    expect(envelope).toBeInstanceOf(Response);
    expect(envelope.status).toBe(304);
    expect(envelope.body).toBeNull();
  });

  it("answers a dispatcher that knows nothing of Solid", async () => {
    // The fetch-style API dispatch convention (filesystem-routing's): a
    // Response passes through, anything else is JSON-encoded.
    const dispatch = (result: unknown) =>
      result instanceof Response ? result : Response.json(result);
    const response = dispatch(respond({ id: 7 }, { status: 201, headers: { "x-extra": "1" } }));
    expect(response.status).toBe(201);
    expect(response.headers.get("x-extra")).toBe("1");
    expect(await response.json()).toEqual({ id: 7 });
  });

  it("constructed without a response it is an empty 200 with no metadata", () => {
    const envelope = new ResponseEnvelope(undefined, "value");
    expect(envelope).toBeInstanceOf(Response);
    expect(envelope.response).toBeUndefined();
    expect(envelope.value).toBe("value");
    expect(envelope.status).toBe(200);
  });

  it("constructed from a response, it takes that response's metadata", () => {
    const headers = new Headers({ "x-policy": "1" });
    headers.append("Set-Cookie", "a=1");
    headers.append("Set-Cookie", "b=2");
    const envelope = new ResponseEnvelope(new Response(null, { status: 202, headers }), 3);
    expect(envelope.status).toBe(202);
    expect(envelope.headers.get("x-policy")).toBe("1");
    expect(envelope.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    expect(envelope.response).toBe(envelope);
  });
});

describe("respond() on the direct leg", () => {
  it("an async call resolves with the envelope's value", async () => {
    const getItem = reference("direct-respond-async", async () =>
      respond({ id: 7 }, { headers: { "cache-control": "max-age=60" } })
    );
    const event = pageEvent();
    expect(await requestContext.run(event, () => getItem())).toEqual({ id: 7 });
  });

  it("a synchronous call returns the envelope's value synchronously", () => {
    const getItem = reference("direct-respond-sync", () => respond("value"));
    expect(requestContext.run(pageEvent(), () => getItem())).toBe("value");
  });

  it("a thrown envelope rejects with its value, both async and sync", async () => {
    const failing = reference("direct-respond-throw-async", async () => {
      throw respond({ reason: "nope" }, { status: 400 });
    });
    const failingSync = reference("direct-respond-throw-sync", () => {
      throw respond({ reason: "sync" }, { status: 400 });
    });
    const event = pageEvent();
    await expect(requestContext.run(event, () => failing())).rejects.toEqual({ reason: "nope" });
    expect(() => requestContext.run(event, () => failingSync())).toThrow(
      expect.objectContaining({ reason: "sync" })
    );
  });

  it("forwards each Set-Cookie onto the render's response head, and nothing else", async () => {
    const login = reference("direct-respond-cookies", async () => respond("ok", cookieInit()));
    const event = pageEvent();
    expect(await requestContext.run(event, () => login())).toBe("ok");
    expect(event.response.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(event.response.headers.get("cache-control")).toBeNull();
    expect(event.response.headers.get("x-extra")).toBeNull();
    expect(event.response.status).toBeUndefined();
  });

  it("a thrown envelope's cookies reach the head too", async () => {
    const failing = reference("direct-respond-throw-cookies", async () => {
      throw respond("denied", cookieInit());
    });
    const event = pageEvent();
    await expect(requestContext.run(event, () => failing())).rejects.toBe("denied");
    expect(event.response.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
  });

  it("the direct-result policy sees the value: respond(Component) brands as a server component", async () => {
    configureServerFunctionsServer({ transformDirectResult: frameTransformDirectResult });
    const View = () => "story";
    const getStory = reference("direct-respond-component", async () =>
      respond(View, { headers: { "cache-control": "public, max-age=60" } })
    );
    const result: any = await requestContext.run(pageEvent(), () => getStory());
    expect(typeof result).toBe("function");
    expect(result[SERVER_COMPONENT]).toBe("direct-respond-component");
  });
});
