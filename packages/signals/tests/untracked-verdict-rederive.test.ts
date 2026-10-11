// An untracked `isPending`/`latest` inside a computation is a snapshot: it
// does not make the computation a verdict reader, so the computation is not
// re-derived when one of its own dependencies goes pending (#3946, router
// link claims inside a non-keyed <Show>). A throw still goes through
// `untrack` like any untracked read. Event handlers — no computation — are
// the supported untracked use. Tests adapted from brenelz's #3946.

import { describe, expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  untrack
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

/** Runs of a memo over an async source while the source refetches. */
async function runsWhilePending(probe: (data: () => string) => void) {
  let runs = 0;
  let setId!: (v: number) => void;
  let cur = deferred<string>();
  const seen: string[] = [];
  createRoot(() => {
    const [id, set] = createSignal(1);
    setId = set;
    const data = createMemo(() => {
      const v = id();
      return cur.promise.then(s => `${s}-${v}`);
    });
    const host = createMemo(() => {
      runs++;
      const v = data();
      probe(data);
      return v;
    });
    createRenderEffect(
      () => {
        try {
          return host();
        } catch {
          return "pending";
        }
      },
      v => {
        seen.push(v);
      }
    );
  });
  flush();
  cur.resolve("a");
  await settle();
  const before = runs;
  cur = deferred<string>();
  setId(2);
  flush();
  await settle();
  const pendingRuns = runs - before;
  cur.resolve("b");
  await settle();
  await settle();
  return { pendingRuns, seen };
}

describe("untracked verdict reads", () => {
  it("an untracked isPending does not re-derive its reader while a dependency is pending", async () => {
    const { pendingRuns, seen } = await runsWhilePending(() => untrack(() => isPending(() => {})));
    expect(pendingRuns).toBe(0);
    expect(seen.at(-1)).toBe("b-2");
  });

  it("an untracked latest does not re-derive its reader while a dependency is pending", async () => {
    const { pendingRuns, seen } = await runsWhilePending(data => untrack(() => latest(data)));
    expect(pendingRuns).toBe(0);
    expect(seen.at(-1)).toBe("b-2");
  });

  it("a tracked isPending still re-derives its reader while a dependency is pending", async () => {
    const { pendingRuns, seen } = await runsWhilePending(data => isPending(data));
    expect(pendingRuns).toBe(1);
    expect(seen.at(-1)).toBe("b-2");
  });

  it("a reader that stops reading isPending tracked stops re-deriving", async () => {
    let runs = 0;
    let setId!: (v: number) => void;
    let setTracked!: (v: boolean) => void;
    let cur = deferred<string>();
    createRoot(() => {
      const [id, set] = createSignal(1);
      const [tracked, setT] = createSignal(true);
      setId = set;
      setTracked = setT;
      const data = createMemo(() => {
        const v = id();
        return cur.promise.then(s => `${s}-${v}`);
      });
      const host = createMemo(() => {
        runs++;
        const v = data();
        if (tracked()) isPending(data);
        else untrack(() => isPending(data));
        return v;
      });
      createRenderEffect(
        () => {
          try {
            return host();
          } catch {
            return "pending";
          }
        },
        () => {}
      );
    });
    flush();
    cur.resolve("a");
    await settle();
    setTracked(false);
    flush();
    const before = runs;
    cur = deferred<string>();
    setId(2);
    flush();
    await settle();
    expect(runs - before).toBe(0);
    cur.resolve("b");
    await settle();
  });

  it("isPending in an event handler (no computation) answers the current verdict", async () => {
    let setId!: (v: number) => void;
    let cur = deferred<string>();
    let data!: () => string;
    createRoot(() => {
      const [id, set] = createSignal(1);
      setId = set;
      data = createMemo(() => {
        const v = id();
        return cur.promise.then(s => `${s}-${v}`);
      });
      createRenderEffect(data, () => {});
    });
    flush();
    cur.resolve("a");
    await settle();
    const handler = () => isPending(data);
    expect(handler()).toBe(false);
    cur = deferred<string>();
    setId(2);
    flush();
    expect(handler()).toBe(true);
    cur.resolve("b");
    await settle();
    await settle();
    expect(handler()).toBe(false);
  });
});
