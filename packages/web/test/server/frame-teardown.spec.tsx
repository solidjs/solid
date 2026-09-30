/**
 * @jsxImportSource @solidjs/web
 *
 * Stage 8 B1 — teardown on disconnect. A frame render lives as long as
 * someone reads its response: the body's `cancel()` (the client left) and the
 * request's abort (the host saw the socket close) both tear the render down
 * through `renderToStream`'s disconnect path, so a standing source the render
 * pumps is `return()`ed now — not when it next yields — and the render stops
 * producing for nobody. Before this, `cancel()` only dropped writes and the
 * render ran until its sources happened to end.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OBSERVE, createMemo } from "solid-js";
import {
  frameTransformFlightResult,
  frameTransformResult,
  serverComponentResponse
} from "../../frames/src/frame-sink.js";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "../../server-functions/src/server.js";

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

async function readUntil(body: ReadableStream<Uint8Array>, needle: string) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes(needle)) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`body ended before ${JSON.stringify(needle)}: ${text}`);
    text += decoder.decode(value, { stream: true });
  }
  return { reader, text };
}

const post = (id: string, signal: AbortSignal, body = "[]") =>
  new Request(`http://localhost/_server/data/${id}`, {
    method: "POST",
    headers: {
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "text/plain",
      "X-Server-Function-Format": "1"
    },
    body,
    signal
  });

let capture: ReturnType<NonNullable<typeof OBSERVE>["diagnostics"]["capture"]>;
beforeEach(() => {
  capture = OBSERVE!.diagnostics.capture();
});
afterEach(() => {
  capture.stop();
});

describe("frame teardown on disconnect (Stage 8 B1)", () => {
  it("cancelling the response body returns the standing source and records the abandonment", async () => {
    const { source, state } = standing();
    const response = serverComponentResponse(componentOver(source), { frame: { id: "f0" } });
    const { reader } = await readUntil(response.body!, "first");
    expect(state.returned).toBe(false);

    await reader.cancel();
    await tick();
    expect(state.returned).toBe(true);
    const abandoned = capture.events.filter(e => e.code === "SSR_STREAM_ABANDONED");
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0].data!.reason).toBe("signal");
  });

  it("the request's abort tears the render down and ends the body", async () => {
    const { source, state } = standing();
    const controller = new AbortController();
    const response = serverComponentResponse(componentOver(source), {
      frame: { id: "f0" },
      signal: controller.signal
    });
    const { reader } = await readUntil(response.body!, "first");

    controller.abort();
    await tick();
    expect(state.returned).toBe(true);
    // Nobody ends a torn-down render's sink; the response closes itself.
    const { done } = await reader.read();
    expect(done).toBe(true);
  });

  it("a request already aborted renders for nobody: torn down at once", async () => {
    const { source, state } = standing();
    const controller = new AbortController();
    controller.abort();
    const response = serverComponentResponse(componentOver(source), {
      frame: { id: "f0" },
      signal: controller.signal
    });
    const reader = response.body!.getReader();
    let text = "";
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      text += new TextDecoder().decode(r.value);
    }
    await tick();
    expect(state.returned).toBe(state.pulls > 0);
    expect(text).not.toContain('"complete"');
  });

  it("through the handler: frameTransformResult passes the request's signal", async () => {
    const { source, state } = standing();
    registerServerFunction("teardown-frame", async () => componentOver(source));
    const controller = new AbortController();
    const response = await handleServerFunctionRequest(post("teardown-frame", controller.signal), {
      transformResult: frameTransformResult,
      provideEvent: (_e: any, fn: any) => fn()
    });
    expect(response.headers.get("X-Frame-Stream")).toBe("teardown-frame");
    await readUntil(response.body!, "first");

    controller.abort();
    await tick();
    expect(state.returned).toBe(true);
  });

  it("a flight response stops at the frame in progress and skips the rest", async () => {
    const first = standing();
    const second = standing();
    const controller = new AbortController();
    const request = post("teardown-flight", controller.signal);
    const response = await frameTransformFlightResult(
      { request } as any,
      {
        value: componentOver(first.source),
        data: { true: { other: componentOver(second.source) } }
      },
      undefined
    );
    expect(response).toBeInstanceOf(Response);
    const { reader } = await readUntil(response!.body!, "first");

    controller.abort();
    await tick();
    expect(first.state.returned).toBe(true);
    // The second frame never started: its source was never pulled.
    expect(second.state.pulls).toBe(0);
    const { done } = await reader.read();
    expect(done).toBe(true);
  });
});
