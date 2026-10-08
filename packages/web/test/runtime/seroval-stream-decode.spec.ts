/**
 * Streams decoded through the JSON codec. Since seroval 1.6.8,
 * `fromCrossJSON` mints its internal stream class, which carries no
 * `__SEROVAL_STREAM__` tag; the decoder must still track those streams so
 * `open()` counts them and `abort()` / `close()` end them when the body ends.
 */
import { describe, expect, it } from "vitest";
import { createStream } from "seroval";
import { serializeJSON } from "../../serialization/src/serializer.js";
import { createJSONDeserializer } from "../../serialization/src/serializer-decode.js";
import { isContainerTraceMarker } from "../../frames/src/frame-container-plugin.js";

async function encode(value: unknown) {
  const nodes: unknown[] = [];
  serializeJSON(value, {
    onParse: node => nodes.push(node),
    onDone() {},
    onError() {}
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  return nodes;
}

async function decodeAll(value: unknown) {
  const nodes = await encode(value);
  // `open` / `abort` / `close` are internal to the server-function transport.
  const decode: any = createJSONDeserializer();
  const decoded: any = decode(nodes[0] as any);
  for (let i = 1; i < nodes.length; i++) decode(nodes[i] as any);
  return { decode, decoded };
}

function record(stream: any) {
  const events: unknown[] = [];
  stream.on({
    next: (value: unknown) => events.push(["next", value]),
    throw: (error: any) => events.push(["throw", error?.message]),
    return: () => events.push(["return"])
  });
  return events;
}

function settledWithin<T>(promise: Promise<T>, ms = 500) {
  return Promise.race([
    promise.then(
      value => ({ status: "fulfilled" as const, value }),
      reason => ({ status: "rejected" as const, reason })
    ),
    new Promise<{ status: "pending" }>(resolve =>
      setTimeout(() => resolve({ status: "pending" }), ms)
    )
  ]);
}

describe("JSON codec: decoded seroval streams", () => {
  it("counts an open stream and errors it on abort", async () => {
    const source = createStream<number>();
    source.next(1);
    const { decode, decoded } = await decodeAll({ stream: source });

    expect(decode.open()).toBe(1);
    const events = record(decoded.stream);
    decode.abort(new Error("body ended"));

    expect(events).toEqual([
      ["next", 1],
      ["throw", "body ended"]
    ]);
    expect(decode.open()).toBe(0);
  });

  it("completes an open stream on close", async () => {
    const source = createStream<number>();
    source.next(1);
    const { decode, decoded } = await decodeAll({ stream: source });

    const events = record(decoded.stream);
    decode.close();

    expect(events).toEqual([["next", 1], ["return"]]);
    expect(decode.open()).toBe(0);
  });

  it("rejects a pending async iterator read on abort instead of hanging", async () => {
    async function* source() {
      yield "first";
      await new Promise(() => {});
    }
    const { decode, decoded } = await decodeAll({ items: source() });

    const iterator = decoded.items[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ done: false, value: "first" });
    const pending = iterator.next();
    decode.abort(new Error("body ended"));

    const result = await settledWithin(pending);
    expect(result.status).toBe("rejected");
    expect((result as any).reason?.message).toBe("body ended");
  });

  it("recognizes a container trace carried by an untagged seroval stream", () => {
    const stream = createStream<unknown>();
    expect("__SEROVAL_STREAM__" in stream).toBe(false);
    expect(isContainerTraceMarker({ $tr: stream, $ta: 0 })).toBe(true);
    expect(isContainerTraceMarker({ $tr: { on() {} }, $ta: 0 })).toBe(true);
    expect(isContainerTraceMarker({ $tr: {}, $ta: 0 })).toBe(false);
  });
});
