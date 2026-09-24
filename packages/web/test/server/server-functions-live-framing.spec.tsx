/**
 * The live address and its framing (Stage 8, slice A1; RFC 10 `live(fn)` →
 * Framing / Position). A `live` loop is the third caller kind and gets the
 * third address, `<endpoint>/live/<id>`, whose answers are the scripted
 * codec stream framed as server-sent events: `text/event-stream`,
 * `no-store`, `X-Accel-Buffering: no`, one codec payload per `data:` event,
 * a value-shaped yield's digest as the event's `id:`. The loop echoes the
 * last id back as `Last-Event-ID`; a reconnect whose position equals the
 * first yield's digest gets that yield skipped. The data address is
 * untouched.
 *
 * Like the other server-function specs, these run against the built
 * bundles (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  GET as serverGET,
  createServerReference as createServerSideReference,
  handleServerFunctionRequest,
  registerServerFunction,
  registerServerReference
} from "@solidjs/web/server-functions/server";
import {
  EventStreamReader,
  GET,
  createEventChunk,
  createServerReference,
  live,
  positionDigest
} from "@solidjs/web/server-functions/client";
// the DEV client artifact, for the diagnostic that folds out of the prod one
// prettier-ignore
// @ts-ignore — the dist file has no adjacent type declarations.
import { createServerReference as createServerReferenceDev, live as liveDev } from "../../server-functions/dist/client.dev.js";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const restores: (() => void)[] = [];
afterEach(() => {
  while (restores.length) restores.pop()!();
});

/** Every request the client transport sends, dispatched into the handler. */
function connectTransport() {
  const original = globalThis.fetch;
  const requests: Request[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request =
      input instanceof Request
        ? input
        : new Request(new URL(input.toString(), "http://localhost"), init);
    request.headers.set("Sec-Fetch-Site", "same-origin");
    requests.push(request);
    const signal = init?.signal;
    return new Promise<Response>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      handleServerFunctionRequest(request).then(resolve, reject);
    });
  }) as typeof fetch;
  restores.push(() => {
    globalThis.fetch = original;
  });
  return requests;
}

function request(url: string, init?: RequestInit) {
  const r = new Request(new URL(url, "http://localhost"), { method: "POST", ...init });
  r.headers.set("Sec-Fetch-Site", "same-origin");
  return r;
}

async function take<T>(iterable: AsyncIterable<T>, count: number) {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
    if (values.length === count) break;
  }
  return values;
}

/** A body read through the client's event-stream reader, data per event. */
async function events(body: ReadableStream<Uint8Array>, wire: { position?: string } = {}) {
  const reader = new (EventStreamReader as any)(body, wire);
  const out: string[] = [];
  await reader.drain((data: string) => out.push(data));
  return out;
}

describe("the live address answers in event-stream framing", () => {
  it("frames a streamed answer as server-sent events with the live headers", async () => {
    registerServerFunction("lf-frame-0", async function* () {
      yield { n: 1 };
      yield { n: 2 };
    });
    const response = await handleServerFunctionRequest(request("/_server/live/lf-frame-0"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    // the payloads are the same codec records: the Serialized format tag
    expect(response.headers.get("X-Server-Function-Format")).toBe("0");
    const text = await response.text();
    // what `curl -N` shows: data lines, blank-line separated, ids on the
    // records that carry a yield
    expect(text).toMatch(/^data: \{/);
    expect(text.split("\n\n").filter(Boolean).length).toBeGreaterThanOrEqual(3);
    expect(text).toContain(`id: ${positionDigest({ n: 1 })}\ndata: `);
    expect(text).toContain(`id: ${positionDigest({ n: 2 })}\ndata: `);
    expect(text).not.toMatch(/;0x[0-9a-f]{8};/); // not the length-prefixed framing
  });

  it("leaves the data address byte-identical: length-prefixed, text/plain, no ids", async () => {
    registerServerFunction("lf-data-0", async function* () {
      yield { n: 1 };
    });
    const response = await handleServerFunctionRequest(request("/_server/data/lf-data-0"));
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    expect(response.headers.get("X-Accel-Buffering")).toBeNull();
    const text = await response.text();
    expect(text).toMatch(/^;0x[0-9a-f]{8};\{/);
    expect(text).not.toContain("data: ");
    expect(text).not.toContain("id: ");
  });

  it("writes a comment heartbeat every 20s while the source is idle", async () => {
    let release!: () => void;
    registerServerFunction("lf-heartbeat-0", async function* () {
      yield { n: 1 };
      await new Promise<void>(r => (release = r));
    });
    vi.useFakeTimers();
    let reader: ReadableStreamDefaultReader<Uint8Array>;
    const decoder = new TextDecoder();
    try {
      const response = await handleServerFunctionRequest(request("/_server/live/lf-heartbeat-0"));
      reader = response.body!.getReader();
      let text = "";
      // head record and the first yield
      while (!text.includes(`id: ${positionDigest({ n: 1 })}`)) {
        text += decoder.decode((await reader.read()).value, { stream: true });
      }
      expect(text).not.toContain(":\n\n");
      const next = reader.read();
      await vi.advanceTimersByTimeAsync(20000);
      const chunk = await next;
      expect(decoder.decode(chunk.value)).toBe(":\n\n");
    } finally {
      vi.useRealTimers();
    }
    release();
    // completes cleanly after the heartbeat; the close record follows
    let rest = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += decoder.decode(value, { stream: true });
    }
    expect(rest).toContain("data: ");
  });

  it("is a scripted address: a thrown outcome is the ordinary encoded failure", async () => {
    registerServerFunction("lf-throw-0", async () => {
      throw new Error("refused");
    });
    const response = await handleServerFunctionRequest(request("/_server/live/lf-throw-0"));
    expect(response.status).toBe(500);
    expect(response.headers.has("X-Server-Function-Error")).toBe(true);
    expect(response.headers.get("Content-Type")).not.toBe("text/event-stream");
  });

  it("a live segment is only ever the live address — a function id spelled `live` parses bare", async () => {
    registerServerFunction("live", async () => "bare");
    const response = await handleServerFunctionRequest(request("/_server/live"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("bare");
  });
});

describe("the live loop calls the live address and reads the framing", () => {
  it("POST-shaped source: the loop requests /live/<id> and receives the yields", async () => {
    registerServerFunction("lf-loop-0", async function* () {
      yield { n: 1 };
      yield { n: 2 };
      yield { n: 3 };
    });
    const requests = connectTransport();
    const source = live(createServerReference("lf-loop-0"));
    const values = await take((source as any)(), 3);
    expect(values).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0].url).pathname).toBe("/_server/live/lf-loop-0");
    expect(requests[0].method).toBe("POST");
  });

  it("GET-composed source: the query encoding rides at the live address", async () => {
    serverGET(
      createServerSideReference(
        registerServerReference("lf-loop-get-0", async function* (room: string) {
          yield { room, n: 1 };
        })
      )
    );
    const requests = connectTransport();
    const source = live(GET(createServerReference("lf-loop-get-0")));
    const values = await take((source as any)("a"), 1);
    expect(values).toEqual([{ room: "a", n: 1 }]);
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0].url);
    expect(requests[0].method).toBe("GET");
    expect(url.pathname).toBe("/_server/live/lf-loop-get-0");
    expect(url.searchParams.get("args")).toBe(JSON.stringify(["a"]));
  });

  it("a one-value answer completes the iteration through the framing", async () => {
    registerServerFunction("lf-one-0", async () => ({ once: true }));
    connectTransport();
    const source = live(createServerReference("lf-one-0"));
    const values: unknown[] = [];
    for await (const value of (source as any)()) values.push(value);
    expect(values).toEqual([{ once: true }]);
  });
});

describe("position: Last-Event-ID and the digest-equal first-emission skip", () => {
  it("the reconnect carries the last received id; a digest-equal first yield is skipped", async () => {
    // Connection 1 yields {v:1} then dies; connection 2 re-yields current
    // state {v:1} (value sources re-yield on invocation) and then {v:2}.
    // The loop must see {v:1} once — the re-yield is elided by digest.
    let connections = 0;
    registerServerFunction("lf-pos-0", async function* () {
      connections++;
      if (connections === 1) {
        yield { v: 1 };
        throw new Error("connection lost");
      }
      yield { v: 1 };
      yield { v: 2 };
    });
    const requests = connectTransport();
    const source = live(createServerReference("lf-pos-0"));
    const values = await take((source as any)(), 2);
    expect(values).toEqual([{ v: 1 }, { v: 2 }]);
    expect(requests).toHaveLength(2);
    expect(requests[0].headers.get("Last-Event-ID")).toBeNull();
    expect(requests[1].headers.get("Last-Event-ID")).toBe(positionDigest({ v: 1 }));
  });

  it("an unequal position yields at once", async () => {
    registerServerFunction("lf-pos-1", async function* () {
      yield { v: 2 };
      yield { v: 3 };
    });
    const response = await handleServerFunctionRequest(
      request("/_server/live/lf-pos-1", {
        headers: { "Last-Event-ID": positionDigest({ v: 1 })! }
      })
    );
    const data = await events(response.body!);
    // two yield records (each an object with the one key `v`) follow the head
    expect(data.filter(d => d.includes('"k":["v"]')).length).toBe(2);
  });

  it("only the first emission is examined: a later repeat is a change and flows", async () => {
    registerServerFunction("lf-pos-2", async function* () {
      yield { v: 1 };
      yield { v: 2 };
      yield { v: 1 };
    });
    const response = await handleServerFunctionRequest(
      request("/_server/live/lf-pos-2", {
        headers: { "Last-Event-ID": positionDigest({ v: 1 })! }
      })
    );
    const text = await response.text();
    // first {v:1} skipped, {v:2} and the repeated {v:1} carried
    expect(text.split(`id: ${positionDigest({ v: 1 })}\n`).length - 1).toBe(1);
    expect(text.split(`id: ${positionDigest({ v: 2 })}\n`).length - 1).toBe(1);
  });

  it("a yield that is not JSON-safe carries no id and is never skipped", async () => {
    const when = new Date(0);
    registerServerFunction("lf-pos-3", async function* () {
      yield when;
      yield when;
    });
    expect(positionDigest(when)).toBeUndefined();
    const wire: { position?: string } = {};
    const response = await handleServerFunctionRequest(
      request("/_server/live/lf-pos-3", { headers: { "Last-Event-ID": "anything" } })
    );
    const text = await response.clone().text();
    expect(text).not.toContain("id: ");
    const data = await events(response.body!, wire);
    expect(wire.position).toBeUndefined();
    expect(data.length).toBeGreaterThanOrEqual(3); // head + two yields
  });

  it("a one-value answer whose digest matches completes with nothing", async () => {
    registerServerFunction("lf-pos-4", async () => ({ once: true }));
    const response = await handleServerFunctionRequest(
      request("/_server/live/lf-pos-4", {
        headers: { "Last-Event-ID": positionDigest({ once: true })! }
      })
    );
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    const data = await events(response.body!);
    // an empty stream: its head record and its close, no value
    expect(data.join("\n")).not.toContain("once");
  });

  it("the digest is over the value, stable across connections", () => {
    expect(positionDigest({ a: 1, b: [1, 2] })).toBe(positionDigest({ a: 1, b: [1, 2] }));
    expect(positionDigest({ a: 1 })).not.toBe(positionDigest({ a: 2 }));
    expect(positionDigest({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
    expect(positionDigest(undefined)).toBeUndefined();
    expect(positionDigest(new Map())).toBeUndefined();
  });
});

describe("the event-stream reader", () => {
  const stream = (...chunks: Uint8Array[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      }
    });

  it("reassembles a synthetic multi-line payload and records the id", async () => {
    const wire: { position?: string } = {};
    const data = await events(
      stream(createEventChunk("line one\nline two\r\nline three", "p1")),
      wire
    );
    expect(data).toEqual(["line one\nline two\nline three"]);
    expect(wire.position).toBe("p1");
  });

  it("survives arbitrary read boundaries, skips comments, ignores other fields", async () => {
    const text =
      ":heartbeat\n\n" +
      "event: message\nretry: 5000\nid: a\ndata: first\n\n" +
      "data:second\r\n\r\n" + // no space after the colon, CRLF line ends
      "id: b\ndata: third\n\n";
    const bytes = new TextEncoder().encode(text);
    const wire: { position?: string } = {};
    const data = await events(stream(...[...bytes].map(b => new Uint8Array([b]))), wire);
    expect(data).toEqual(["first", "second", "third"]);
    expect(wire.position).toBe("b");
  });

  it("an event the body ends inside is discarded", async () => {
    const data = await events(stream(new TextEncoder().encode("data: whole\n\ndata: cut")));
    expect(data).toEqual(["whole"]);
  });

  it("an id carrying U+0000 is not a position", async () => {
    const wire: { position?: string } = {};
    await events(stream(new TextEncoder().encode("id: a\u0000b\ndata: x\n\n")), wire);
    expect(wire.position).toBeUndefined();
    expect(createEventChunk("x", "a\u0000b")).toEqual(createEventChunk("x"));
  });
});

describe("dev: more than five live connections over HTTP/1.1 warns once (dev artifact)", () => {
  // Sources that yield once and then hold the connection open until released.
  function holdingSource(id: string) {
    let release!: () => void;
    const held = new Promise<void>(r => (release = r));
    registerServerFunction(id, async function* () {
      yield { id };
      await held;
    });
    return release;
  }

  // ordered: the warning fires once per page, so the silent case runs first
  it("stays silent when the document came over HTTP/2", async () => {
    const releases = Array.from({ length: 6 }, (_, i) => holdingSource(`lf-http2-${i}`));
    restores.push(...releases);
    connectTransport();
    const entries = vi
      .spyOn(performance, "getEntriesByType")
      .mockImplementation(((type: string) =>
        type === "navigation" ? [{ nextHopProtocol: "h2" }] : []) as any);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    restores.push(
      () => entries.mockRestore(),
      () => warn.mockRestore()
    );
    const iterators: AsyncIterator<unknown>[] = [];
    for (let i = 0; i < 6; i++) {
      const iterator = (liveDev(createServerReferenceDev(`lf-http2-${i}`)) as any)()[
        Symbol.asyncIterator
      ]();
      iterators.push(iterator);
      await iterator.next();
    }
    expect(warn).not.toHaveBeenCalled();
    for (const iterator of iterators) await iterator.return!(undefined);
  });

  it("names the open connections and points at server.https", async () => {
    const releases = Array.from({ length: 6 }, (_, i) => holdingSource(`lf-http1-${i}`));
    restores.push(...releases);
    connectTransport();
    const entries = vi
      .spyOn(performance, "getEntriesByType")
      .mockImplementation(((type: string) =>
        type === "navigation" ? [{ nextHopProtocol: "http/1.1" }] : []) as any);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    restores.push(
      () => entries.mockRestore(),
      () => warn.mockRestore()
    );
    const iterators: AsyncIterator<unknown>[] = [];
    for (let i = 0; i < 6; i++) {
      const source = liveDev(createServerReferenceDev(`lf-http1-${i}`));
      const iterator = (source as any)()[Symbol.asyncIterator]();
      iterators.push(iterator);
      await iterator.next(); // connected
      expect(warn).toHaveBeenCalledTimes(i === 5 ? 1 : 0);
    }
    const message = warn.mock.calls[0][0] as string;
    expect(message).toContain("6 live connections");
    expect(message).toContain("lf-http1-0");
    expect(message).toContain("lf-http1-5");
    expect(message).toContain("http/1.1");
    expect(message).toContain("server.https");
    for (const iterator of iterators) await iterator.return!(undefined);
  });
});

describe("death at the live address rejects what it left open (today's behavior, pinned)", () => {
  it("a body cut mid-stream fails the pending pull; the loop reconnects", async () => {
    let connections = 0;
    registerServerFunction("lf-death-0", async function* () {
      connections++;
      yield { n: connections };
      if (connections === 1) throw new Error("connection lost");
      yield { n: 99 };
    });
    connectTransport();
    const source = live(createServerReference("lf-death-0"));
    const states: string[] = [];
    const iterable = (source as any)();
    iterable.onstatus = (state: string) => states.push(state);
    const values = await take(iterable, 3);
    expect(values).toEqual([{ n: 1 }, { n: 2 }, { n: 99 }]);
    // the `break` in take() ends the iteration: "closed" is its own doing
    expect(states).toEqual(["connected", "reconnecting", "connected", "closed"]);
  });
});
