// An untracked `isPending`/`latest` is a one-off read: it marks its reader a
// verdict reader for how the pass reads (a frame reader sees the screen, A10)
// but not for when the pass runs. A tracked verdict re-derives its reader when
// a dependency goes pending, since the answer changed; an untracked one does
// not, the same as any other untracked read. Before, the window stamped the
// running computation either way, so a library that probes pending state
// inside `untrack` (a router's link claim) made whatever computation created
// it re-run on each of its own dependencies going pending.

import { describe, expect, it } from "vitest";
import {
  action,
  createEffect,
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

  it("an untracked isPending of a source that rejects before resolving answers false instead of erroring", async () => {
    const log: string[] = [];
    let reject!: (e: unknown) => void;
    createRoot(() => {
      const a = createMemo(
        () =>
          new Promise<string>((_, r) => {
            reject = r;
          })
      );
      const probe = createMemo(() => untrack(() => isPending(() => a())));
      createRenderEffect(
        () => {
          try {
            return String(probe());
          } catch (e) {
            return `ERR:${(e as Error)?.message ?? ""}`;
          }
        },
        v => {
          log.push(v);
        }
      );
    });
    flush();
    reject(new Error("boom"));
    for (let i = 0; i < 6; i++) await settle();
    await new Promise(r => setTimeout(r, 20));
    flush();
    expect(log.at(-1)).toBe("false");
  });

  it("A10: an untracked isPending reader never pairs pending with the fresh value", async () => {
    const log: string[] = [];
    let setX!: (v: number) => void;
    let cur = deferred<string>();
    const gate = deferred<void>();
    createRoot(() => {
      const [x, set] = createSignal(1);
      setX = set;
      const m = createMemo(() => {
        const v = x();
        return cur.promise.then(s => `${s}-${v}`);
      });
      const pair = () =>
        `[${untrack(() => isPending(() => m()))}, ${(() => {
          try {
            return m();
          } catch {
            return "THROWN";
          }
        })()}]`;
      const host = createMemo(pair);
      createRenderEffect(
        () => {
          try {
            return host();
          } catch {
            return "THROWN";
          }
        },
        v => {
          log.push(`memo:${v}`);
        }
      );
      createRenderEffect(pair, v => {
        log.push(`render:${v}`);
      });
      createEffect(pair, v => {
        log.push(`user:${v}`);
      });
    });
    flush();
    cur.resolve("data");
    await settle();

    const act = action(function* () {
      cur = deferred<string>();
      setX(2);
      yield gate.promise;
    });
    act();
    flush();
    await settle();
    cur.resolve("data");
    await settle();
    gate.resolve();
    await settle();
    await settle();

    expect(log.filter(v => v.includes("true, data-2"))).toEqual([]);
    expect(log.slice(-3).sort()).toEqual([
      "memo:[false, data-2]",
      "render:[false, data-2]",
      "user:[false, data-2]"
    ]);
  });
});
