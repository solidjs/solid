// Shared harness for the lifecycle-matrix suite. Mirrors the vocabulary of
// test/frames-client.spec.tsx: a fresh frame host per test (rotating JSON
// data table), hand-framed frame-stream Responses behind a stubbed fetch,
// and the REAL server-function stub → transport → component pipeline under
// test via installServerComponents().
import { flush } from "solid-js";
import { createFrameHost } from "../../frames/src/client.js";
// The API-freeze pass removed the frames re-export; the codec's single
// public home is the serialization entry.
import { createJSONDataTable } from "@dom-expressions/runtime/src/serializer.js";
import { createChunk } from "@dom-expressions/runtime/src/server-functions/shared.js";
import { createJSONSerializer } from "@dom-expressions/runtime/src/serializer.js";

export const settle = () => new Promise(r => setTimeout(r));

/** flush + macrotask, twice by default — the beat the existing specs use to
 *  let a response resolve, mount, and stream-apply. */
export async function pump(times = 2) {
  for (let i = 0; i < times; i++) {
    flush();
    await settle();
  }
}

export function makeHost(hostOptions: Record<string, any> = {}) {
  const table = createJSONDataTable();
  const host = createFrameHost({
    applyData: (c: any) => table.apply(c),
    resolve: (ref: any) => table.resolve(ref),
    ...hostOptions
  });
  return { host, table };
}

/** A complete one-shot frame-stream Response (every chunk enqueued, closed). */
export function frameResponse(id: string, chunks: any[]) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(createChunk(JSON.stringify(chunk)));
      controller.close();
    }
  });
  return new Response(body, { headers: { "X-Frame-Stream": id } });
}

/**
 * A HELD frame-stream Response: the headers resolve the call immediately
 * (so the transport hands `dynamic` its binding), while the body stays open
 * for the test to feed chunk by chunk — the shape of a slow server whose
 * first content byte trails the response head.
 */
export function openFrameResponse(id: string) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    }
  });
  return {
    response: new Response(body, { headers: { "X-Frame-Stream": id } }),
    send(chunk: any) {
      controller.enqueue(createChunk(JSON.stringify(chunk)));
    },
    close() {
      controller.close();
    },
    abort(err: any) {
      controller.error(err);
    }
  };
}

/**
 * Serialize values through the REAL JSON codec into `data` chunk shapes.
 * Sync values settle inside the call; async values (promises, async
 * iterables) keep pushing patch records through `onRecord` as they settle —
 * feed those into a held response (or host.apply them) to model the
 * producer's trailing data chunks.
 *
 * NOTE: one serializer instance per DESERIALIZER table. The codec's
 * cross-reference space is stream-scoped: the real client rotates a fresh
 * table per response, while this harness's host holds ONE table per test —
 * so a test that streams data in several batches must thread the same
 * `createDataSource()` through all of them or ref ids collide.
 */
export function createDataSource() {
  let sink: (chunk: any) => void = () => {};
  let frameId = "";
  let version = 1;
  const serializer = createJSONSerializer({
    onData: (record: any) => sink({ type: "data", id: frameId, version, ...record })
  });
  return {
    chunks(
      id: string,
      v: number,
      values: Record<string, unknown>,
      onRecord?: (chunk: any) => void
    ) {
      const initial: any[] = [];
      frameId = id;
      version = v;
      sink = c => initial.push(c);
      for (const key of Object.keys(values)) serializer.write(key, values[key]);
      // Async settlements (promise resolutions, iterable yields) keep coming
      // through the serializer after this batch: route them to the caller.
      sink = onRecord ?? (() => {});
      return initial;
    }
  };
}

/** One-shot form of `createDataSource` for tests with a single data batch. */
export function dataChunks(
  frameId: string,
  version: number,
  values: Record<string, unknown>,
  onRecord?: (chunk: any) => void
) {
  return createDataSource().chunks(frameId, version, values, onRecord);
}
