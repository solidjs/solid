/**
 * @jsxImportSource @solidjs/web
 *
 * Stage 8 B2 — a frame stream answered at the live address (RFC 10 `live(fn)`
 * → Framing; RFC 11 §9.5 Wire). `frameTransformResult` frames the server
 * component's chunks as server-sent events when the invocation arrived at
 * the live address — the same framing, headers, idle heartbeat and dev chaos
 * knob the codec stream gets there — so the `live` loop reads a frame stream
 * through the reader it already has. The data address is untouched; the
 * chunk protocol is the same on both.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createMemo } from "solid-js";
import { frameTransformResult, serverComponentResponse } from "../../frames/src/frame-sink.js";
import {
  configureServerFunctionsServer,
  getServerFunctionInvocation,
  handleServerFunctionRequest,
  registerServerFunction,
  setServerFunctionsDev
} from "../../server-functions/src/server.js";
import { ChunkReader, EventStreamReader } from "../../server-functions/src/shared.js";

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms));

/** A standing source: yields once, then parks until returned. */
function standing() {
  const state = { pulls: 0, returned: false, wake: null as null | (() => void) };
  const source = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<string>> {
          state.pulls++;
          if (state.pulls === 1) return { value: "first", done: false };
          await new Promise<void>(r => (state.wake = r));
          return { value: undefined as any, done: true };
        },
        async return(): Promise<IteratorResult<string>> {
          state.returned = true;
          state.wake?.();
          return { value: undefined as any, done: true };
        }
      };
    }
  } as AsyncIterable<string>;
  return { source, state };
}

function componentOver(source: AsyncIterable<string>) {
  return () => {
    const value = createMemo(() => source);
    return <p>{value()}</p>;
  };
}

const post = (address: "live" | "data", id: string, init: RequestInit = {}) =>
  new Request(`http://localhost/_server/${address}/${id}`, {
    method: "POST",
    headers: {
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "text/plain",
      "X-Server-Function-Format": "1"
    },
    body: "[]",
    ...init
  });

/** Every chunk of a frame body, read with the reader the content type selects. */
async function chunksOf(response: Response) {
  const live = (response.headers.get("Content-Type") || "").startsWith("text/event-stream");
  const reader: any = live
    ? new (EventStreamReader as any)(response.body, {})
    : new ChunkReader(response.body!);
  const out: any[] = [];
  await reader.drain((data: string) => out.push(JSON.parse(data)));
  return out;
}

const handle = (request: Request) =>
  handleServerFunctionRequest(request, { transformResult: frameTransformResult });

const RequestContext = Symbol.for("solid.RequestContext");
beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});
afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

afterEach(() => {
  configureServerFunctionsServer({ chaosReconnectEvery: 0 });
  setServerFunctionsDev(false);
});

describe("a frame stream at the live address (Stage 8 B2)", () => {
  it("frames the chunks as server-sent events with the live headers; the data address is unchanged", async () => {
    let seen: any[] = [];
    registerServerFunction("live-frame-0", async () => {
      seen.push(getServerFunctionInvocation());
      return () => <p>hello</p>;
    });

    const live = await handle(post("live", "live-frame-0"));
    expect(live.status).toBe(200);
    expect(live.headers.get("X-Frame-Stream")).toBe("live-frame-0");
    expect(live.headers.get("Content-Type")).toBe("text/event-stream");
    expect(live.headers.get("Cache-Control")).toBe("no-store");
    expect(live.headers.get("X-Accel-Buffering")).toBe("no");
    // The invocation knows which address it arrived at.
    expect(seen).toEqual([{ id: "live-frame-0", live: true }]);
    const liveText = await live.clone().text();
    expect(liveText).toMatch(/^data: \{/);
    expect(liveText).not.toMatch(/;0x[0-9a-f]{8};/);
    const liveChunks = await chunksOf(live);
    expect(liveChunks.map(c => c.type)).toEqual(["start", "html", "complete"]);
    expect(liveChunks[1].html).toContain("hello");

    const data = await handle(post("data", "live-frame-0"));
    expect(data.headers.get("X-Frame-Stream")).toBe("live-frame-0");
    expect(data.headers.get("Content-Type")).toBe("application/x-frame-stream");
    expect(data.headers.get("X-Accel-Buffering")).toBeNull();
    expect(seen[1]).toEqual({ id: "live-frame-0", live: false });
    const dataText = await data.clone().text();
    expect(dataText).toMatch(/^;0x[0-9a-f]{8};\{/);
    expect(dataText).not.toContain("data: ");
    // Same records either way.
    const dataChunks = await chunksOf(data);
    expect(dataChunks.map(c => c.type)).toEqual(liveChunks.map(c => c.type));
    expect(dataChunks[1].html).toBe(liveChunks[1].html);
  });

  it("a standing component's response stays open without a complete, and writes the heartbeat while idle", async () => {
    const { source, state } = standing();
    const response = serverComponentResponse(componentOver(source), {
      frame: { id: "f0" },
      live: true
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("first")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("body ended early");
      text += decoder.decode(value, { stream: true });
    }
    expect(text).toContain('data: {"type":"start"');
    expect(text).not.toContain('"complete"');
    // Idle: nothing but the heartbeat is written.
    const next = reader.read();
    const outcome = await Promise.race([next, tick(50).then(() => "idle")]);
    expect(outcome).toBe("idle");
    // Cancelling tears the render down (B1), through the live framing too.
    await reader.cancel();
    await tick();
    expect(state.returned).toBe(true);
  });

  it("the dev chaos knob ends a live frame response as a dying connection: the render is torn down and the body errors before complete", async () => {
    setServerFunctionsDev(true);
    configureServerFunctionsServer({ chaosReconnectEvery: 30 });
    const { source, state } = standing();
    registerServerFunction("live-frame-chaos", async () => componentOver(source));
    const response = await handle(post("live", "live-frame-chaos"));
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    let text = "";
    let failure: unknown;
    try {
      for (let r = await reader.read(); !r.done; r = await reader.read()) {
        text += new TextDecoder().decode(r.value);
      }
    } catch (error) {
      failure = error;
    }
    expect(text).toContain("first");
    expect(text).not.toContain('"complete"');
    expect(String((failure as Error).message)).toContain("chaos");
    await tick();
    expect(state.returned).toBe(true);
  });

  it("a resume's have-list header makes the live render conditional; the data address ignores it (B4)", async () => {
    registerServerFunction("live-frame-resume", async () => {
      const title = createMemo(() => "steady");
      return () => <h1>{title()}</h1>;
    });
    const first = await chunksOf(await handle(post("live", "live-frame-resume")));
    expect(first.map(c => c.type)).toEqual(["start", "html", "complete"]);
    const root = first[1];
    expect(root.digest).toMatch(/^[0-9a-f]{16}$/);
    expect(root.holes).toEqual({ "lh:0": expect.stringMatching(/^[0-9a-f]{16}$/) });
    // The client's ledger after that stream, as the loop sends it back.
    const have = `=${root.digest},lh:0=${root.holes["lh:0"]}`;
    const resumed = await chunksOf(
      await handle(
        post("live", "live-frame-resume", {
          headers: {
            "Sec-Fetch-Site": "same-origin",
            "Content-Type": "text/plain",
            "X-Server-Function-Format": "1",
            "Last-Event-ID": "1",
            "X-Frame-Have": have
          }
        })
      )
    );
    expect(resumed.map(c => c.type)).toEqual(["start", "complete"]);
    // The header is a live-address contract: a plain read renders whole.
    const data = await chunksOf(
      await handle(
        post("data", "live-frame-resume", {
          headers: {
            "Sec-Fetch-Site": "same-origin",
            "Content-Type": "text/plain",
            "X-Server-Function-Format": "1",
            "X-Frame-Have": have
          }
        })
      )
    );
    expect(data.map(c => c.type)).toEqual(["start", "html", "complete"]);
  });

  it("the knob is inert outside the dev build", async () => {
    configureServerFunctionsServer({ chaosReconnectEvery: 10 });
    registerServerFunction("live-frame-no-chaos", async () => () => <p>steady</p>);
    const response = await handle(post("live", "live-frame-no-chaos"));
    const chunks = await chunksOf(response);
    expect(chunks.map(c => c.type)).toEqual(["start", "html", "complete"]);
  });
});
