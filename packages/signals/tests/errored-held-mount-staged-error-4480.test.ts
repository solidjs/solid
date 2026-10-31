/**
 * #4480: an error boundary mounted by a held pass over a source whose error
 * is staged in that hold (D-41) looped the flush for good. The seam's
 * fold-back (D-16, U-9: a loading fallback staged into the hold its readers
 * landed in is content-ready at the commit) cleared the error boundary's
 * readers too — the staged error is not a landing it can fold over — so the
 * output re-derived into the error every round, and the effect that owns the
 * boundary re-ran on each new output.
 *
 * Ruled: the error is an answer staged with the frame (D-41, F-12): while
 * the hold is open the effect keeps what it showed and its error arm does
 * not run; at the reveal the error fallback shows with the frame (F-1, F-2).
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
  untrack
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
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

it("#4480: a held pass mounting an error boundary over a staged error settles (D-41)", async () => {
  let request = deferred<number>();
  let sibling = deferred<number>();
  const [count, setCount] = createSignal(1);
  const log: unknown[] = [];
  let shown = 0;
  const dispose = createRoot(d => {
    const data = createMemo(() => {
      count();
      return request.promise;
    });
    const slow = createMemo(() => {
      count();
      return sibling.promise;
    });
    // The frame's hold: a render effect over `slow` (F-2).
    createRenderEffect(slow, v => void (shown = v), { schedule: true });
    // The effect's compute reads the input and mounts a boundary over `data`.
    createEffect(
      () => [
        count(),
        untrack(() =>
          createErrorBoundary(
            () => data(),
            (e: () => any) => `ERR ${e()?.message}`
          )
        )()
      ],
      {
        effect: (v: unknown[]) => void log.push(v[1]),
        error: (e: unknown) => void log.push(e)
      }
    );
    return d;
  });
  try {
    flush();
    request.resolve(1);
    sibling.resolve(1);
    await tick();
    expect(log).toEqual([1]);
    request = deferred();
    sibling = deferred();
    setCount(2);
    flush();
    request.reject(new Error("declined"));
    // The flush ends; the held frame keeps what it showed.
    await tick();
    expect(shown).toBe(1);
    expect(log).toEqual([1]);
    // The reveal: the error fallback lands with the frame.
    sibling.resolve(2);
    await tick();
    expect(shown).toBe(2);
    expect(log).toEqual([1, "ERR declined"]);
  } finally {
    dispose();
    flush();
  }
});
