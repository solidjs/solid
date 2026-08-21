/** @vitest-environment jsdom */
// materializeContainerTrace: the client half of the container tier at the
// slot border. A server projection crosses as its TRACE — an async iterable
// whose first yield is a full state snapshot and whose later yields are
// PatchOp batches — and materializes into a live local projection: reads
// are not-ready until the snapshot lands, then a read-only store the
// batches keep updating, latched when the trace ends.
import { describe, expect, test } from "vitest";
import { createRoot, createRenderEffect, flush } from "../src/index.js";
import { materializeContainerTrace } from "../src/index.js";

/**
 * A hand-cranked RAW seroval stream (the wire shape since the stream-mint
 * protocol): buffered emissions replay SYNCHRONOUSLY at subscribe, live
 * emissions flush to subscribers as they land.
 */
function makeStream() {
  const buffer: { mode: "next" | "return" | "throw"; value: any }[] = [];
  const listeners: any[] = [];
  const emit = (mode: "next" | "return" | "throw", value?: any) => {
    buffer.push({ mode, value });
    for (const l of listeners) l[mode]?.(value);
  };
  const stream = {
    __SEROVAL_STREAM__: true,
    on(listener: any) {
      listeners.push(listener);
      for (const e of buffer) listener[e.mode]?.(e.value);
    },
    next: (v: any) => emit("next", v),
    return: (v?: any) => emit("return", v),
    throw: (v: any) => emit("throw", v)
  };
  return stream;
}

/** A hand-cranked trace: push yields, then end. */
function makeTrace() {
  const queue: { resolve: (r: IteratorResult<any>) => void }[] = [];
  const buffered: IteratorResult<any>[] = [];
  const iterable = {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<IteratorResult<any>>(resolve => {
          const b = buffered.shift();
          if (b) return resolve(b);
          queue.push({ resolve });
        })
    })
  };
  const push = (value: any, done = false) => {
    const r = done ? { done: true as const, value: undefined } : { done: false as const, value };
    const w = queue.shift();
    w ? w.resolve(r) : buffered.push(r);
  };
  return { iterable, push };
}

const tick = () => new Promise(r => setTimeout(r, 0));

describe("materializeContainerTrace", () => {
  test("suspends until the snapshot, then live through patch batches", async () => {
    const { iterable, push } = makeTrace();
    const store: any = materializeContainerTrace({ $tr: iterable, $ta: 0 });

    const reads: any[] = [];
    createRoot(() => {
      createRenderEffect(
        () => store.name,
        (v: any) => void reads.push(v)
      );
    });
    flush();
    // Uninitialized async read: the tracked read suspends (the effect holds
    // like a boundary would) — the exact contract server reads had.
    expect(reads).toEqual([]);

    push({ name: "Ada", role: "admin" }); // snapshot
    await tick();
    flush();
    expect(reads).toEqual(["Ada"]);
    expect(store.role).toBe("admin");

    push([[["name"], "Grace"]]); // patch batch: set name
    await tick();
    flush();
    expect(reads).toEqual(["Ada", "Grace"]);

    push(undefined, true); // trace ends; store latches
    await tick();
    flush();
    expect(store.name).toBe("Grace");
  });

  test("array-rooted traces seed an array", async () => {
    const { iterable, push } = makeTrace();
    const store: any = materializeContainerTrace({ $tr: iterable, $ta: 1 });
    push(["a", "b"]);
    await tick();
    flush();
    expect(Array.isArray(store) ? store.length : -1).toBe(2);
    expect(store[1]).toBe("b");
    push([[[2], "c", 1]]); // insert at index 2
    await tick();
    flush();
    expect(store[2]).toBe("c");
    push(undefined, true);
  });

  test("snapshot replaces the seed wholesale (no stale keys)", async () => {
    const { iterable, push } = makeTrace();
    const store: any = materializeContainerTrace({ $tr: iterable, $ta: 0 });
    push({ only: "this" });
    await tick();
    flush();
    expect(Object.keys(store)).toEqual(["only"]);
    push(undefined, true);
  });

  // The raw-stream wire shape (setContainerTraceStreamMint): the whole point
  // is SYNCHRONOUS readiness — a snapshot the document already delivered
  // must be readable during hydration's synchronous claim walk, with no
  // microtask between materialization and the first read (the chat
  // welcome/status meter's phantom-fallback miss).
  test("stream-shaped trace: a buffered snapshot reads synchronously", () => {
    const stream = makeStream();
    stream.next({ name: "Ada", role: "admin" }); // buffered before revival
    const store: any = materializeContainerTrace({ $tr: stream, $ta: 0 } as any);
    // No tick, no flush: the buffered replay primed the projection.
    expect(store.name).toBe("Ada");
    expect(store.role).toBe("admin");
  });

  test("stream-shaped trace: live batches keep updating, end latches", async () => {
    const stream = makeStream();
    stream.next({ name: "Ada" });
    const store: any = materializeContainerTrace({ $tr: stream, $ta: 0 } as any);

    const reads: any[] = [];
    createRoot(() => {
      createRenderEffect(
        () => store.name,
        (v: any) => void reads.push(v)
      );
    });
    flush();
    expect(reads).toEqual(["Ada"]);

    stream.next([[["name"], "Grace"]]); // live patch batch
    flush();
    expect(reads).toEqual(["Ada", "Grace"]);

    stream.return(undefined); // trace ends; store latches
    flush();
    expect(store.name).toBe("Grace");
  });

  test("stream-shaped trace: nothing buffered suspends until the snapshot lands", async () => {
    const stream = makeStream();
    const store: any = materializeContainerTrace({ $tr: stream, $ta: 0 } as any);

    const reads: any[] = [];
    createRoot(() => {
      createRenderEffect(
        () => store.name,
        (v: any) => void reads.push(v)
      );
    });
    flush();
    expect(reads).toEqual([]); // pending: no snapshot yet

    stream.next({ name: "Ada" });
    flush();
    expect(reads).toEqual(["Ada"]);
    stream.return(undefined);
  });

  test("stream-shaped trace: array-rooted snapshot seeds an array synchronously", () => {
    const stream = makeStream();
    stream.next(["a", "b"]);
    const store: any = materializeContainerTrace({ $tr: stream, $ta: 1 } as any);
    expect(Array.isArray(store) ? store.length : -1).toBe(2);
    expect(store[1]).toBe("b");
  });
});
