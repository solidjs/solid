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
});
