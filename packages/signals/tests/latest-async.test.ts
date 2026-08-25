/**
 * #2829: `latest()` / `isPending(() => latest(x))` on an async memo.
 *
 * Three regressions pinned here (all from one app shape — an async memo whose
 * source signal changes, read via `latest` and probed via `isPending`):
 *
 * 1. After the initial load resolved, `latest(x)` regressed to `undefined`:
 *    the shadow computed recomputed mid-transition under a stale/lane context
 *    and cached the committed (still-undefined) value instead of the in-flight
 *    one.
 * 2. The first refresh after settling never turned `isPending(() => latest(x))`
 *    true: the shadow stayed STATUS_UNINITIALIZED forever (its first value was
 *    committed by the optimistic-node resolution path, which didn't clear the
 *    flag), so the pending probe classified the refresh as an "initial load"
 *    and suspended the reader before collecting pending sources.
 * 3. `latest(x)` must never suspend a reader once the source has a value; it
 *    falls back to the stale committed value. (It still suspends on a true
 *    initial load, where there is nothing stale to show.)
 */
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flush();
}

it("latest(asyncMemo) settles to the resolved value and re-reports pending on each refresh (#2829)", async () => {
  const [count, setCount] = createSignal(0);
  let current = deferred<void>();
  const latestLog: unknown[] = [];
  const pendingLog: boolean[] = [];

  createRoot(() => {
    const asyncValue = createMemo(async () => {
      const c = count();
      await current.promise;
      return `AV${c}`;
    });
    createRenderEffect(
      () => latest(asyncValue),
      v => {
        latestLog.push(v);
      }
    );
    createRenderEffect(
      () => isPending(() => latest(asyncValue)),
      v => {
        pendingLog.push(v);
      }
    );
  });
  flush();
  // Initial load: the latest() effect suspends (no stale value) — nothing logged.
  expect(latestLog).toEqual([]);

  current.resolve();
  await settle();
  // Settled: latest shows the resolved value and never regresses to undefined.
  expect(latestLog.at(-1)).toBe("AV0");
  expect(pendingLog.at(-1)).toBe(false);

  // First refresh — previously never reported pending (bug 2).
  current = deferred<void>();
  setCount(1);
  flush();
  expect(pendingLog.at(-1)).toBe(true);
  expect(latestLog.at(-1)).toBe("AV0"); // stale while in flight

  current.resolve();
  await settle();
  expect(latestLog.at(-1)).toBe("AV1");
  expect(pendingLog.at(-1)).toBe(false);
  expect(latestLog).not.toContain(undefined);

  // Second refresh behaves identically.
  current = deferred<void>();
  setCount(2);
  flush();
  expect(pendingLog.at(-1)).toBe(true);
  expect(latestLog.at(-1)).toBe("AV1");

  current.resolve();
  await settle();
  expect(latestLog.at(-1)).toBe("AV2");
  expect(pendingLog.at(-1)).toBe(false);
});
