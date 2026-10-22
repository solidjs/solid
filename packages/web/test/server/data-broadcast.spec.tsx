/**
 * `broadcast(fn)` over a plain-data source: at the live address, callers
 * with the same arguments share ONE source — its first caller's — and each
 * call is a tap on it. Every codec record is framed once and written to
 * every tap. A viewer that joins later gets the stream's head and the
 * latest yield, then the shared records; the source ends with its last tap
 * and runs under its own event, not any viewer's request.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRequestEvent } from "../../src/server.js";
import {
  broadcast,
  createServerReference,
  handleServerFunctionRequest,
  registerServerReference
} from "../../server-functions/src/server.js";
import { createJSONDeserializer } from "../../serialization/src/serializer-decode.js";

const RequestContext = Symbol.for("solid.RequestContext");
beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});
afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const tick = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

const get = (id: string, args: unknown[], headers: HeadersInit = {}) =>
  new Request(
    `http://localhost/_server/live/${id}?args=${encodeURIComponent(JSON.stringify(args))}`,
    { method: "GET", headers }
  );

/** A source the test drives: each `push` is the next yield. */
function channel<T>() {
  const state = {
    started: 0,
    returned: false,
    values: [] as T[],
    wake: null as null | (() => void)
  };
  // Each call's answer is its own iterator; only one is ever read.
  const source = (): AsyncIterableIterator<T> => {
    let first = true;
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        if (first) state.started++;
        first = false;
        while (!state.values.length && !state.returned)
          await new Promise<void>(r => (state.wake = r));
        if (state.returned) return { value: undefined as any, done: true };
        return { value: state.values.shift()!, done: false };
      },
      async return() {
        if (!first) {
          state.returned = true;
          state.wake?.();
        }
        return { value: undefined as any, done: true };
      }
    };
  };
  const push = (value: T) => {
    state.values.push(value);
    state.wake?.();
  };
  return { source, state, push };
}

/**
 * A tap as the client reads it: every event's raw text and position, and
 * the values its decoded stream yields (one deserializer per connection,
 * as the client has).
 */
function tap(response: Response) {
  const events: { id?: string; data: string }[] = [];
  const values: any[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const decode = createJSONDeserializer();
  let buffer = "";
  (async () => {
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const lines = buffer.slice(0, end).split("\n");
        buffer = buffer.slice(end + 2);
        const data = lines
          .filter(l => l.startsWith("data: "))
          .map(l => l.slice(6))
          .join("\n");
        if (!data) continue;
        const id = lines.find(l => l.startsWith("id: "))?.slice(4);
        events.push({ id, data });
        const decoded: any = decode(JSON.parse(data));
        if (events.length === 1)
          (async () => {
            for await (const v of decoded) values.push(v);
          })().catch(() => {});
      }
    }
  })();
  return { events, values, response, cancel: () => reader.cancel() };
}

function declareFeed<T>(id: string) {
  const calls: unknown[] = [];
  const feeds = new Map<string, ReturnType<typeof channel<T>>>();
  broadcast(
    createServerReference(
      registerServerReference(id, async (key: string) => {
        calls.push(getRequestEvent()?.request?.url);
        if (!feeds.has(key)) feeds.set(key, channel<T>());
        return feeds.get(key)!.source();
      })
    )
  );
  return { calls, feeds };
}

describe("broadcast data sources", () => {
  it("callers with the same arguments share one source; the outer body runs per call", async () => {
    const { calls, feeds } = declareFeed<number>("bd-share");
    const a = tap(await handleServerFunctionRequest(get("bd-share", ["k"])));
    await tick();
    const b = tap(await handleServerFunctionRequest(get("bd-share", ["k"])));
    await tick();
    const feed = feeds.get("k")!;
    feed.push(1);
    feed.push(2);
    await tick();
    expect(calls).toHaveLength(2);
    expect(feed.state.started).toBe(1);
    expect(a.values).toEqual([1, 2]);
    expect(b.values).toEqual([1, 2]);
    // One framing, written to both.
    expect(b.events.map(e => e.data)).toEqual(a.events.map(e => e.data));
    a.cancel();
    b.cancel();
    await tick();
  });

  it("a joiner gets the latest yield whole, even where it shares objects with earlier ones", async () => {
    const { feeds } = declareFeed<any[]>("bd-join");
    const a = tap(await handleServerFunctionRequest(get("bd-join", ["k"])));
    await tick();
    const feed = feeds.get("k")!;
    const kept = { id: 1, name: "kept" };
    feed.push([kept, { id: 2, name: "b" }]);
    await tick();
    feed.push([kept, { id: 2, name: "b2" }, kept]);
    await tick();
    const b = tap(await handleServerFunctionRequest(get("bd-join", ["k"])));
    await tick();
    expect(b.values).toEqual([[kept, { id: 2, name: "b2" }, kept]]);
    // Identity within a yield still holds.
    expect(b.values[0][0]).toBe(b.values[0][2]);
    feed.push([kept]);
    await tick();
    expect(a.values.at(-1)).toEqual([kept]);
    expect(b.values.at(-1)).toEqual([kept]);
    a.cancel();
    b.cancel();
    await tick();
  });

  it("unchanged objects go as references to the yield before, joiner or not", async () => {
    const { feeds } = declareFeed<any[]>("bd-refs");
    const a = tap(await handleServerFunctionRequest(get("bd-refs", ["k"])));
    await tick();
    const feed = feeds.get("k")!;
    const kept = { id: 1, name: "kept" };
    feed.push([kept, { id: 2 }]);
    await tick();
    const b = tap(await handleServerFunctionRequest(get("bd-refs", ["k"])));
    await tick();
    feed.push([kept, { id: 3 }]);
    await tick();
    const last = JSON.parse(a.events.at(-1)!.data);
    expect(JSON.stringify(last)).not.toContain("kept");
    expect(b.events.at(-1)!.data).toBe(a.events.at(-1)!.data);
    expect(b.values.at(-1)).toEqual([kept, { id: 3 }]);
    a.cancel();
    b.cancel();
    await tick();
  });

  it("an object dropped for a yield and back later is sent again", async () => {
    const { feeds } = declareFeed<any[]>("bd-back");
    const a = tap(await handleServerFunctionRequest(get("bd-back", ["k"])));
    await tick();
    const feed = feeds.get("k")!;
    const row = { id: 1, name: "row" };
    feed.push([row]);
    await tick();
    feed.push([]);
    await tick();
    const b = tap(await handleServerFunctionRequest(get("bd-back", ["k"])));
    await tick();
    feed.push([row]);
    await tick();
    expect(a.values.at(-1)).toEqual([row]);
    expect(b.values).toEqual([[], [row]]);
    a.cancel();
    b.cancel();
    await tick();
  });

  it("a reconnect is sent the latest yield, carrying its position", async () => {
    const { feeds } = declareFeed<string>("bd-resume");
    const a = tap(await handleServerFunctionRequest(get("bd-resume", ["k"])));
    await tick();
    const feed = feeds.get("k")!;
    feed.push("one");
    await tick();
    const position = a.events.at(-1)!.id!;
    expect(position).toBeTruthy();
    const b = tap(
      await handleServerFunctionRequest(get("bd-resume", ["k"], { "Last-Event-ID": position }))
    );
    await tick();
    expect(b.values).toEqual(["one"]);
    expect(b.events.at(-1)!.id).toBe(position);
    feed.push("two");
    await tick();
    expect(b.values).toEqual(["one", "two"]);
    a.cancel();
    b.cancel();
    await tick();
  });

  it("a caller that can't be given the latest yield whole is served on its own", async () => {
    const { feeds } = declareFeed<any>("bd-pending");
    const a = tap(await handleServerFunctionRequest(get("bd-pending", ["k"])));
    await tick();
    const feed = feeds.get("k")!;
    feed.push({ later: new Promise(() => {}) });
    await tick();
    const b = tap(await handleServerFunctionRequest(get("bd-pending", ["k"])));
    await tick();
    expect(feed.state.started).toBe(2);
    a.cancel();
    b.cancel();
    await tick();
  });

  it("different arguments are separate sources", async () => {
    const { feeds } = declareFeed<string>("bd-args");
    const a = tap(await handleServerFunctionRequest(get("bd-args", ["red"])));
    const b = tap(await handleServerFunctionRequest(get("bd-args", ["blue"])));
    await tick();
    feeds.get("red")!.push("r");
    feeds.get("blue")!.push("b");
    await tick();
    expect(a.values).toEqual(["r"]);
    expect(b.values).toEqual(["b"]);
    a.cancel();
    b.cancel();
    await tick();
  });

  it("the source lives while any tap does, and ends with the last", async () => {
    const { feeds } = declareFeed<string>("bd-life");
    const a = tap(await handleServerFunctionRequest(get("bd-life", ["k"])));
    const b = tap(await handleServerFunctionRequest(get("bd-life", ["k"])));
    await tick();
    const feed = feeds.get("k")!;
    feed.push("first");
    await tick();
    a.cancel();
    await tick();
    expect(feed.state.returned).toBe(false);
    feed.push("still here");
    await tick();
    expect(b.values).toEqual(["first", "still here"]);
    b.cancel();
    await tick();
    expect(feed.state.returned).toBe(true);
    // The next caller starts a fresh source.
    feeds.delete("k");
    const c = tap(await handleServerFunctionRequest(get("bd-life", ["k"])));
    await tick();
    feeds.get("k")!.push("again");
    await tick();
    expect(feeds.get("k")!.state.started).toBe(1);
    expect(c.values).toEqual(["again"]);
    c.cancel();
    await tick();
  });

  it("the shared source runs under its own event, not a viewer's request", async () => {
    const seen: unknown[] = [];
    broadcast(
      createServerReference(
        registerServerReference("bd-event", async function* () {
          const event: any = getRequestEvent();
          seen.push(event && event.broadcast, event && event.request);
          yield 1;
        })
      )
    );
    const a = tap(await handleServerFunctionRequest(get("bd-event", [])));
    await tick();
    expect(seen).toEqual([true, undefined]);
    expect(a.values).toEqual([1]);
    a.cancel();
    await tick();
  });
});
