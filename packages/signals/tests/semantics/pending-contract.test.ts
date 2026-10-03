import {
  createMemo,
  createRenderEffect,
  createRoot,
  flush,
  isPending,
  NotReadyError
} from "../../src/index.js";
import { HostTasks } from "./host.js";

// Accepted upstream contract: SPEC A16 (maintainer keep, 2026-07-06).
// #2928 / 70e89bafa7de4b6cbdb47aa83ac37b59244647d0 explicitly preserves the
// fully context-free boolean result. An untrack() call inside a surrounding
// reactive context can still propagate NotReadyError; "untracked" alone is
// not a sufficient scope predicate for a general readiness invariant.
test("A16 suspends a tracked first-load pending probe but returns false without reactive context", async () => {
  const host = new HostTasks();
  let resolve!: (value: number) => void;
  let dispose!: () => void;
  let data!: () => number;
  const published: boolean[] = [];
  createRoot(d => {
    dispose = d;
    data = createMemo(
      () =>
        new Promise<number>(r => {
          resolve = r;
        })
    );
    createRenderEffect(
      () => isPending(data),
      value => {
        published.push(value);
      }
    );
  });
  try {
    flush();
    expect(published).toEqual([]);
    expect(isPending(data)).toBe(false);
    expect(data).toThrow(NotReadyError);
    await host.run(() => resolve(1));
    await host.drain();
    expect(published).toEqual([false]);
    expect(data()).toBe(1);
  } finally {
    dispose();
    resolve(1);
    await host.drain();
    flush();
    host.close();
  }
});
