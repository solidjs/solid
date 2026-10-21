/** @vitest-environment node */
import { afterEach, describe, expect, test } from "vitest";
import { createMemo, createRoot, from, NotReadyError } from "../../src/server/index.js";
import { sharedConfig } from "../../src/server/shared.js";

const tick = () => new Promise<void>(r => setTimeout(r, 0));
const LIVE_SOURCE = Symbol.for("solid.LiveSource");

function source<T>(log: string[], initial?: { value: T }) {
  let next: ((v: T) => void) | null = null;
  const subscribe = (n: (v: T) => void) => {
    log.push("open");
    next = n;
    if (initial) n(initial.value);
    return () => {
      log.push("close");
      next = null;
    };
  };
  return Object.assign(subscribe, { emit: (v: T) => next?.(v) });
}

/** A hand-written stream: yields `v1`, `v2`, … as `land()` is called. */
function stream(log: string[]) {
  const lands: Array<(r: IteratorResult<string>) => void> = [];
  let n = 0;
  return {
    land: () => lands.shift()?.({ value: `v${++n}`, done: false }),
    [Symbol.asyncIterator](): AsyncIterator<string> {
      log.push("open");
      return {
        next: () => new Promise(resolve => lands.push(resolve)),
        return: () => {
          log.push("close");
          return Promise.resolve({ value: undefined, done: true });
        }
      };
    }
  };
}

/** A streaming render's context (`async` + `serialize`), as renderToStream sets. */
function streamingContext(async = true) {
  const serialized: Array<{ id: string; value: any }> = [];
  sharedConfig.context = {
    async,
    serialize: (id: string, value: any) => void serialized.push({ id, value })
  } as any;
  return serialized;
}

afterEach(() => {
  sharedConfig.context = undefined;
});

// The server `from` is the client's stream; the per-ssrSource machinery
// decides how much of it the server consumes. A subscription is branded live
// (a standing answer), so the server takes its first value and closes it
// rather than serializing a stream that might never end.
describe("server from: a subscription per ssrSource", () => {
  for (const ssrSource of [undefined, "server", "hybrid"] as const) {
    test(`ssrSource ${ssrSource ?? "(default)"}: renders the first value, serializes it, and unsubscribes`, async () => {
      const serialized = streamingContext();
      const log: string[] = [];
      const src = source(log, { value: 5 });
      let read!: () => number;
      let dispose!: () => void;
      createRoot(
        d => {
          dispose = d;
          read = createMemo(() => from<number>(src), ssrSource ? { ssrSource } : undefined);
        },
        { id: "t" }
      );
      expect(() => read()).toThrow(NotReadyError);
      await tick();
      expect(read()).toBe(5);
      // Released once the server has its value, before the render ends.
      expect(log).toEqual(["open", "close"]);
      src.emit(6);
      await tick();
      expect(read()).toBe(5);
      // One value on the wire, not a stream.
      expect(serialized).toHaveLength(1);
      expect(typeof serialized[0].value?.[Symbol.asyncIterator]).not.toBe("function");
      expect(await serialized[0].value).toBe(5);
      dispose();
      expect(log).toEqual(["open", "close"]);
    });
  }

  test('ssrSource "client": the compute never runs, so nothing subscribes', () => {
    const serialized = streamingContext();
    const log: string[] = [];
    let read!: () => number;
    createRoot(
      () => {
        read = createMemo(() => from<number>(source(log, { value: 5 })), { ssrSource: "client" });
      },
      { id: "t" }
    );
    // A bare client source read outside <Loading> is a render error
    // (ASYNC_OUTSIDE_LOADING_BOUNDARY); under a boundary it hands off.
    expect(() => read()).toThrow(/ASYNC_OUTSIDE_LOADING_BOUNDARY/);
    expect(log).toEqual([]);
    expect(serialized).toEqual([]);
  });

  test("a non-streaming render (renderToString) takes the first value and unsubscribes", async () => {
    const serialized = streamingContext(false);
    const log: string[] = [];
    let read!: () => number;
    createRoot(
      () => {
        read = createMemo(() => from<number>(source(log, { value: 5 })));
      },
      { id: "t" }
    );
    await tick();
    expect(read()).toBe(5);
    expect(log).toEqual(["open", "close"]);
    expect(serialized).toEqual([]);
  });

  test("a source that never emits is released when the render is disposed", async () => {
    streamingContext();
    const log: string[] = [];
    let read!: () => number;
    createRoot(
      dispose => {
        read = createMemo(() => from<number>(source(log)));
        queueMicrotask(dispose);
      },
      { id: "t" }
    );
    expect(() => read()).toThrow(NotReadyError);
    await tick();
    expect(log).toEqual(["open", "close"]);
  });
});

describe("server from: an AsyncIterable streams like any other", () => {
  test("default mode serializes the stream; the server's return() closes the source", async () => {
    const serialized = streamingContext();
    const log: string[] = [];
    const src = stream(log);
    let read!: () => string;
    createRoot(
      () => {
        read = createMemo(() => from(src));
      },
      { id: "t" }
    );
    src.land();
    await tick();
    expect(read()).toBe("v1");
    expect(serialized).toHaveLength(1);
    // The serializer's channel: the first value, then the rest of the stream.
    const channel = serialized[0].value as AsyncIterable<string>;
    const it = channel[Symbol.asyncIterator]();
    expect(await it.next()).toEqual({ value: "v1", done: false });
    const second = it.next();
    src.land();
    expect(await second).toEqual({ value: "v2", done: false });
    expect(log).toEqual(["open"]);
    // The server stops consuming (the render ends, the client disconnects).
    await it.return!();
    expect(log).toEqual(["open", "close"]);
  });

  test("owner disposal closes a stream nobody is pulling", async () => {
    streamingContext();
    const log: string[] = [];
    const src = stream(log);
    let dispose!: () => void;
    createRoot(
      d => {
        dispose = d;
        createMemo(() => from(src));
      },
      { id: "t" }
    );
    src.land();
    await tick();
    expect(log).toEqual(["open"]);
    dispose();
    expect(log).toEqual(["open", "close"]);
  });

  test("a live-branded source passes through; subscriptions are branded, streams are not", () => {
    const live = {
      [LIVE_SOURCE]: true,
      [Symbol.asyncIterator]: () => ({}) as AsyncIterator<number>
    };
    expect(from(live)).toBe(live);
    expect((from(() => () => {}) as any)[LIVE_SOURCE]).toBe(true);
    expect((from({ subscribe: () => ({ unsubscribe() {} }) }) as any)[LIVE_SOURCE]).toBe(true);
    expect((from(stream([])) as any)[LIVE_SOURCE]).toBeUndefined();
  });
});
