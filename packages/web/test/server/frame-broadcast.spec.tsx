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

const get = (id: string, args: unknown[], headers: HeadersInit = {}) =>
  new Request(
    `http://localhost/_server/live/${id}?args=${encodeURIComponent(JSON.stringify(args))}`,
    { method: "GET", headers }
  );

/** The have-list a client holding `messages` would send: root skeleton + hole digests. */
function haveOf(messages: any[]) {
  const have: Record<string, string> = {};
  for (const m of messages)
    for (const k in m.r || {}) {
      const record = m.r[k];
      if (k === "") for (const key in have) delete have[key];
      if (k === "") have[""] = record.digest;
      if (k.startsWith("hole:lh:") && !k.endsWith(":error")) have[k.slice(5)] = record.digest;
      if (k.startsWith("attr:")) have["lha:" + k.slice(5)] = record.digest;
      for (const key in record.holes || {}) have[key] = record.holes[key];
    }
  return Object.entries(have)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
}

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

  it("a reconnect whose skeleton matches gets only the holes that moved", async () => {
    const { rooms } = declareRoom("bc-resume");
    const a = tap(await handle(get("bc-resume", ["r"])));
    await tick();
    rooms.get("r")!.push("one");
    await tick();
    const have = haveOf(a.messages);
    // Same view: nothing owed but the start.
    const same = tap(await handle(get("bc-resume", ["r"], { "X-Frame-Have": have })));
    await tick();
    expect(same.messages.map(m => m.type || Object.keys(m.r))).toEqual(["start"]);
    // One value behind: only the hole, never the root.
    rooms.get("r")!.push("two");
    await tick();
    const behind = tap(await handle(get("bc-resume", ["r"], { "X-Frame-Have": have })));
    await tick();
    const keys = behind.messages.flatMap(m => (m.r ? Object.keys(m.r) : []));
    expect(keys).not.toContain("");
    expect(keys.some(k => k.startsWith("hole:lh:"))).toBe(true);
    expect(sent(behind)).toContain("two");
    for (const t of [a, same, behind]) t.cancel();
    await tick();
  });

  it("a joiner gets the data its slot records read, not every superseded version", async () => {
    let ch: ReturnType<typeof channel>;
    broadcast(
      createServerReference(
        registerServerReference("bc-slots", async () => {
          return (props: any) => {
            ch = channel();
            const value = createMemo(() => ch.source);
            return <div>{props.item({ data: { label: value() } })}</div>;
          };
        })
      )
    );
    const a = tap(await handle(get("bc-slots", [])));
    await tick();
    for (let i = 0; i < 100; i++) {
      ch!.push("v" + i);
      await tick(1);
    }
    await tick();
    expect(sent(a)).toContain("v99");
    // The first viewer was sent every version.
    expect(a.messages.filter(m => m.type === "data").length).toBeGreaterThan(50);
    const b = tap(await handle(get("bc-slots", [])));
    await tick();
    const data = b.messages.filter(m => m.type === "data");
    expect(data.length).toBeLessThanOrEqual(2);
    expect(JSON.stringify(data)).toContain("v99");
    a.cancel();
    b.cancel();
    await tick();
  });

  it("a reconnect gets a dynamic attribute that moved, without the root", async () => {
    let ch: ReturnType<typeof channel>;
    broadcast(
      createServerReference(
        registerServerReference("bc-attrs", async () => {
          return () => {
            ch = channel();
            const value = createMemo(() => ch.source);
            return (
              <div>
                <a href={"/" + value()}>link</a>
              </div>
            );
          };
        })
      )
    );
    const a = tap(await handle(get("bc-attrs", [])));
    await tick();
    ch!.push("one");
    await tick();
    const have = haveOf(a.messages);
    ch!.push("two");
    await tick();
    expect(sent(a)).toContain("two");
    const b = tap(await handle(get("bc-attrs", [], { "X-Frame-Have": have })));
    await tick();
    const keys = b.messages.flatMap(m => (m.r ? Object.keys(m.r) : []));
    expect(keys).not.toContain("");
    expect(sent(b)).toContain("two");
    a.cancel();
    b.cancel();
    await tick();
  });
});
