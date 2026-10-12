/**
 * D-40 (proposed): an error is an answer — it ends the wait like a value and
 * shows when a value would. S-41, S-42. Shapes from #3886's audit (GabbeV).
 *
 * `data` and `slow` both re-ask on `count`; a scheduled render effect over
 * `slow` holds the frame (F-2). A rejection of `data` settles it — the hold
 * never waits on an error — but must not SHOW until `slow` lands: the
 * effect's error arm, the untracked read, the boundary and `isPending` all
 * keep the previous frame; `latest` is the one early view (F-6). Recovery is
 * the mirror (D-39), and recovering to the last good value is still a new
 * answer.
 *
 * Pinned `it.fails` while D-40 is proposed, not ruled (OPEN-QUESTIONS Q-6).
 * The no-hold case at the end is a plain bug, pinned as a failing `it`.
 */
import { expect, it } from "vitest";
import {
  createEffect,
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const tick = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};

function scene(boundary: boolean) {
  let request = deferred<number>();
  let sibling = deferred<number>();
  const [count, setCount] = createSignal(1);
  const screen = { count: 0, data: undefined as unknown, slow: 0 };
  const log: unknown[] = [];
  let data!: () => number;
  const dispose = createRoot(d => {
    data = createMemo(() => {
      count();
      return request.promise;
    });
    const slow = createMemo(() => {
      count();
      return sibling.promise;
    });
    createRenderEffect(count, v => void (screen.count = v), { schedule: true });
    // With a boundary the error is content (F-4): the screen shows its
    // fallback. Without one the user effect's arm is the only consumer.
    if (boundary) {
      const errored = createErrorBoundary(data, e => `Error ${(e() as Error).message}`);
      createRenderEffect(errored, v => void (screen.data = v), { schedule: true });
    } else screen.data = "no boundary";
    createRenderEffect(slow, v => void (screen.slow = v), { schedule: true });
    createEffect(data, { effect: v => void log.push(v), error: e => void log.push(e) });
    return d;
  });
  const ask = (n: number) => {
    request = deferred<number>();
    sibling = deferred<number>();
    setCount(n);
    flush();
  };
  const untracked = () => {
    try {
      return data();
    } catch (e) {
      // The engine throws its status wrapper; the user's error is its cause.
      return (e as Error).cause ?? e;
    }
  };
  return {
    screen,
    log,
    data,
    ask,
    untracked,
    answer: (v: number) => request.resolve(v),
    fail: (e: unknown) => request.reject(e),
    land: (v: number) => sibling.resolve(v),
    dispose
  };
}

it.each([true, false])(
  "S-41: a held rejection reveals with its frame (boundary: %s)",
  async boundary => {
    const s = scene(boundary);
    const shown = boundary ? "Error 2" : "no boundary";
    const boom = new Error("2");
    try {
      flush();
      s.answer(1);
      s.land(1);
      await tick();
      expect(s.screen).toEqual({ count: 1, data: boundary ? 1 : "no boundary", slow: 1 });
      expect(s.log).toEqual([1]);

      s.ask(2);
      expect(s.screen).toEqual({ count: 1, data: boundary ? 1 : "no boundary", slow: 1 });
      expect(isPending(s.data)).toBe(true);
      expect(latest(s.data)).toBe(1);

      // Settled, not shown.
      s.fail(boom);
      await tick();
      expect(s.screen).toEqual({ count: 1, data: boundary ? 1 : "no boundary", slow: 1 });
      expect(s.log).toEqual([1]);
      expect(s.untracked()).toBe(1);
      expect(isPending(s.data)).toBe(true);
      expect(() => latest(s.data)).toThrow("2");

      // One frame: input, error fallback and sibling.
      s.land(2);
      await tick();
      expect(s.screen).toEqual({ count: 2, data: shown, slow: 2 });
      expect(s.log).toEqual([1, boom]);
      expect(s.untracked()).toBe(boom);
      expect(isPending(s.data)).toBe(false);
    } finally {
      s.dispose();
      flush();
    }
  }
);

it.each([true, false])(
  "S-42: a held recovery keeps the shown error; the last good value is a new answer (boundary: %s)",
  async boundary => {
    const s = scene(boundary);
    const shown = boundary ? "Error 2" : "no boundary";
    const recovered = boundary ? 1 : "no boundary";
    const boom = new Error("2");
    try {
      flush();
      s.answer(1);
      s.land(1);
      await tick();
      s.ask(2);
      s.fail(boom);
      s.land(2);
      await tick();
      expect(s.screen).toEqual({ count: 2, data: shown, slow: 2 });
      expect(s.log).toEqual([1, boom]);

      // The error stays the display through the retry (D-39).
      s.ask(3);
      expect(s.screen).toEqual({ count: 2, data: shown, slow: 2 });
      expect(s.untracked()).toBe(boom);
      expect(isPending(s.data)).toBe(true);

      // Settled to the last good value, not shown.
      s.answer(1);
      await tick();
      expect(s.screen).toEqual({ count: 2, data: shown, slow: 2 });
      expect(s.untracked()).toBe(boom);
      expect(s.log).toEqual([1, boom]);
      expect(isPending(s.data)).toBe(true);
      expect(latest(s.data)).toBe(1);

      // `1` equals the last good value and is still a new answer.
      s.land(3);
      await tick();
      expect(s.screen).toEqual({ count: 3, data: recovered, slow: 3 });
      expect(s.untracked()).toBe(1);
      expect(s.log).toEqual([1, boom, 1]);
      expect(isPending(s.data)).toBe(false);
    } finally {
      s.dispose();
      flush();
    }
  }
);

// No hold at all: the same recovery is a plain bug, not a rule question. The
// landing equal to the last good value passes the equality gate while the
// node is errored, so the effect never hears the recovery (#3886). Pinned
// `it.fails` until its own fix lands.
it(
  "recovering to the last good value after an async rejection reaches the effect",
  async () => {
    const boom = new Error("failed");
    const [count, setCount] = createSignal(0);
    const log: unknown[] = [];
    let data!: () => number;
    const dispose = createRoot(d => {
      data = createMemo(() => (count() === 1 ? Promise.reject(boom) : Promise.resolve(1)));
      createEffect(data, { effect: v => void log.push(v), error: e => void log.push(e) });
      return d;
    });
    try {
      flush();
      await tick();
      setCount(1);
      flush();
      await tick();
      expect(log).toEqual([1, boom]);
      setCount(2);
      flush();
      await tick();
      expect(data()).toBe(1);
      expect(isPending(data)).toBe(false);
      expect(log).toEqual([1, boom, 1]);
    } finally {
      dispose();
      flush();
    }
  }
);
