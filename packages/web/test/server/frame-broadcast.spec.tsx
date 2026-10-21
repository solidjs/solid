/**
 * @jsxImportSource @solidjs/web
 *
 * `broadcast(fn)`: a live server component whose answer is the same for
 * every viewer. At the live address, callers with the same arguments share
 * ONE render — each is a tap on it. The outer body still runs per call; a
 * viewer that joins later gets the frame as it stands, then the shared
 * batches; the render ends with its last tap; and it runs under its own
 * event, not any viewer's request.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMemo, onCleanup } from "solid-js";
import { getRequestEvent } from "../../src/server.js";
import { frameTransformResult } from "../../frames/src/frame-sink.js";
import {
  broadcast,
  createServerReference,
  getServerFunctionMetadata,
  handleServerFunctionRequest,
  registerServerReference
} from "../../server-functions/src/server.js";

const RequestContext = Symbol.for("solid.RequestContext");
beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});
afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const tick = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

const handle = (request: Request) =>
  handleServerFunctionRequest(request, { transformResult: frameTransformResult });

const get = (id: string, args: unknown[]) =>
  new Request(
    `http://localhost/_server/live/${id}?args=${encodeURIComponent(JSON.stringify(args))}`,
    { method: "GET" }
  );

/** A source the test drives: each `push` is the next yield. */
function channel() {
  const state = { returned: false, values: [] as string[], wake: null as null | (() => void) };
  const source: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          while (!state.values.length && !state.returned)
            await new Promise<void>(r => (state.wake = r));
          if (state.returned) return { value: undefined as any, done: true };
          return { value: state.values.shift()!, done: false };
        },
        async return() {
          state.returned = true;
          state.wake?.();
          return { value: undefined as any, done: true };
        }
      };
    }
  };
  const push = (value: string) => {
    state.values.push(value);
    state.wake?.();
  };
  return { source, state, push };
}

/** A tap's messages as they arrive, and its cancel. */
function tap(response: Response) {
  const messages: any[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  (async () => {
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const event = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = event
          .split("\n")
          .filter(l => l.startsWith("data: "))
          .map(l => l.slice(6))
          .join("\n");
        if (data) messages.push(JSON.parse(data));
      }
    }
  })();
  return { messages, cancel: () => reader.cancel() };
}

/** What a tap has been sent, as text: enough to ask "does it show X". */
const sent = (t: { messages: any[] }) => JSON.stringify(t.messages);

function declareRoom(id: string) {
  const calls: any[] = [];
  const renders: string[] = [];
  const rooms = new Map<string, ReturnType<typeof channel>>();
  const ref = broadcast(
    createServerReference(
      registerServerReference(id, async (room: string) => {
        calls.push(getRequestEvent()?.request?.url);
        return () => {
          renders.push(room);
          const ch = channel();
          rooms.set(room, ch);
          onCleanup(() => ch.source[Symbol.asyncIterator]().return!());
          const value = createMemo(() => ch.source);
          return <p class="room">{value()}</p>;
        };
      })
    )
  );
  return { ref, calls, renders, rooms };
}

describe("broadcast server components", () => {
  it("declares live and GET", () => {
    const { ref } = declareRoom("bc-declare");
    const meta: any = getServerFunctionMetadata(ref);
    expect(meta.live).toBe(true);
    expect(meta.method).toBe("GET");
    expect(meta.broadcast).toBe(true);
  });

  it("callers with the same arguments share one render; the outer body runs per call", async () => {
    const { calls, renders, rooms } = declareRoom("bc-share");
    const a = tap(await handle(get("bc-share", ["lobby"])));
    await tick();
    rooms.get("lobby")!.push("one");
    await tick();
    const b = tap(await handle(get("bc-share", ["lobby"])));
    await tick();
    expect(calls).toHaveLength(2);
    expect(renders).toEqual(["lobby"]);
    expect(sent(a)).toContain("one");
    // The late joiner's snapshot already shows what the frame shows now.
    expect(b.messages[0].type).toBe("start");
    expect(sent(b)).toContain("one");

    rooms.get("lobby")!.push("two");
    await tick();
    expect(sent(a)).toContain("two");
    expect(sent(b)).toContain("two");
    a.cancel();
    b.cancel();
    await tick();
  });

  it("different arguments render separately", async () => {
    const { renders } = declareRoom("bc-args");
    const a = tap(await handle(get("bc-args", ["red"])));
    const b = tap(await handle(get("bc-args", ["blue"])));
    await tick();
    expect(renders.sort()).toEqual(["blue", "red"]);
    a.cancel();
    b.cancel();
    await tick();
  });

  it("the render lives while any tap does, and ends with the last", async () => {
    const { renders, rooms } = declareRoom("bc-life");
    const a = tap(await handle(get("bc-life", ["x"])));
    const b = tap(await handle(get("bc-life", ["x"])));
    await tick();
    const ch = rooms.get("x")!;
    a.cancel();
    await tick();
    expect(ch.state.returned).toBe(false);
    ch.push("still here");
    await tick();
    expect(sent(b)).toContain("still here");
    b.cancel();
    await tick();
    expect(ch.state.returned).toBe(true);
    // The next caller starts a fresh render.
    const c = tap(await handle(get("bc-life", ["x"])));
    await tick();
    expect(renders).toEqual(["x", "x"]);
    c.cancel();
    await tick();
  });

  it("the shared render runs under its own event, not a viewer's request", async () => {
    const seen: unknown[] = [];
    broadcast(
      createServerReference(
        registerServerReference("bc-event", async () => {
          seen.push(getRequestEvent()?.request?.url);
          return () => {
            const event: any = getRequestEvent();
            seen.push(event && event.broadcast, event && event.request);
            return <p>hi</p>;
          };
        })
      )
    );
    const a = tap(await handle(get("bc-event", [])));
    await tick();
    expect(seen[0]).toContain("/_server/live/bc-event");
    expect(seen.slice(1)).toEqual([true, undefined]);
    a.cancel();
    await tick();
  });
});
