/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// The client's records on `OBSERVE.records` (sentry-integration-plan C4,
// client half): the `"call"` record — one server-function call made from
// the browser, as the caller awaited it — and the client side of the
// `"frame"` record — one frame stream applied by `applyFrameResponse`.
// Each is the twin of a server record (`"invocation"`, the frame's server
// half) and joins it by `id`; the difference is the wire.
//
// Pinned against the real client runtime with a stubbed fetch and
// hand-framed responses (the same seam the frames client specs use):
//
//  - a call: id, method, status, timing, the settled result beside it;
//  - a call that failed: the error AS THROWN to the caller, the status when
//    a response arrived and none when the fetch itself rejected;
//  - a stream applied: the census as the wire had it, the consumer's remap
//    (`as`) and restamp (`version`) on the record, the wire id kept;
//  - a body that ended before `complete`: `truncated`; a read that failed:
//    `error` with the failure beside it; several streams in one response:
//    one record each;
//  - a listener cannot break the call or the stream; without one nothing is
//    read;
//  - the call's bodies (`live.request`, an unread `live.response`) are taken
//    only for a listener that asked (`{ bodies: true }`): a plain listener
//    gets the transport's own response and no request; the reconstruction
//    and the clone never fail the call, and a deferred result's clone is
//    released at settle;
//  - the `"request"` record — the request LEFT, delivered at the send while
//    the call is still in flight — shares its `live` with the call's
//    `"call"` record by identity; a call that never sent (serialization
//    threw) emits none, a fetch that never settles emits it alone, and its
//    own `bodies` opt-in governs `live.request`.
//
// The channel is the core's, reached by its registered symbol (this runtime
// imports no framework): `OBSERVE.records` from `solid-js` IS what the
// emitter found.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { OBSERVE, createMemo, createRoot, createSignal, flush } from "solid-js";
import { attribution, type InteractionEvent, type NavigationEvent } from "solid-js/attribution";
import type { CallEvent, CallLive, CallRequestEvent, FrameEvent, FrameLive } from "@solidjs/web";
import {
  GET,
  configureServerFunctionsClient,
  createServerReference,
  getServerFunctionsCodec
} from "../server-functions/src/client.js";
import {
  BODY_FORMAT_HEADER,
  BodyFormat,
  ERROR_HEADER,
  createChunk,
  serializeStream
} from "../server-functions/src/shared.js";
import { applyFrameResponse } from "../frames/src/frame-transport.js";

const unsubscribes: Array<() => void> = [];
afterEach(() => {
  for (const off of unsubscribes.splice(0)) off();
  attribution.disable();
  flush();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * A `"call"` listener; `{ bodies: true }` asks for the live handles a body
 * viewer reads (the request reconstruction, the unread response clone),
 * which a plain listener is not charged for.
 */
function calls(options?: { bodies?: boolean }) {
  const seen: Array<{ event: CallEvent; live: CallLive }> = [];
  unsubscribes.push(
    OBSERVE!.records.subscribe(
      "call",
      (event, live) => {
        seen.push({ event, live });
      },
      options
    )
  );
  return seen;
}

/**
 * A `"request"` listener — the request LEFT, at the send; `{ bodies: true }`
 * asks for `live.request` on its own, without a `"call"` listener's opt-in.
 */
function requests(options?: { bodies?: boolean }) {
  const seen: Array<{ event: CallRequestEvent; live: CallLive }> = [];
  unsubscribes.push(
    OBSERVE!.records.subscribe(
      "request",
      (event, live) => {
        seen.push({ event, live });
      },
      options
    )
  );
  return seen;
}

/**
 * A `fetch` the test settles by hand: the call is in flight until
 * `answer(response)` or `fail(error)` — never, for a hung one.
 */
function deferredFetch() {
  let answer!: (response: Response) => void;
  let fail!: (error: unknown) => void;
  const calls: Array<{ address: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", (address: string, init: RequestInit) => {
    calls.push({ address, init });
    return new Promise<Response>((resolve, reject) => {
      answer = resolve;
      fail = reject;
    });
  });
  return { calls, answer: (r: Response) => answer(r), fail: (e: unknown) => fail(e) };
}

/** The transport's client configuration as the suite found it. */
function resetClientConfig() {
  configureServerFunctionsClient({
    endpoint: "/_server",
    fetch: null as any,
    prepareRequest: init => init,
    responseHandler: null as any
  });
}

function frames() {
  const seen: Array<{ event: FrameEvent; live: FrameLive }> = [];
  unsubscribes.push(
    OBSERVE!.records.subscribe("frame", (event, live) => {
      seen.push({ event, live });
    })
  );
  return seen;
}

/** A JSON-encoded server-function answer, as the runtime writes one. */
function jsonResponse(value: unknown, init: ResponseInit = {}, error = false) {
  const headers = new Headers(init.headers);
  headers.set(BODY_FORMAT_HEADER, BodyFormat.Json);
  if (error) headers.set(ERROR_HEADER, "thrown");
  return new Response(JSON.stringify(value), { ...init, headers });
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("the call record", () => {
  test("a call that settled: identity, method, status, timing, the result beside it", async () => {
    const seen = calls();
    let sent!: { address: string; init: RequestInit };
    vi.stubGlobal("fetch", async (address: string, init: RequestInit) => {
      sent = { address, init };
      await delay(5);
      return jsonResponse({ n: 42 });
    });
    const fn = createServerReference("records/double");
    const before = performance.now();
    expect(await fn(21)).toEqual({ n: 42 });
    const after = performance.now();

    expect(seen).toHaveLength(1);
    const { event, live } = seen[0];
    expect(event.id).toBe("records/double");
    expect(event.method).toBe("POST");
    expect(sent.init.method).toBe("POST");
    expect(event.outcome).toBe("ok");
    expect(event.status).toBe(200);
    expect(event.deferred).toBeUndefined();
    expect(event.at).toBeGreaterThanOrEqual(before);
    expect(event.at).toBeLessThanOrEqual(after);
    expect(event.durationMs).toBeGreaterThanOrEqual(4);
    expect(event.durationMs).toBeLessThanOrEqual(after - before);
    // Serializable — no handles on it; those ride beside.
    expect(Object.keys(event).sort()).toEqual([
      "at",
      "durationMs",
      "id",
      "method",
      "outcome",
      "status"
    ]);
    expect(JSON.parse(JSON.stringify(event))).toEqual(event);
    expect(live.args).toEqual([21]);
    expect(live.result).toEqual({ n: 42 });
    expect(live.response!.status).toBe(200);
    expect(live.error).toBeUndefined();
  });

  // The body-viewer half (devtools' network panel): the request as sent and
  // the response as it arrived, both the listener's own to read — taken only
  // for a listener that asked (`{ bodies: true }`). A plain listener costs
  // the call neither the reconstruction nor the clone: it gets no request
  // and the transport's own response, as before the handles existed.
  test("without the opt-in: no request, the transport's own response, nothing built or cloned", async () => {
    const seen = calls();
    const clone = vi.spyOn(Response.prototype, "clone");
    const NativeRequest = Request;
    let constructed = 0;
    vi.stubGlobal(
      "Request",
      class extends NativeRequest {
        constructor(...args: ConstructorParameters<typeof Request>) {
          constructed++;
          super(...args);
        }
      }
    );
    const arrived = jsonResponse({ n: 7 });
    vi.stubGlobal("fetch", async () => arrived);
    expect(await createServerReference("records/plain")({ a: 1 })).toEqual({ n: 7 });
    const { event, live } = seen[0];
    expect(event.status).toBe(200);
    expect(live.request).toBeUndefined();
    expect(live.response).toBe(arrived);
    expect(live.response!.bodyUsed).toBe(true);
    expect(clone).not.toHaveBeenCalled();
    expect(constructed).toBe(0);
  });

  test("the opt-in is per listener: a plain listener beside a bodies one, both get the handles", async () => {
    // Whether bodies are taken is the call's — asked once at its start of
    // the channel, not per listener — so both hear the same record.
    const plain = calls();
    const viewer = calls({ bodies: true });
    vi.stubGlobal("fetch", async () => jsonResponse(1));
    await createServerReference("records/shared")();
    expect(plain[0].live).toBe(viewer[0].live);
    expect(plain[0].live.request).toBeInstanceOf(Request);
    expect(plain[0].live.response!.bodyUsed).toBe(false);
  });

  test("the request as dispatched: final url, method, transport headers, a readable body", async () => {
    const seen = calls({ bodies: true });
    let sent!: { address: string; init: RequestInit };
    vi.stubGlobal("fetch", async (address: string, init: RequestInit) => {
      sent = { address, init };
      return jsonResponse(1);
    });
    await createServerReference("records/request")({ a: 1 });
    const { request } = seen[0].live;
    expect(request).toBeInstanceOf(Request);
    expect(new URL(request!.url).pathname).toBe(new URL(sent.address, location.href).pathname);
    expect(request!.method).toBe("POST");
    const headers = new Headers(sent.init.headers);
    expect(request!.headers.get("content-type")).toBe(headers.get("content-type"));
    expect(request!.headers.get(BODY_FORMAT_HEADER)).toBe(BodyFormat.Json);
    // The listener's copy of the payload — whole, and the transport's send
    // untouched by the read.
    expect(await request!.text()).toBe(sent.init.body);
  });

  test("the request carries what prepareRequest added; a streaming body is left to the send", async () => {
    const seen = calls({ bodies: true });
    let received!: RequestInit;
    vi.stubGlobal("fetch", async (_: string, init: RequestInit) => {
      received = init;
      return jsonResponse(1);
    });
    try {
      configureServerFunctionsClient({
        prepareRequest: init => ({
          ...init,
          headers: { ...(init.headers as Record<string, string>), authorization: "Bearer t" }
        })
      });
      await createServerReference("records/prepared")();
      expect(seen[0].live.request!.headers.get("authorization")).toBe("Bearer t");

      // A deliberate streaming upload: the hook swaps the body for a stream.
      // Reconstructing a Request over it would consume it ahead of the send,
      // so the listener's request reads as bodyless and the stream reaches
      // `fetch` unread.
      const upload = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode("chunk"));
          c.close();
        }
      });
      configureServerFunctionsClient({ prepareRequest: init => ({ ...init, body: upload }) });
      await createServerReference("records/upload")();
      expect(seen[1].live.request!.body).toBeNull();
      expect(received.body).toBe(upload);
      expect(upload.locked).toBe(false);
      expect(await new Response(upload).text()).toBe("chunk");
    } finally {
      resetClientConfig();
    }
  });

  test("a call that failed before the request was built has no request", async () => {
    const seen = calls({ bodies: true });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    // No rich-args codec is configured: a non-JSON argument fails serialization.
    await expect(createServerReference("records/unbuilt")(1n)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(seen).toHaveLength(1);
    expect(seen[0].event.outcome).toBe("error");
    expect(seen[0].live.request).toBeUndefined();
    expect(seen[0].live.response).toBeUndefined();
  });

  test("the response body is the listener's to read, unread, while the caller gets its result", async () => {
    const seen = calls({ bodies: true });
    vi.stubGlobal("fetch", async () => jsonResponse({ n: 42 }));
    expect(await createServerReference("records/body")()).toEqual({ n: 42 });
    const { response } = seen[0].live;
    expect(response!.bodyUsed).toBe(false);
    expect(await response!.text()).toBe(JSON.stringify({ n: 42 }));
  });

  test("an event-stream response is the transport's own object, not a clone", async () => {
    const seen = calls({ bodies: true });
    const stream = jsonResponse("live", { headers: { "content-type": "text/event-stream" } });
    vi.stubGlobal("fetch", async () => stream);
    expect(await createServerReference("records/stream")()).toBe("live");
    expect(seen[0].live.response).toBe(stream);
    expect(seen[0].live.response!.bodyUsed).toBe(true);
  });

  test("a deferred result (a generator's stream): the clone is released at settle, the response is the transport's", async () => {
    const seen = calls({ bodies: true });
    // A real streamed result, framed as the server frames one (the codec's
    // chunk stream, `text/plain` + Serialized), still producing when the
    // call settles: the caller gets the iterable at the first chunk and
    // drives the rest. Its clone would buffer every later chunk for nobody
    // (#3244) — so the record releases it once the settle shows the shape.
    let released!: () => void;
    const gate = new Promise<void>(r => (released = r));
    async function* produce() {
      yield 1;
      await gate;
      yield 2;
      yield 3;
    }
    const arrived = new Response(serializeStream(produce(), getServerFunctionsCodec()), {
      headers: { "content-type": "text/plain", [BODY_FORMAT_HEADER]: BodyFormat.Serialized }
    });
    const clones: Response[] = [];
    const nativeClone = Response.prototype.clone;
    vi.spyOn(Response.prototype, "clone").mockImplementation(function (this: Response) {
      const clone = nativeClone.call(this);
      clones.push(clone);
      return clone;
    });
    vi.stubGlobal("fetch", async () => arrived);

    const result = (await createServerReference("records/deferred")()) as AsyncIterable<number>;
    expect(seen).toHaveLength(1);
    const { event, live } = seen[0];
    expect(event.outcome).toBe("ok");
    expect(event.deferred).toBe(true);
    expect(event.status).toBe(200);
    // The clone was taken at arrival — the shape was not known then — and
    // is not what the listener gets.
    expect(clones).toHaveLength(1);
    expect(live.response).toBe(arrived);
    expect(live.response!.bodyUsed).toBe(true);
    // Released: its branch reads as done at once, while the producer is
    // still parked before its second chunk — nothing is queued for it.
    const branch = clones[0].body!;
    expect(branch.locked).toBe(false);
    expect(await branch.getReader().read()).toEqual({ done: true, value: undefined });
    // The caller's stream is untouched by the release.
    released();
    const values: number[] = [];
    for await (const value of result) values.push(value);
    expect(values).toEqual([1, 2, 3]);
  });

  test("a FormData body and a binary body are reconstructed whole and readable", async () => {
    const seen = calls({ bodies: true });
    vi.stubGlobal("fetch", async () => jsonResponse(1));
    const form = new FormData();
    form.append("title", "hello");
    form.append("count", "2");
    await createServerReference("records/form")(form);
    const formRequest = seen[0].live.request!;
    expect(formRequest.headers.get(BODY_FORMAT_HEADER)).toBe(BodyFormat.FormData);
    const readBack = await formRequest.formData();
    expect(readBack.get("title")).toBe("hello");
    expect(readBack.get("count")).toBe("2");
    // The transport's own FormData is not consumed by the read.
    expect(form.get("title")).toBe("hello");

    const bytes = new Uint8Array([1, 2, 3, 250]);
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    await createServerReference("records/blob")(blob);
    const blobRequest = seen[1].live.request!;
    expect(blobRequest.headers.get(BODY_FORMAT_HEADER)).toBe(BodyFormat.Blob);
    expect(new Uint8Array(await blobRequest.arrayBuffer())).toEqual(bytes);
  });

  test("an error response's body is readable through live.response", async () => {
    const seen = calls({ bodies: true });
    vi.stubGlobal("fetch", async () => jsonResponse({ message: "nope" }, { status: 500 }, true));
    await expect(createServerReference("records/error-body")()).rejects.toBeDefined();
    const { event, live } = seen[0];
    expect(event).toMatchObject({ outcome: "error", status: 500 });
    expect(live.response!.status).toBe(500);
    expect(live.response!.bodyUsed).toBe(false);
    expect(await live.response!.json()).toEqual({ message: "nope" });
  });

  // Nothing taken for the record may fail the call: the reconstruction and
  // the clone can each be refused by the platform where the transport's own
  // send and handler were not — the handle is then simply absent.
  test("a reconstruction the Request constructor refuses: the call resolves, the request is absent", async () => {
    const seen = calls({ bodies: true });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // A header NAME `new Request` rejects; the configured `fetch` is a
      // hand-rolled transport that tolerates it.
      configureServerFunctionsClient({
        prepareRequest: init => ({
          ...init,
          headers: { ...(init.headers as Record<string, string>), "bad header": "x" }
        }),
        fetch: async (_address, init) => {
          expect((init!.headers as Record<string, string>)["bad header"]).toBe("x");
          return jsonResponse("tolerated");
        }
      });
      expect(await createServerReference("records/bad-header")()).toBe("tolerated");
      expect(seen).toHaveLength(1);
      expect(seen[0].event.outcome).toBe("ok");
      expect(seen[0].live.request).toBeUndefined();
      expect(seen[0].live.response!.bodyUsed).toBe(false);
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      resetClientConfig();
    }
  });

  test("a response clone() refuses (already read, claimed by the handler): the call resolves with the transport's object", async () => {
    const seen = calls({ bodies: true });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const consumed = jsonResponse({ n: 1 });
      await consumed.text();
      configureServerFunctionsClient({
        fetch: async () => consumed,
        responseHandler: { handle: () => "claimed" }
      });
      expect(await createServerReference("records/consumed")()).toBe("claimed");
      expect(seen).toHaveLength(1);
      const { event, live } = seen[0];
      expect(event).toMatchObject({ outcome: "ok", status: 200 });
      expect(live.response).toBe(consumed);
      expect(live.result).toBe("claimed");
      expect(error).not.toHaveBeenCalled();
    } finally {
      resetClientConfig();
    }
  });

  test("an async-iterable upload reaches the send unopened; the reconstructed request is bodyless", async () => {
    const seen = calls({ bodies: true });
    let received!: RequestInit;
    vi.stubGlobal("fetch", async (_: string, init: RequestInit) => {
      received = init;
      return jsonResponse(1);
    });
    let opened = 0;
    const upload = {
      [Symbol.asyncIterator]() {
        opened++;
        return (async function* () {
          yield new TextEncoder().encode("chunk");
        })();
      }
    };
    try {
      // The transport's streaming-upload contract admits an async iterable
      // beside a ReadableStream; a Request over either would compete with
      // the send for it.
      configureServerFunctionsClient({
        prepareRequest: init => ({ ...init, body: upload as any, duplex: "half" }) as RequestInit
      });
      await createServerReference("records/iterable")();
      expect(received.body).toBe(upload);
      expect(opened).toBe(0);
      const { request } = seen[0].live;
      expect(request).toBeInstanceOf(Request);
      expect(request!.body).toBeNull();
    } finally {
      resetClientConfig();
    }
  });

  test("a relative address with no location to resolve it against: no request; an absolute one reconstructs", async () => {
    const seen = calls({ bodies: true });
    vi.stubGlobal("fetch", async () => jsonResponse(1));
    vi.stubGlobal("location", undefined);
    expect(globalThis.location).toBeUndefined();
    try {
      // The default endpoint is relative: a URL the transport never sent
      // (`http://localhost/...`) is worse than none.
      await createServerReference("records/relative")();
      expect(seen[0].event.outcome).toBe("ok");
      expect(seen[0].live.request).toBeUndefined();
      // An absolute endpoint needs no base.
      configureServerFunctionsClient({ endpoint: "https://api.example.com/_server" });
      await createServerReference("records/absolute")();
      expect(seen[1].live.request!.url).toBe(
        "https://api.example.com/_server/data/records%2Fabsolute"
      );
    } finally {
      resetClientConfig();
    }
  });

  test("the reference's source name rides on the record; an unnamed reference carries none", async () => {
    const seen = calls();
    vi.stubGlobal("fetch", async () => jsonResponse(1));
    await createServerReference("records/named", "double")();
    await createServerReference("records/anonymous")();
    expect(seen[0].event.name).toBe("double");
    expect("name" in seen[1].event).toBe(false);
  });

  test("a GET-encoded read records method GET with the call's arguments", async () => {
    const seen = calls();
    vi.stubGlobal("fetch", async () => jsonResponse("read"));
    const read = GET(createServerReference("records/read"));
    expect(await read("a", 2)).toBe("read");
    expect(seen).toHaveLength(1);
    expect(seen[0].event.method).toBe("GET");
    expect(seen[0].event.id).toBe("records/read");
    expect(seen[0].live.args).toEqual(["a", 2]);
  });

  test("a call the server rejected: outcome error, the thrown value beside it, the status on the record", async () => {
    const seen = calls();
    vi.stubGlobal("fetch", async () => jsonResponse({ message: "nope" }, { status: 500 }, true));
    const fn = createServerReference("records/throws");
    let thrown: unknown;
    try {
      await fn();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(seen).toHaveLength(1);
    const { event, live } = seen[0];
    expect(event).toMatchObject({ id: "records/throws", outcome: "error", status: 500 });
    // As thrown to the caller — the same object.
    expect(live.error).toBe(thrown);
    expect(live.result).toBeUndefined();
    expect(live.response!.status).toBe(500);
  });

  test("a call whose fetch rejected: outcome error and no status — no response arrived", async () => {
    const seen = calls();
    const failure = new TypeError("network down");
    vi.stubGlobal("fetch", async () => {
      throw failure;
    });
    const fn = createServerReference("records/offline");
    await expect(fn()).rejects.toBe(failure);
    expect(seen).toHaveLength(1);
    const { event, live } = seen[0];
    expect(event.outcome).toBe("error");
    expect(event.status).toBeUndefined();
    expect(live.response).toBeUndefined();
    expect(live.error).toBe(failure);
  });

  test("a throwing listener is reported; the call and the other listeners are unaffected", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const seen: string[] = [];
      unsubscribes.push(
        OBSERVE!.records.subscribe("call", () => {
          throw new Error("listener bug");
        })
      );
      unsubscribes.push(
        OBSERVE!.records.subscribe("call", event => {
          seen.push(event.outcome);
        })
      );
      vi.stubGlobal("fetch", async () => jsonResponse(1));
      expect(await createServerReference("records/listener")()).toBe(1);
      expect(seen).toEqual(["ok"]);
      expect(error).toHaveBeenCalledTimes(1);
      expect((error.mock.calls[0][0] as Error).message).toBe("listener bug");
    } finally {
      error.mockRestore();
    }
  });

  test("without a listener nothing is delivered, and the call is the same", async () => {
    const seen = calls();
    for (const off of unsubscribes.splice(0)) off();
    vi.stubGlobal("fetch", async () => jsonResponse("quiet"));
    expect(await createServerReference("records/quiet")()).toBe("quiet");
    expect(seen).toHaveLength(0);
  });
});

// The record's provenance: what the call ran for, read at dispatch from the
// attribution engine (`OBSERVE.attribution.currentOrigin`, reached by the
// engine's registered symbol — this runtime imports no framework). The
// object is the engine's own frame, so an observer joins the call to the
// interaction or navigation record by identity, not by a time window.
describe("the call record's origin", () => {
  const CLICK = { type: "click", target: 'button#save "Save"' };

  function arm() {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    attribution.enable({ log: false, hotRuns: false, hotTime: false, waterfalls: false });
    const interactions: InteractionEvent[] = [];
    const navigations: NavigationEvent[] = [];
    unsubscribes.push(
      OBSERVE!.records.subscribe("interaction", e => interactions.push(e)),
      OBSERVE!.records.subscribe("navigation", e => navigations.push(e))
    );
    return { interactions, navigations };
  }

  test("a call made in a handler carries the interaction — the interaction record's own origin object", async () => {
    const seen = calls();
    const { interactions } = arm();
    vi.stubGlobal("fetch", async () => jsonResponse("saved"));
    const save = createServerReference("records/save");
    // An `async` handler runs synchronously up to its first await: the
    // dispatch happens inside the frame, as a write there would.
    const pending = OBSERVE!.attribution.withInteraction(CLICK, () => save("draft"));
    flush();
    expect(await pending).toBe("saved");

    expect(seen).toHaveLength(1);
    const { event } = seen[0];
    expect(event.origin).toMatchObject({
      kind: "interaction",
      name: "click",
      target: CLICK.target
    });
    expect(interactions).toHaveLength(1);
    expect(event.origin).toBe(interactions[0].origin);
    // Still a plain record: the origin is the engine's serializable face.
    expect(JSON.parse(JSON.stringify(event))).toEqual(event);
  });

  test("a call made inside a recompute the navigation's write caused carries the navigation, under its click", async () => {
    const seen = calls();
    const { navigations } = arm();
    vi.stubGlobal("fetch", async () => jsonResponse("page"));
    const load = createServerReference("records/page");
    const [location, setLocation] = createSignal("/users", { name: "location" });
    let pending: Promise<unknown> | undefined;
    createRoot(() => {
      // What `createAsync(() => load(location()))` does: the call is made
      // inside the compute, and the record is stamped there.
      const page = createMemo(
        () => {
          const l = location();
          if (l !== "/users") pending = load(l);
          return l;
        },
        { name: "page" }
      );
      page();
    });
    flush();
    OBSERVE!.attribution.withInteraction(CLICK, () =>
      OBSERVE!.attribution.withOrigin(
        { kind: "navigation", name: "/users/:id", to: "/users/42", from: "/users" },
        () => setLocation("/users/42")
      )
    );
    flush();
    expect(await pending).toBe("page");

    expect(seen).toHaveLength(1);
    const { event } = seen[0];
    expect(event.origin).toMatchObject({
      kind: "navigation",
      name: "/users/:id",
      to: "/users/42",
      interaction: { kind: "interaction", name: "click" }
    });
    expect(navigations).toHaveLength(1);
    expect(event.origin).toBe(navigations[0].origin);
  });

  test("a call after the handler's first await, or with no engine, carries none", async () => {
    const seen = calls();
    vi.stubGlobal("fetch", async () => jsonResponse("ok"));
    const fn = createServerReference("records/bare");
    // No engine: the record is the same as before this field existed.
    expect(await fn()).toBe("ok");
    expect(seen[0].event.origin).toBeUndefined();
    expect("origin" in seen[0].event).toBe(false);

    arm();
    // The documented escape: after an await the frame is gone, as it is
    // for a write there.
    const late = OBSERVE!.attribution.withInteraction(CLICK, async () => {
      await delay(1);
      return fn();
    });
    flush();
    expect(await late).toBe("ok");
    expect(seen).toHaveLength(2);
    expect(seen[1].event.origin).toBeUndefined();
  });
});

// The request LEFT: the `"call"` record is delivered at settle, so a network
// panel reading it alone cannot show a call in flight or one that hung. The
// `"request"` record is delivered at the send — after serialization and
// `prepareRequest`, immediately before `fetch` — and shares the call's
// `live` with the `"call"` record by identity, so the panel's pending row
// and its settled row are one object filled in twice.
describe("the request record", () => {
  test("delivered at the send, while the call is still in flight; the call record follows at settle", async () => {
    const left = requests();
    const settled = calls();
    const wire = deferredFetch();
    const fn = createServerReference("requests/inflight");
    const before = performance.now();
    const pending = fn({ a: 1 });
    // The dispatch reaches the send after its own awaits (serialization,
    // the hook); nothing about the response has happened yet.
    await vi.waitFor(() => expect(wire.calls).toHaveLength(1));
    const afterSend = performance.now();

    expect(left).toHaveLength(1);
    expect(settled).toHaveLength(0);
    const { event, live } = left[0];
    expect(event.side).toBe("client");
    expect(event.id).toBe("requests/inflight");
    expect(event.method).toBe("POST");
    expect(event.at).toBeGreaterThanOrEqual(before);
    expect(event.at).toBeLessThanOrEqual(afterSend);
    // Serializable — the send's facts only; the settle's (`durationMs`,
    // `outcome`, `status`) belong to the "call" record.
    expect(Object.keys(event).sort()).toEqual(["at", "id", "method", "side"]);
    expect(JSON.parse(JSON.stringify(event))).toEqual(event);
    // The live handles as they stand at the send: the arguments, nothing
    // of the response yet.
    expect(live.args).toEqual([{ a: 1 }]);
    expect(live.response).toBeUndefined();
    expect(live.result).toBeUndefined();
    expect(live.error).toBeUndefined();

    wire.answer(jsonResponse({ n: 1 }));
    expect(await pending).toEqual({ n: 1 });
    expect(left).toHaveLength(1);
    expect(settled).toHaveLength(1);
    expect(settled[0].event).toMatchObject({ id: "requests/inflight", outcome: "ok", status: 200 });
  });

  test("a hung fetch: the request record alone, no call record", async () => {
    const left = requests();
    const settled = calls();
    const wire = deferredFetch();
    // Never awaited — the fetch never settles, and neither does the call.
    void createServerReference("requests/hung")();
    await vi.waitFor(() => expect(wire.calls).toHaveLength(1));
    // A turn for anything that would have settled to do so.
    await delay(5);
    expect(left).toHaveLength(1);
    expect(left[0].event.id).toBe("requests/hung");
    expect(settled).toHaveLength(0);
  });

  test("the live is one object across the call's records: the request set at the send, the response and result at settle", async () => {
    const left = requests();
    const settled = calls({ bodies: true });
    const wire = deferredFetch();
    const pending = createServerReference("requests/joined")({ a: 1 });
    await vi.waitFor(() => expect(left).toHaveLength(1));
    const { live } = left[0];
    // Reconstructed BEFORE the record was delivered: the request listener
    // reads it, and the transport's send is untouched by the read. ONE
    // `Request` for both records, so the body is read through a clone —
    // the documented way — and stays whole for the "call" listener.
    expect(live.request).toBeInstanceOf(Request);
    expect(await live.request!.clone().text()).toBe(wire.calls[0].init.body);
    expect(live.request!.bodyUsed).toBe(false);
    expect(live.response).toBeUndefined();

    wire.answer(jsonResponse({ n: 2 }));
    expect(await pending).toEqual({ n: 2 });
    expect(settled).toHaveLength(1);
    // The identity IS the join — no id-plus-time match, no sequence number.
    expect(settled[0].live).toBe(live);
    expect(live.response!.status).toBe(200);
    expect(live.response!.bodyUsed).toBe(false);
    expect(live.result).toEqual({ n: 2 });
    expect(live.request).toBe(left[0].live.request);
    // The "call" listener still reads the shared request's body in full.
    expect(settled[0].live.request!.bodyUsed).toBe(false);
    expect(await settled[0].live.request!.text()).toBe(wire.calls[0].init.body);
  });

  test("the shared request's body reads once: read directly at the send, it is spent for the call listener", async () => {
    const left = requests({ bodies: true });
    const settled = calls();
    vi.stubGlobal("fetch", async () => jsonResponse(1));
    // The documented consequence of the shared handle: a listener that
    // reads `live.request.text()` rather than `live.request.clone().text()`
    // leaves the other record's listener a consumed body.
    unsubscribes.push(
      OBSERVE!.records.subscribe("request", (_event, live) => {
        void live.request!.text();
      })
    );
    await createServerReference("requests/spent")({ a: 1 });
    expect(left[0].live.request).toBe(settled[0].live.request);
    expect(settled[0].live.request!.bodyUsed).toBe(true);
  });

  test("the live is filled on every settle — a request listener alone reads the outcome off it", async () => {
    const left = requests();
    const wire = deferredFetch();
    const pending = createServerReference("requests/filled")({ a: 1 });
    await vi.waitFor(() => expect(left).toHaveLength(1));
    const { live } = left[0];
    expect(live.response).toBeUndefined();
    expect(live.result).toBeUndefined();

    const answer = jsonResponse({ n: 3 });
    wire.answer(answer);
    expect(await pending).toEqual({ n: 3 });
    // No "call" listener anywhere, no "call" record — and the object the
    // request listener holds has the settle on it regardless: the
    // transport's own response (no clone without a "call" bodies opt-in)
    // and the result.
    expect(live.response).toBe(answer);
    expect(live.response!.bodyUsed).toBe(true);
    expect(live.result).toEqual({ n: 3 });
    expect(live.error).toBeUndefined();

    // And the error, for a call that failed.
    const failure = new TypeError("network down");
    vi.stubGlobal("fetch", async () => {
      throw failure;
    });
    await expect(createServerReference("requests/filled-error")()).rejects.toBe(failure);
    expect(left).toHaveLength(2);
    expect(left[1].live.error).toBe(failure);
    expect(left[1].live.result).toBeUndefined();
    expect(left[1].live.response).toBeUndefined();
  });

  test("bodies on the request subscription alone reconstructs live.request; a bodies-less call listener beside it gets the same", async () => {
    const left = requests({ bodies: true });
    const settled = calls();
    const clone = vi.spyOn(Response.prototype, "clone");
    vi.stubGlobal("fetch", async () => jsonResponse(1));
    await createServerReference("requests/bodies")({ a: 1 });
    expect(left[0].live.request).toBeInstanceOf(Request);
    expect(await left[0].live.request!.text()).toBe(JSON.stringify([{ a: 1 }]));
    // One live: the call listener, which did not ask, finds the request too
    // — and the response is the transport's own: the clone is the "call"
    // listener's opt-in, which nobody made.
    expect(settled[0].live).toBe(left[0].live);
    expect(settled[0].live.request).toBe(left[0].live.request);
    expect(clone).not.toHaveBeenCalled();
    expect(settled[0].live.response!.bodyUsed).toBe(true);
  });

  test("without bodies on either subscription: no request built, none on the live", async () => {
    const left = requests();
    const settled = calls();
    const NativeRequest = Request;
    let constructed = 0;
    vi.stubGlobal(
      "Request",
      class extends NativeRequest {
        constructor(...args: ConstructorParameters<typeof Request>) {
          constructed++;
          super(...args);
        }
      }
    );
    vi.stubGlobal("fetch", async () => jsonResponse(1));
    await createServerReference("requests/plain")({ a: 1 });
    expect(left).toHaveLength(1);
    expect(left[0].live.request).toBeUndefined();
    expect(settled[0].live.request).toBeUndefined();
    expect(constructed).toBe(0);
  });

  test("a reconstruction the Request constructor refuses: the record is still delivered, the request absent", async () => {
    const left = requests({ bodies: true });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      configureServerFunctionsClient({
        prepareRequest: init => ({
          ...init,
          headers: { ...(init.headers as Record<string, string>), "bad header": "x" }
        }),
        fetch: async () => jsonResponse("tolerated")
      });
      expect(await createServerReference("requests/bad-header")()).toBe("tolerated");
      expect(left).toHaveLength(1);
      expect(left[0].event.id).toBe("requests/bad-header");
      expect(left[0].live.request).toBeUndefined();
      expect(error).not.toHaveBeenCalled();
    } finally {
      resetClientConfig();
    }
  });

  test("`at` is the send, after prepareRequest — not the call's dispatch; the call's span covers it", async () => {
    const left = requests();
    const settled = calls();
    vi.stubGlobal("fetch", async () => jsonResponse(1));
    try {
      configureServerFunctionsClient({
        prepareRequest: async init => {
          await delay(10);
          return init;
        }
      });
      await createServerReference("requests/late-send")();
      const request = left[0].event;
      const call = settled[0].event;
      // The call was made first; the request left after the hook's wait.
      expect(request.at).toBeGreaterThanOrEqual(call.at);
      expect(request.at - call.at).toBeGreaterThanOrEqual(9);
      // And the call's own span reaches past the send.
      expect(call.at + call.durationMs).toBeGreaterThanOrEqual(request.at);
    } finally {
      resetClientConfig();
    }
  });

  test("the reference's source name and a GET-encoded read's method ride on the record", async () => {
    const left = requests();
    vi.stubGlobal("fetch", async () => jsonResponse(1));
    await createServerReference("requests/named", "double")();
    await createServerReference("requests/anonymous")();
    await GET(createServerReference("requests/read"))("a", 2);
    expect(left).toHaveLength(3);
    expect(left[0].event.name).toBe("double");
    expect("name" in left[1].event).toBe(false);
    expect(left[2].event).toMatchObject({ id: "requests/read", method: "GET" });
    expect(left[2].live.args).toEqual(["a", 2]);
  });

  test("a call made in a handler carries the interaction — the same origin object the call record carries", async () => {
    const left = requests();
    const settled = calls();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    attribution.enable({ log: false, hotRuns: false, hotTime: false, waterfalls: false });
    const interactions: InteractionEvent[] = [];
    unsubscribes.push(OBSERVE!.records.subscribe("interaction", e => interactions.push(e)));
    vi.stubGlobal("fetch", async () => jsonResponse("saved"));
    const save = createServerReference("requests/save");
    const click = { type: "click", target: 'button#save "Save"' };
    const pending = OBSERVE!.attribution.withInteraction(click, () => save("draft"));
    flush();
    expect(await pending).toBe("saved");

    expect(left).toHaveLength(1);
    expect(left[0].event.origin).toMatchObject({ kind: "interaction", name: "click" });
    expect(interactions).toHaveLength(1);
    expect(left[0].event.origin).toBe(interactions[0].origin);
    expect(left[0].event.origin).toBe(settled[0].event.origin);
    expect(JSON.parse(JSON.stringify(left[0].event))).toEqual(left[0].event);
    // Without an engine the field is absent, as on the call record.
    attribution.disable();
    await save("again");
    expect("origin" in left[1].event).toBe(false);
  });

  test("a call that failed before its request was built emits no request record — only the call's settle", async () => {
    const left = requests({ bodies: true });
    const settled = calls();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    // No rich-args codec: a bigint argument fails serialization; nothing left.
    await expect(createServerReference("requests/unbuilt")(1n)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(left).toHaveLength(0);
    expect(settled).toHaveLength(1);
    expect(settled[0].event.outcome).toBe("error");
    expect(settled[0].live.request).toBeUndefined();
  });

  test("a fetch that rejected: the request left, and the call record says how it ended", async () => {
    const left = requests();
    const settled = calls();
    const failure = new TypeError("network down");
    vi.stubGlobal("fetch", async () => {
      throw failure;
    });
    await expect(createServerReference("requests/offline")()).rejects.toBe(failure);
    expect(left).toHaveLength(1);
    expect(settled).toHaveLength(1);
    expect(settled[0].live).toBe(left[0].live);
    expect(settled[0].event.outcome).toBe("error");
    expect(settled[0].event.status).toBeUndefined();
    expect(left[0].live.error).toBe(failure);
  });

  test("a deferred result: the request at the send, the call at handoff", async () => {
    const left = requests();
    const settled = calls();
    async function* produce() {
      yield 1;
      yield 2;
    }
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(serializeStream(produce(), getServerFunctionsCodec()), {
          headers: { "content-type": "text/plain", [BODY_FORMAT_HEADER]: BodyFormat.Serialized }
        })
    );
    const result = (await createServerReference("requests/deferred")()) as AsyncIterable<number>;
    expect(left).toHaveLength(1);
    expect(settled).toHaveLength(1);
    expect(settled[0].event.deferred).toBe(true);
    expect(settled[0].live).toBe(left[0].live);
    const values: number[] = [];
    for await (const value of result) values.push(value);
    expect(values).toEqual([1, 2]);
  });

  test("a call an integration answered locally made no request and emits neither record", async () => {
    const left = requests();
    const settled = calls();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    try {
      configureServerFunctionsClient({
        responseHandler: { handle: () => undefined, intercept: () => "local" } as any
      });
      expect(await createServerReference("requests/local")()).toBe("local");
      expect(fetch).not.toHaveBeenCalled();
      expect(left).toHaveLength(0);
      expect(settled).toHaveLength(0);
    } finally {
      resetClientConfig();
    }
  });

  test("a request listener alone: the observation exists, the request is delivered, and no call record is built — the gate is the call's start's", async () => {
    const left = requests();
    const wire = deferredFetch();
    const pending = createServerReference("requests/alone")();
    await vi.waitFor(() => expect(left).toHaveLength(1));
    // The observation was opened with no "call" listener, so this call
    // builds no "call" record: one arriving mid-call has nothing to hear —
    // not because it arrived late, but because the gate was closed when
    // the call started (the next test is the other case).
    const late = calls();
    wire.answer(jsonResponse("ok"));
    expect(await pending).toBe("ok");
    expect(late).toHaveLength(0);
    // The next call, made under both, delivers both — one live.
    vi.stubGlobal("fetch", async () => jsonResponse("next"));
    expect(await createServerReference("requests/both")()).toBe("next");
    expect(left).toHaveLength(2);
    expect(late).toHaveLength(1);
    expect(late[0].live).toBe(left[1].live);
  });

  test("gated per call, delivered per emission: a listener subscribing mid-call hears the records that fire after it", async () => {
    const left = requests();
    const settled = calls();
    const wire = deferredFetch();
    const pending = createServerReference("requests/mid-call")();
    await vi.waitFor(() => expect(left).toHaveLength(1));
    // The "call" gate was open at the start (`settled` was there), so the
    // settle record is built — and delivered to whoever is subscribed the
    // moment it fires: a second "call" listener that arrived after the
    // send hears this call's settle without ever having seen its
    // "request". A "request" listener arriving now hears nothing of this
    // call: its record already fired.
    const lateCalls = calls();
    const lateRequests = requests();
    wire.answer(jsonResponse("ok"));
    expect(await pending).toBe("ok");
    expect(settled).toHaveLength(1);
    expect(lateCalls).toHaveLength(1);
    expect(lateCalls[0].live).toBe(left[0].live);
    expect(lateCalls[0].event).toBe(settled[0].event);
    expect(lateRequests).toHaveLength(0);
  });

  test("a throwing prepareRequest: nothing was handed to fetch, so no request record — one call record, outcome error", async () => {
    const left = requests();
    const settled = calls();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const failure = new Error("no session");
    try {
      configureServerFunctionsClient({
        prepareRequest: () => {
          throw failure;
        }
      });
      await expect(createServerReference("requests/unprepared")()).rejects.toBe(failure);
      expect(fetch).not.toHaveBeenCalled();
      expect(left).toHaveLength(0);
      expect(settled).toHaveLength(1);
      expect(settled[0].event.outcome).toBe("error");
      expect(settled[0].live.error).toBe(failure);
    } finally {
      resetClientConfig();
    }
  });

  test("a fetch that throws synchronously: the request was handed to fetch, so its record is delivered; the call says how it ended", async () => {
    const left = requests();
    const settled = calls();
    const failure = new TypeError("refused to send");
    // Not a rejection — a throw from `fetch` itself. "Left" means handed
    // to `fetch`, not that it reached the network.
    vi.stubGlobal("fetch", () => {
      throw failure;
    });
    await expect(createServerReference("requests/sync-throw")()).rejects.toBe(failure);
    expect(left).toHaveLength(1);
    expect(left[0].event.id).toBe("requests/sync-throw");
    expect(settled).toHaveLength(1);
    expect(settled[0].live).toBe(left[0].live);
    expect(settled[0].event.outcome).toBe("error");
    expect(settled[0].event.status).toBeUndefined();
    expect(left[0].live.error).toBe(failure);
  });

  test("a throwing request listener is reported; the call, its record and the other listeners are unaffected", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const seen: string[] = [];
      unsubscribes.push(
        OBSERVE!.records.subscribe("request", () => {
          throw new Error("listener bug");
        })
      );
      unsubscribes.push(
        OBSERVE!.records.subscribe("request", event => {
          seen.push(event.id);
        })
      );
      const settled = calls();
      vi.stubGlobal("fetch", async () => jsonResponse(1));
      expect(await createServerReference("requests/listener")()).toBe(1);
      expect(seen).toEqual(["requests/listener"]);
      expect(settled).toHaveLength(1);
      expect(settled[0].event.outcome).toBe("ok");
      expect(error).toHaveBeenCalledTimes(1);
      expect((error.mock.calls[0][0] as Error).message).toBe("listener bug");
    } finally {
      error.mockRestore();
    }
  });

  test("without a listener for either record nothing is delivered", async () => {
    const left = requests();
    const settled = calls();
    for (const off of unsubscribes.splice(0)) off();
    vi.stubGlobal("fetch", async () => jsonResponse("quiet"));
    expect(await createServerReference("requests/quiet")()).toBe("quiet");
    expect(left).toHaveLength(0);
    expect(settled).toHaveLength(0);
  });
});

function frameResponse(id: string, chunks: any[]) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(
          typeof chunk === "string" ? createChunk(chunk) : createChunk(JSON.stringify(chunk))
        );
      }
      controller.close();
    }
  });
  return new Response(body, { headers: { "X-Frame-Stream": id } });
}

/** A host that records what it was handed. */
function recordingHost() {
  const applied: any[] = [];
  return { applied, host: { apply: (chunk: any) => applied.push(chunk) } as any };
}

describe("the frame record, client side", () => {
  test("a stream applied: identity from the wire, the consumer's remap and restamp, the census", async () => {
    const seen = frames();
    const { applied, host } = recordingHost();
    const chunks = [
      { type: "start", id: "srv", version: 1 },
      { type: "slot", id: "srv", version: 1, key: "comment#0", args: { text: "hi" } },
      // A nested server-content region: html addressed to a child frame.
      { type: "html", id: "srv/arg:comment#0:body", version: 1, html: "<em>region</em>" },
      { type: "html", id: "srv", version: 1, html: "<article/>" },
      { type: "fragment", id: "srv", version: 1, key: "f0", html: "<p>late</p>" },
      { type: "error", id: "srv", version: 1, key: "f1", error: "boom" },
      { type: "complete", id: "srv", version: 1 }
    ];
    const before = performance.now();
    const address = await applyFrameResponse(frameResponse("srv", chunks), host, {
      as: "local-1",
      version: 7
    });
    const after = performance.now();
    expect(address).toBe("local-1");
    expect(applied).toHaveLength(chunks.length);

    expect(seen).toHaveLength(1);
    const { event, live } = seen[0];
    expect(event.side).toBe("client");
    // The wire id is the record's id (what the server's half carries); the
    // remap is beside it.
    expect(event.id).toBe("srv");
    if (event.side === "client") expect(event.address).toBe("local-1");
    // The version is the consumer's restamp — the number the stale-guard saw.
    expect(event.version).toBe(7);
    expect(event.outcome).toBe("complete");
    expect(event.at).toBeGreaterThanOrEqual(before);
    expect(event.at).toBeLessThanOrEqual(after);
    expect(event.shellMs).toBeGreaterThanOrEqual(0);
    expect(event.shellMs!).toBeLessThanOrEqual(event.durationMs);
    expect(event.durationMs).toBeLessThanOrEqual(after - before);
    // The census is the wire, between `start` and `complete`.
    expect(event.chunks).toBe(chunks.length - 2);
    expect(event.slots).toBe(1);
    expect(event.regions).toBe(1);
    expect(event.fragments).toBe(1);
    expect(event.errors).toBe(1);
    expect(JSON.parse(JSON.stringify(event))).toEqual(event);
    expect(live.response).toBeInstanceOf(Response);
    expect(live.error).toBeUndefined();
  });

  test("applied under the wire id: no address; the wire's version stands", async () => {
    const seen = frames();
    const { host } = recordingHost();
    await applyFrameResponse(
      frameResponse("srv", [
        { type: "start", id: "srv", version: 3 },
        { type: "html", id: "srv", version: 3, html: "<p/>" },
        { type: "complete", id: "srv", version: 3 }
      ]),
      host
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].event).toMatchObject({ side: "client", id: "srv", version: 3, chunks: 1 });
    expect("address" in seen[0].event).toBe(false);
  });

  test("a body that ended before complete records truncated", async () => {
    const seen = frames();
    const { host } = recordingHost();
    await applyFrameResponse(
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        { type: "html", id: "srv", version: 1, html: "<p/>" }
      ]),
      host
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].event).toMatchObject({ outcome: "truncated", chunks: 1 });
    expect(seen[0].event.shellMs).toBeDefined();
    expect(seen[0].live.error).toBeUndefined();
  });

  test("a read that failed records error with the failure beside it, and still throws", async () => {
    const seen = frames();
    const { host } = recordingHost();
    let thrown: unknown;
    try {
      await applyFrameResponse(
        frameResponse("srv", [{ type: "start", id: "srv", version: 1 }, "{not json"]),
        host
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SyntaxError);
    expect(seen).toHaveLength(1);
    expect(seen[0].event.outcome).toBe("error");
    expect(seen[0].live.error).toBe(thrown);
  });

  test("a single-flight response with several streams: one record each, in sequence", async () => {
    const seen = frames();
    const { host } = recordingHost();
    const versions: string[] = [];
    await applyFrameResponse(
      frameResponse("a", [
        { type: "start", id: "a", version: 1 },
        { type: "html", id: "a", version: 1, html: "<p>a</p>" },
        { type: "complete", id: "a", version: 1 },
        { type: "start", id: "b", version: 1 },
        { type: "html", id: "b", version: 1, html: "<p>b</p>" },
        { type: "fragment", id: "b", version: 1, key: "f", html: "<p/>" },
        { type: "complete", id: "b", version: 1 },
        // The response-scoped envelope is not a stream chunk.
        { type: "outcome", payload: "{}" }
      ]),
      host,
      { version: id => (versions.push(id), versions.length * 10) }
    );
    expect(seen.map(s => s.event.id)).toEqual(["a", "b"]);
    expect(seen.map(s => s.event.version)).toEqual([10, 20]);
    expect(seen.map(s => s.event.chunks)).toEqual([1, 2]);
    expect(seen.map(s => s.event.outcome)).toEqual(["complete", "complete"]);
  });

  test("a throwing listener is reported; the stream and the other listeners are unaffected", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const seen: string[] = [];
      unsubscribes.push(
        OBSERVE!.records.subscribe("frame", () => {
          throw new Error("listener bug");
        })
      );
      unsubscribes.push(
        OBSERVE!.records.subscribe("frame", event => {
          seen.push(event.outcome);
        })
      );
      const { applied, host } = recordingHost();
      await applyFrameResponse(
        frameResponse("srv", [
          { type: "start", id: "srv", version: 1 },
          { type: "complete", id: "srv", version: 1 }
        ]),
        host
      );
      expect(applied).toHaveLength(2);
      expect(seen).toEqual(["complete"]);
      expect(error).toHaveBeenCalledTimes(1);
      expect((error.mock.calls[0][0] as Error).message).toBe("listener bug");
    } finally {
      error.mockRestore();
    }
  });

  test("without a listener nothing is delivered", async () => {
    const seen = frames();
    for (const off of unsubscribes.splice(0)) off();
    const { applied, host } = recordingHost();
    await applyFrameResponse(
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        { type: "complete", id: "srv", version: 1 }
      ]),
      host
    );
    expect(applied).toHaveLength(2);
    expect(seen).toHaveLength(0);
  });
});

describe("tiers, in the built artifacts", () => {
  // Requires a prior `pnpm build`. The strings that survive minification:
  // the registered names the emitters reach the channel and the engine by.
  const marker = "@solidjs/signals/observe/records";
  const engine = "@solidjs/signals/observe/attribution";
  const read = (file: string) => readFileSync(resolve(import.meta.dirname, "..", file), "utf8");
  // The main client entry's tier: `dist/<tier>.js` and every module under
  // `dist/<tier>/` (the per-module build), concatenated.
  const readClientTier = (tier: string) => {
    const dir = resolve(import.meta.dirname, "..", "dist", tier);
    const files = readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith(".js"))
      .map(e => resolve(e.parentPath, e.name))
      .sort();
    expect(files.length, `${tier}: per-module dist`).toBeGreaterThan(1);
    return [read(`dist/${tier}.js`), ...files.map(f => readFileSync(f, "utf8"))].join("\n");
  };

  test("the emitters fold out of the prod client artifacts and ride the observe and dev ones", () => {
    for (const entry of ["server-functions/dist", "frames/dist"]) {
      expect(read(`${entry}/client.js`), `${entry}/client.js`).not.toContain(marker);
      expect(read(`${entry}/client.js`), `${entry}/client.js`).not.toContain(engine);
      expect(read(`${entry}/client.observe.js`), `${entry}/client.observe.js`).toContain(marker);
      expect(read(`${entry}/client.dev.js`), `${entry}/client.dev.js`).toContain(marker);
    }
    // The call record's provenance reach rides with the call emitter.
    expect(read("server-functions/dist/client.observe.js")).toContain(engine);
    expect(read("server-functions/dist/client.dev.js")).toContain(engine);
    // The main client entry emits no record of its own. It is built per
    // module (`dist/web.js` + `dist/web/**`, likewise per tier), so the
    // whole tier is read.
    for (const tier of ["web", "web.observe", "web.dev"]) {
      expect(readClientTier(tier), tier).not.toContain(marker);
    }
  });

  test("every client artifact had its flags replaced — an unreplaced literal is a truthy string", () => {
    for (const file of [
      "server-functions/dist/client.js",
      "server-functions/dist/client.observe.js",
      "server-functions/dist/client.dev.js",
      "frames/dist/client.js",
      "frames/dist/client.observe.js",
      "frames/dist/client.dev.js"
    ]) {
      const code = read(file);
      expect(code, file).not.toContain('"_SOLID_OBSERVE_"');
      expect(code, file).not.toContain('"_SOLID_DEV_"');
    }
  });

  test("the removed observer API is gone from both server-function entries", () => {
    for (const file of ["server-functions/dist/client.js", "server-functions/dist/server.js"]) {
      expect(read(file), file).not.toContain("observeServerFunctionCalls");
    }
  });
});
