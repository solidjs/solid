/**
 * #4106: a memo over `latest(source)` is display-ahead (F-6, D-22) — a held
 * landing on `source` reaches it before the frame reveals. A rejection is an
 * answer like a value (D-41), so it reaches the derivation at the same point:
 * `latest(derived)`, the plain read and the effect's error arm see it while
 * the sibling still holds the frame, as they see a fulfilled value.
 */
import { expect, it } from "vitest";
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
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
const read = (fn: () => unknown) => {
  try {
    return fn();
  } catch (e) {
    return e instanceof Error ? e.message : e;
  }
};

async function scene() {
  let request = deferred<number>();
  let sibling = deferred<number>();
  const [round, setRound] = createSignal(1);
  const log: unknown[] = [];
  const screen = { round: 0 };
  let source!: () => number;
  let derived!: () => number;
  createRoot(() => {
    source = createMemo(() => {
      round();
      return request.promise;
    });
    derived = createMemo(() => latest(source));
    const slow = createMemo(() => {
      round();
      return sibling.promise;
    });
    createRenderEffect(
      () => [round(), slow()],
      ([r]) => void (screen.round = r),
      { schedule: true }
    );
    createEffect(derived, {
      effect: v => void log.push(v),
      error: e => void log.push((e as Error).message)
    });
  });
  request.resolve(1);
  sibling.resolve(1);
  await tick();
  expect(log).toEqual([1]);
  expect(screen.round).toBe(1);
  request = deferred<number>();
  sibling = deferred<number>();
  setRound(2);
  flush();
  return {
    log,
    screen,
    request: () => request,
    sibling: () => sibling,
    // [latest(source), latest(derived), derived(), source()], read unowned
    reads: () => [
      read(() => latest(source)),
      read(() => latest(derived)),
      read(derived),
      read(source)
    ]
  };
}

it("a held value reaches a derivation of latest before the reveal", async () => {
  const s = await scene();
  s.request().resolve(2);
  await tick();
  expect(s.screen.round).toBe(1);
  expect(s.reads()).toEqual([2, 2, 2, 1]);
  expect(s.log).toEqual([1, 2]);
  s.sibling().resolve(2);
  await tick();
  expect(s.screen.round).toBe(2);
  expect(s.reads()).toEqual([2, 2, 2, 2]);
  expect(s.log).toEqual([1, 2]);
});

it("a held error reaches a derivation of latest at the same point as a value", async () => {
  const s = await scene();
  s.request().reject(new Error("boom"));
  await tick();
  expect(s.screen.round).toBe(1);
  expect(s.reads()).toEqual(["boom", "boom", "boom", 1]);
  expect(s.log).toEqual([1, "boom"]);
  s.sibling().resolve(2);
  await tick();
  expect(s.screen.round).toBe(2);
  expect(s.reads()).toEqual(["boom", "boom", "boom", "boom"]);
  expect(s.log).toEqual([1, "boom"]);
});

it("a tracked latest of the derivation sees the held error when it would see a value", async () => {
  for (const reject of [false, true]) {
    let request = deferred<number>();
    let sibling = deferred<number>();
    const [round, setRound] = createSignal(1);
    const log: unknown[] = [];
    let outer!: () => number;
    createRoot(() => {
      const source = createMemo(() => {
        round();
        return request.promise;
      });
      const derived = createMemo(() => latest(source));
      outer = createMemo(() => latest(derived));
      const slow = createMemo(() => {
        round();
        return sibling.promise;
      });
      createRenderEffect(slow, () => {}, { schedule: true });
      createEffect(outer, {
        effect: v => void log.push(v),
        error: e => void log.push((e as Error).message)
      });
    });
    request.resolve(1);
    sibling.resolve(1);
    await tick();
    request = deferred<number>();
    sibling = deferred<number>();
    setRound(2);
    flush();
    if (reject) request.reject(new Error("boom"));
    else request.resolve(2);
    await tick();
    const answer = reject ? "boom" : 2;
    expect([read(outer), read(() => latest(outer))]).toEqual([answer, answer]);
    expect(log).toEqual([1, answer]);
    sibling.resolve(2);
    await tick();
    expect(log).toEqual([1, answer]);
  }
});
