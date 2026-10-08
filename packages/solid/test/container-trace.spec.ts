/** @vitest-environment jsdom */
// materializeContainerTrace: the client half of the container tier at the
// slot border. A server projection crosses as its TRACE — an async iterable
// whose first yield is a full state snapshot and whose later yields are
// PatchOp batches — and materializes into a live local projection: reads
// are not-ready until the snapshot lands, then a read-only store the
// batches keep updating, latched when the trace ends.
import { afterEach, describe, expect, test } from "vitest";
import { createOwner } from "@solidjs/signals";
import { createRoot, createRenderEffect, flush } from "../src/index.js";
import { enableHydration, sharedConfig } from "../src/index.js";
import { materializeContainerTrace } from "../src/client/container-trace.js";

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

  // Since seroval 1.6.8 the codec face (`fromCrossJSON`) decodes the trace
  // as seroval's own stream class, which carries no `__SEROVAL_STREAM__`
  // tag: an `.on()` subscription and no async iterator.
  test("untagged stream: a buffered snapshot reads synchronously, live batches update", () => {
    const { __SEROVAL_STREAM__, ...stream } = makeStream();
    stream.next({ name: "Ada", role: "admin" });
    const store: any = materializeContainerTrace({ $tr: stream, $ta: 0 } as any);
    expect(store.name).toBe("Ada");
    expect(store.role).toBe("admin");

    stream.next([[["name"], "Grace"]]);
    flush();
    expect(store.name).toBe("Grace");
    stream.return(undefined);
    flush();
    expect(store.name).toBe("Grace");
  });
});

// The materializer's root is DETACHED (frames-rulings 3.6, S1's "id
// determinism" fix): materialization runs at a fill's arg-read, under
// whatever owner is reading — during hydration an id-carrying one — and a
// root created there would inherit the next child id, shifting every key
// the reader mints after it. The store belongs to no reader's id space.
describe("materializeContainerTrace — id neutrality", () => {
  test("materializing under an id-carrying owner consumes no child id", () => {
    const stream = makeStream();
    stream.next({ name: "Ada" });
    const ids: (string | undefined)[] = [];
    createRoot(
      () => {
        ids.push(createOwner().id);
        materializeContainerTrace({ $tr: stream, $ta: 0 } as any);
        ids.push(createOwner().id);
      },
      { id: "p" }
    );
    const control: (string | undefined)[] = [];
    createRoot(
      () => {
        control.push(createOwner().id);
        control.push(createOwner().id);
      },
      { id: "p" }
    );
    expect(ids).toEqual(control);
  });
});

// The park (frames-rulings 3.6 (iii), "the consumer parks"): materialized for
// a CLAIM (`claiming`, the frames client's adopt-time mount), a replayed
// backlog beyond the snapshot applies after hydration ends — the first reads
// see the snapshot, what the server's markup was rendered from — so a claim
// pass over that markup reads the state it shows, and the backlog lands
// after the claim as the update it is. Keyed on the claim since the traces
// tier (plan step C3): a fresh mount — nothing on screen to agree with —
// reads the fold of its whole backlog at once and pays no beat.
describe("materializeContainerTrace — the parked backlog", () => {
  afterEach(() => {
    sharedConfig.hydrating = false;
    delete (globalThis as any)._$HY;
  });

  const ahead = () => {
    const stream = makeStream();
    stream.next({ name: "Ada", edits: 0 });
    stream.next([[["edits"], 1]]);
    stream.next([
      [["name"], "Ada (edited)"],
      [["edits"], 2]
    ]);
    return stream;
  };

  test("materialized for a claim during hydration: the snapshot serves; the backlog lands at hydration end, as one update", () => {
    enableHydration();
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
    sharedConfig.hydrating = true;
    const store: any = materializeContainerTrace({ $tr: ahead(), $ta: 0 } as any, true);
    const reads: string[] = [];
    createRoot(() => {
      createRenderEffect(
        () => `${store.name}/${store.edits}`,
        (v: string) => void reads.push(v)
      );
    });
    flush();
    expect(reads).toEqual(["Ada/0"]);
    expect(sharedConfig.isHydrationInProgress!()).toBe(true);
    // The root pass ends with nothing pending: hydration is done, the park
    // releases, the compute drains the whole backlog in one pass.
    sharedConfig.hydrating = false;
    flush();
    expect(reads).toEqual(["Ada/0", "Ada (edited)/2"]);
  });

  test("a claim with no hydration in progress (a frame's late claim): the snapshot serves; the backlog lands on the next microtask", async () => {
    const store: any = materializeContainerTrace({ $tr: ahead(), $ta: 0 } as any, true);
    expect(store.name).toBe("Ada");
    expect(store.edits).toBe(0);
    await Promise.resolve();
    flush();
    expect(store.name).toBe("Ada (edited)");
    expect(store.edits).toBe(2);
  });

  test("a fresh mount parks nothing: the first read is the fold of the whole backlog", () => {
    const store: any = materializeContainerTrace({ $tr: ahead(), $ta: 0 } as any);
    expect(store.name).toBe("Ada (edited)");
    expect(store.edits).toBe(2);
  });

  test("a fresh mount during hydration parks nothing either (the park is the claim's, not the pass's)", () => {
    enableHydration();
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
    sharedConfig.hydrating = true;
    const store: any = materializeContainerTrace({ $tr: ahead(), $ta: 0 } as any);
    expect(store.name).toBe("Ada (edited)");
    expect(store.edits).toBe(2);
  });

  test("a snapshot alone is not a backlog: live emissions apply as they land", () => {
    const stream = makeStream();
    stream.next({ name: "Ada" });
    const store: any = materializeContainerTrace({ $tr: stream, $ta: 0 } as any);
    expect(store.name).toBe("Ada");
    stream.next([[["name"], "Grace"]]);
    flush();
    expect(store.name).toBe("Grace");
  });

  test("a failure in the backlog applies in order, after the parked patches", async () => {
    const stream = ahead();
    stream.throw(new Error("boom"));
    const store: any = materializeContainerTrace({ $tr: stream, $ta: 0 } as any, true);
    // Parked: the snapshot reads, the failure has not surfaced.
    expect(store.name).toBe("Ada");
    await Promise.resolve();
    flush();
    expect(() => store.name).toThrow("boom");
  });
});
