/** @vitest-environment node */
import { describe, expect, test } from "vitest";
import { createMemo, createRoot, from, NotReadyError } from "../../src/server/index.js";

const tick = () => new Promise<void>(r => setTimeout(r, 0));

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

// The server never holds a subscription open: a render takes the first
// value and the source closes; the client continues it after hydration
// (`ssrSource: "hybrid"`).
describe("server from", () => {
  test("yields the first value, then completes and unsubscribes", async () => {
    const log: string[] = [];
    const src = source<number>(log);
    const it = from<number>(src)[Symbol.asyncIterator]();
    expect(log).toEqual(["open"]);
    const first = it.next();
    src.emit(1);
    src.emit(2);
    expect(await first).toEqual({ value: 1, done: false });
    expect(log).toEqual(["open", "close"]);
    expect(await it.next()).toEqual({ value: undefined, done: true });
  });

  test("a value emitted during subscribe lands, and the source closes", async () => {
    const log: string[] = [];
    let read!: () => number;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      read = createMemo(() => from<number>(source(log, { value: 5 })));
    });
    expect(() => read()).toThrow(NotReadyError);
    await tick();
    expect(read()).toBe(5);
    expect(log).toEqual(["open", "close"]);
    dispose();
    expect(log).toEqual(["open", "close"]);
  });

  test("owner disposal before the first value unsubscribes", () => {
    const log: string[] = [];
    createRoot(dispose => {
      createMemo(() => from<number>(source(log)));
      dispose();
    });
    expect(log).toEqual(["open", "close"]);
  });

  test("an AsyncIterable passes through unchanged", () => {
    const iterable = { [Symbol.asyncIterator]: () => ({}) as AsyncIterator<number> };
    expect(from(iterable)).toBe(iterable);
  });
});
