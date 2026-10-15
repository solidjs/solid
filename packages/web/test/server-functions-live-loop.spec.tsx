/**
 * `live()`'s reconnect loop, driven from the client side alone: a stubbed
 * `fetch` answers each (re)connect with a body framed the way the server
 * frames one — the codec's chunk stream, or the same payloads as server-sent
 * events — and ENDS it the way the test says (cleanly, by dropping, or not
 * at all until the request's signal aborts). The server suite drives the
 * same loop end to end against the real handler; this one pins the loop's
 * own branches, each from the consumer's side: first-connect failure vs
 * post-connect death, the fail-fast 4xx set and its exceptions (408/425/429,
 * Retry-After), the reader's cursor riding back as `Last-Event-ID`, the
 * `online` wake, the consumer ending the iteration mid-connect and
 * mid-backoff, a caller's signal (`invoke`) ending it for good, the GET
 * composition, and the handler's local answers (a hit at the call, a
 * deferred hit, a hit at connect).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  GET,
  configureServerFunctionsClient,
  createServerReference,
  getServerFunctionsCodec,
  invoke,
  live
} from "../server-functions/src/client.js";
import {
  BODY_FORMAT_HEADER,
  BodyFormat,
  LAST_EVENT_ID_HEADER,
  createChunk,
  createEventChunk
} from "../server-functions/src/shared.js";

beforeEach(() => {
  configureServerFunctionsClient({
    endpoint: "/_server",
    fetch: null as any,
    prepareRequest: init => init,
    responseHandler: null as any
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  configureServerFunctionsClient({
    endpoint: "/_server",
    fetch: null as any,
    prepareRequest: init => init,
    responseHandler: null as any
  });
});

const never = new Promise<never>(() => {});

/** A source whose answer is `values`, then — unless `complete` — parks forever. */
function source(values: unknown[], complete = false) {
  return (async function* () {
    for (const value of values) yield value;
    if (!complete) await never;
  })();
}

/**
 * The codec's chunk payloads for `value`, as the server's encoder would
 * frame them: collected until the encoder reports done, or — for a value
 * that parks (an open stream) — until it goes quiet.
 */
async function payloads(value: unknown): Promise<string[]> {
  const { serializeJSON } = await import("../serialization/src/serializer.js");
  return new Promise((resolve, reject) => {
    const out: string[] = [];
    let quiet: ReturnType<typeof setTimeout> | undefined;
    serializeJSON(value, {
      ...getServerFunctionsCodec(),
      onParse(node) {
        out.push(JSON.stringify(node));
        clearTimeout(quiet);
        quiet = setTimeout(() => resolve(out), 20);
      },
      onDone() {
        clearTimeout(quiet);
        resolve(out);
      },
      onError: reject
    });
  });
}

type Framing = (payload: string, index: number) => Uint8Array;
const chunked: Framing = payload => createChunk(payload);
const events: Framing = (payload, index) => createEventChunk(payload, `ev-${index + 1}`);

/**
 * A live answer: the payloads, one per pull, then the body ends the way
 * `end` says — "close" (the source completed), "error" (the connection
 * dropped), "hang" (open until the request's signal aborts, as a real
 * fetch's body would be).
 */
function answer(
  payloads: string[],
  framing: Framing,
  end: "close" | "error" | "hang",
  signal?: AbortSignal | null,
  reason: unknown = new Error("connection lost")
) {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < payloads.length) {
        controller.enqueue(framing(payloads[index], index));
        index++;
        return;
      }
      if (end === "close") controller.close();
      else if (end === "error") controller.error(reason);
      else if (signal) {
        if (signal.aborted) controller.error(signal.reason);
        else
          signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      }
    }
  });
  return new Response(body, {
    headers: {
      "content-type": framing === events ? "text/event-stream" : "text/plain",
      [BODY_FORMAT_HEADER]: BodyFormat.Serialized
    }
  });
}

/** The runtime's bodiless answer: a one-value stream of `undefined`. */
const voidAnswer = () =>
  new Response(null, { status: 204, headers: { [BODY_FORMAT_HEADER]: BodyFormat.Void } });

/** A refusal: no runtime encoding at 4xx is the peer saying no. */
const refusal = (status: number, headers: Record<string, string> = {}) =>
  new Response(null, { status, headers });

type Sent = { address: string; init: RequestInit; headers: Headers };

/**
 * A `fetch` answering each call from `answers` in order (the last one
 * repeats), honoring the request's signal the way a real one does: an
 * aborted signal rejects the call.
 */
function server(...answers: Array<(sent: Sent) => Response | Promise<Response>>) {
  const calls: Sent[] = [];
  vi.stubGlobal("fetch", (address: string, init: RequestInit) => {
    const sent = { address, init, headers: new Headers(init.headers) };
    calls.push(sent);
    const signal = init.signal;
    if (signal && signal.aborted) return Promise.reject(signal.reason);
    return Promise.resolve(answers[Math.min(calls.length - 1, answers.length - 1)](sent));
  });
  return calls;
}

/** Status emissions, and (optionally) the `online` wake fired after each death. */
function watch(iterable: any, wakeOnReconnect = false) {
  const states: string[] = [];
  const errors: unknown[] = [];
  iterable.onstatus = (state: string, error?: unknown) => {
    states.push(state);
    if (error !== undefined) errors.push(error);
    // The loop registers its `online` listener right after it announces
    // the reconnect; the wake must land after that.
    if (wakeOnReconnect && state === "reconnecting")
      setTimeout(() => dispatchEvent(new Event("online")), 0);
  };
  return { states, errors };
}

async function drain(iterable: AsyncIterable<unknown>) {
  const values: unknown[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

describe("live(): the loop from the consumer's side", () => {
  test("live expects a server function reference", () => {
    expect(() => live((() => {}) as any)).toThrow(/server function reference/);
  });

  test("a streamed answer flows to completion; the handler's onLive fires at the call, before the fetch", async () => {
    const onLive = vi.fn();
    // A handler with no intercept: the call has no local-answer seam.
    configureServerFunctionsClient({ responseHandler: { onLive, handle: () => undefined } as any });
    const calls = server(() => answer(body, chunked, "close"));
    const body = await payloads(source([1, 2], true));
    const src = live(createServerReference("loop/stream"));
    const iterable = src();
    expect(onLive).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
    const { states } = watch(iterable);

    expect(await drain(iterable)).toEqual([1, 2]);
    expect(calls).toHaveLength(1);
    expect(calls[0].address).toBe("/_server/live/loop%2Fstream");
    expect(calls[0].init.method).toBe("POST");
    expect(states).toEqual(["connected", "closed"]);
  });

  test("a first-connect failure is the call's rejection — no status, no retry", async () => {
    const calls = server(() => Promise.reject(new Error("refused")));
    const iterable = live(createServerReference("loop/first"))();
    const { states } = watch(iterable);
    await expect(drain(iterable)).rejects.toThrow("refused");
    expect(calls).toHaveLength(1);
    expect(states).toEqual([]);
  });

  test("a death reconnects on the `online` wake, re-yielding the answer; the reader's cursor rides back as Last-Event-ID", async () => {
    const body = await payloads(source([1, 2]));
    const calls = server(
      () => answer(body, events, "error"),
      () => voidAnswer()
    );
    const iterable = live(createServerReference("loop/death"))();
    const { states, errors } = watch(iterable, true);

    expect(await drain(iterable)).toEqual([1, 2, undefined]);
    expect(calls).toHaveLength(2);
    expect(calls[0].headers.has(LAST_EVENT_ID_HEADER)).toBe(false);
    expect(calls[1].headers.get(LAST_EVENT_ID_HEADER)).toBe(`ev-${body.length}`);
    expect(states).toEqual(["connected", "reconnecting", "connected", "closed"]);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("connection lost");
  });

  test("a 4xx on reconnect fails fast: the error surfaces, the iteration closes with it", async () => {
    const body = await payloads(source([1]));
    const calls = server(
      () => answer(body, chunked, "error"),
      () => refusal(403)
    );
    const iterable = live(createServerReference("loop/refused"))();
    const { states, errors } = watch(iterable, true);
    const values: unknown[] = [];
    let failure: any;
    try {
      for await (const value of iterable) values.push(value);
    } catch (error) {
      failure = error;
    }
    expect(values).toEqual([1]);
    expect(failure.status).toBe(403);
    expect(calls).toHaveLength(2);
    expect(states).toEqual(["connected", "reconnecting", "closed"]);
    // the death's error, then the refusal closing it
    expect(errors).toHaveLength(2);
    expect(errors[1]).toBe(failure);
  });

  test.each([408, 425, 429])("%s on reconnect is transient: the loop retries", async status => {
    const body = await payloads(source([1]));
    const calls = server(
      () => answer(body, chunked, "error"),
      () => refusal(status),
      () => voidAnswer()
    );
    const iterable = live(createServerReference(`loop/transient-${status}`))();
    const { states } = watch(iterable, true);
    expect(await drain(iterable)).toEqual([1, undefined]);
    expect(calls).toHaveLength(3);
    expect(states).toEqual(["connected", "reconnecting", "reconnecting", "connected", "closed"]);
  });

  test("Retry-After on a refusal names the wait and the loop honors it instead of failing fast", async () => {
    const body = await payloads(source([1]));
    const calls = server(
      () => answer(body, chunked, "error"),
      () => refusal(403, { "Retry-After": "0" }),
      () => voidAnswer()
    );
    const iterable = live(createServerReference("loop/retry-after"))();
    // no `online` wake: the named (zero) wait is what lets the retry go
    const { states, errors } = watch(iterable, false);
    const started = performance.now();
    // the first death sleeps the backoff (500ms) unless woken — wake that
    // one by hand, the Retry-After one must wake itself
    iterable.onstatus = (state: string, error?: unknown) => {
      states.push(state);
      if (error !== undefined) errors.push(error);
      if (state === "reconnecting" && states.filter(s => s === "reconnecting").length === 1)
        setTimeout(() => dispatchEvent(new Event("online")), 0);
    };
    expect(await drain(iterable)).toEqual([1, undefined]);
    expect(performance.now() - started).toBeLessThan(400);
    expect(calls).toHaveLength(3);
    expect((errors[1] as any).retryAfter).toBe(0);
    expect(states).toEqual(["connected", "reconnecting", "reconnecting", "connected", "closed"]);
  });

  test("the consumer ending the iteration while connecting: the arriving stream is closed, the wire severed", async () => {
    let release!: (response: Response) => void;
    const calls = server(() => new Promise<Response>(resolve => (release = resolve)));
    const body = await payloads(source([1], true));
    const iterable = live(createServerReference("loop/return-connecting"))();
    const { states } = watch(iterable);
    const it = iterable[Symbol.asyncIterator]();
    const pending = it.next();
    while (!calls.length) await new Promise(resolve => setTimeout(resolve, 0));
    expect(await it.return!(undefined)).toEqual({ done: true, value: undefined });
    expect(calls[0].init.signal!.aborted).toBe(true);
    release(answer(body, chunked, "close"));
    expect(await pending).toEqual({ done: true, value: undefined });
    expect(states).toEqual(["closed"]);
  });

  test("the consumer ending the iteration during the backoff: the sleep is cut, the loop exits", async () => {
    const body = await payloads(source([1]));
    const calls = server(() => answer(body, chunked, "error"));
    const iterable = live(createServerReference("loop/return-backoff"))();
    const reconnecting = new Promise<void>(resolve => {
      iterable.onstatus = (state: string) => state === "reconnecting" && resolve();
    });
    const it = iterable[Symbol.asyncIterator]();
    expect(await it.next()).toEqual({ done: false, value: 1 });
    const pending = it.next();
    await reconnecting;
    expect(await it.return!(undefined)).toEqual({ done: true, value: undefined });
    expect(await pending).toEqual({ done: true, value: undefined });
    expect(calls).toHaveLength(1);
  });

  test("a caller's signal (invoke) aborting a connected stream ends the iteration for good, as a rejection", async () => {
    const body = await payloads(source([1]));
    const controller = new AbortController();
    const calls = server(sent => answer(body, chunked, "hang", sent.init.signal));
    const iterable = invoke(live(createServerReference("loop/invoke-abort")), {
      signal: controller.signal
    }) as any;
    const { states, errors } = watch(iterable);
    const it = iterable[Symbol.asyncIterator]();
    expect(await it.next()).toEqual({ done: false, value: 1 });
    const pending = it.next();
    controller.abort(new Error("caller done"));
    await expect(pending).rejects.toThrow("caller done");
    expect(calls).toHaveLength(1);
    expect(states).toEqual(["connected", "closed"]);
    expect((errors[0] as Error).message).toBe("caller done");
    // ended for good: the loop does not go on
    expect(await it.next()).toEqual({ done: true, value: undefined });
  });

  test("a caller's signal aborting during the backoff wakes the sleep; the connect it would make rejects", async () => {
    const body = await payloads(source([1]));
    const controller = new AbortController();
    const calls = server(() => answer(body, chunked, "error"));
    const iterable = invoke(live(createServerReference("loop/invoke-backoff")), {
      signal: controller.signal
    }) as any;
    const states: string[] = [];
    iterable.onstatus = (state: string) => {
      states.push(state);
      if (state === "reconnecting") setTimeout(() => controller.abort(new Error("gone")), 0);
    };
    await expect(drain(iterable)).rejects.toThrow("gone");
    // the sleep was cut by the abort; the reconnect's fetch saw the aborted signal
    expect(calls).toHaveLength(2);
    expect(calls[1].init.signal!.aborted).toBe(true);
    expect(states).toEqual(["connected", "reconnecting", "closed"]);
  });

  test("a host without a global EventTarget: the backoff is a plain timer, no `online` wake to attach", async () => {
    vi.stubGlobal("addEventListener", undefined);
    vi.stubGlobal("removeEventListener", undefined);
    const body = await payloads(source([1]));
    // the drop names its wait so the test need not sit out the backoff
    const dropped = Object.assign(new Error("lost"), { retryAfter: 0 });
    const calls = server(
      () => answer(body, chunked, "error", undefined, dropped),
      () => voidAnswer()
    );
    const iterable = live(createServerReference("loop/no-event-target"))();
    const { states } = watch(iterable);
    expect(await drain(iterable)).toEqual([1, undefined]);
    expect(calls).toHaveLength(2);
    expect(states).toEqual(["connected", "reconnecting", "connected", "closed"]);
  });

  test("live(GET(fn)) connects through the declaration's channel, at the live address, over GET", async () => {
    const calls = server(() => voidAnswer());
    const iterable = live(GET(createServerReference("loop/get")))(7);
    expect(await drain(iterable)).toEqual([undefined]);
    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].address).toBe("/_server/live/loop%2Fget?args=%5B7%5D");
  });

  describe("the handler's local answer", () => {
    test("a hit at the call is yielded first and marks the iteration adopted: the connect goes to the wire without asking again", async () => {
      const intercept = vi.fn(() => ({ n: 1 }));
      configureServerFunctionsClient({
        responseHandler: { intercept, handle: () => undefined } as any
      });
      const calls = server(() => voidAnswer());
      const iterable = live(createServerReference("loop/local-hit"))();
      expect(intercept).toHaveBeenCalledTimes(1);
      expect(await drain(iterable)).toEqual([{ n: 1 }, undefined]);
      expect(intercept).toHaveBeenCalledTimes(1);
      expect(calls).toHaveLength(1);
    });

    test("a deferred hit is awaited: a value lands first, nothing goes straight to the wire", async () => {
      // answered at the call only (a boundary still arriving); the connect
      // that follows a miss finds nothing local
      const local = [Promise.resolve("doc"), Promise.resolve(undefined)];
      configureServerFunctionsClient({
        responseHandler: { intercept: () => local.shift(), handle: () => undefined } as any
      });
      const calls = server(() => voidAnswer());
      expect(await drain(live(createServerReference("loop/local-deferred"))())).toEqual([
        "doc",
        undefined
      ]);
      expect(calls).toHaveLength(1);
      // the next call's deferred answer settles to nothing: a miss after all
      expect(await drain(live(createServerReference("loop/local-deferred"))())).toEqual([
        undefined
      ]);
      expect(calls).toHaveLength(2);
    });

    test("the consumer ending the iteration while a deferred hit is pending: the answer, landing, is not yielded", async () => {
      let land!: (value: unknown) => void;
      configureServerFunctionsClient({
        responseHandler: {
          intercept: () => new Promise(resolve => (land = resolve)),
          handle: () => undefined
        } as any
      });
      const calls = server(() => voidAnswer());
      const iterable = live(createServerReference("loop/local-returned"))();
      const it = iterable[Symbol.asyncIterator]();
      const pending = it.next();
      expect(await it.return!(undefined)).toEqual({ done: true, value: undefined });
      land("late");
      expect(await pending).toEqual({ done: true, value: undefined });
      expect(calls).toHaveLength(0);
    });

    test("a miss at the call but a hit at connect answers the connect locally: a one-value stream, no wire", async () => {
      let asked = 0;
      configureServerFunctionsClient({
        responseHandler: {
          intercept: () => (asked++ === 0 ? undefined : "local"),
          handle: () => undefined
        } as any
      });
      const calls = server(() => voidAnswer());
      const iterable = live(createServerReference("loop/connect-hit"))();
      const { states } = watch(iterable);
      expect(await drain(iterable)).toEqual(["local"]);
      expect(asked).toBe(2);
      expect(calls).toHaveLength(0);
      expect(states).toEqual(["connected", "closed"]);
    });
  });
});
