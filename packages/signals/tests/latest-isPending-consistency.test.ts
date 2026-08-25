/**
 * Regression tests for #2831 — latest()/isPending() consistency review.
 *
 * Three invariants pinned here:
 * 1. A store leaf's refetch (driven by its firewall) is visible to
 *    `isPending(() => latest(...))`, same as a plain async memo.
 * 2. `[isPending(x), x()]` read as a pair can never be `[true, newValue]` —
 *    a reader that already observes the fresh in-flight value must not also
 *    be told that value is stale/pending.
 * 3. Sync derivations of transition-held sources tunnel through to
 *    `latest()` and `isPending()` — a memo over a held signal reports the
 *    in-flight derived value and pending state, not just the raw signal.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  affects,
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  latest,
  refresh
} from "../src/index.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

describe("latest/isPending consistency (#2831)", () => {
  it("store leaf firewall refetch is reported by isPending(() => latest(...))", async () => {
    const log: string[] = [];
    let cur = deferred<{ value: string }>();
    let store: any;

    createRoot(() => {
      [store] = createStore(async () => {
        const v = await cur.promise;
        return v;
      }, {} as any);
      createRenderEffect(
        () =>
          `pRead=${isPending(() => store.value)} pLatest=${isPending(() =>
            latest(() => store.value)
          )} latest=${latest(() => store.value)}`,
        v => {
          log.push(v);
        }
      );
    });
    flush();

    cur.resolve({ value: "v1" });
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(log).toEqual(["pRead=false pLatest=false latest=v1"]);
    log.length = 0;

    // A bare refresh is a quiet re-ask (question-scoped pending, re-ruled
    // 2026-07-13) — neither probe flips. The DECLARED reload (affects +
    // refresh) is what pends, and it must be visible to both probe forms:
    // the mark sits on the store record, and the refetch lives on the leaf's
    // firewall — `isPending(() => latest(...))` has to see it the same as
    // the plain read probe.
    cur = deferred<{ value: string }>();
    affects(store);
    refresh(store);
    flush();
    expect(log).toEqual(["pRead=true pLatest=true latest=v1"]);
    log.length = 0;

    cur.resolve({ value: "v2" });
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(log[log.length - 1]).toBe("pRead=false pLatest=false latest=v2");
  });

  it("[isPending(x), x()] never pairs pending with the fresh value when async resolves inside an open action", async () => {
    const renderLog: string[] = [];
    const userLog: string[] = [];
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
      const readPair = () =>
        `[${isPending(() => m())}, ${(() => {
          try {
            return m();
          } catch {
            return "THROWN";
          }
        })()}]`;
      createRenderEffect(readPair, v => {
        renderLog.push(v);
      });
      createEffect(readPair, v => {
        userLog.push(v);
      });
    });
    flush();

    cur.resolve("data");
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(renderLog).toEqual(["[false, data-1]"]);
    expect(userLog).toEqual(["[false, data-1]"]);
    renderLog.length = 0;
    userLog.length = 0;

    const act = action(function* () {
      cur = deferred<string>();
      setX(2);
      yield gate.promise;
    });
    act();
    flush();
    // Fetch in flight: both readers see the stale value as pending.
    expect(renderLog).toEqual(["[true, data-1]"]);
    expect(userLog).toEqual(["[true, data-1]"]);
    renderLog.length = 0;
    userLog.length = 0;

    cur.resolve("data");
    await Promise.resolve();
    await Promise.resolve();
    flush();
    // Async resolved but action still open. Render (stale) readers keep the
    // old value with pending=true; user (fresh) readers see the new value and
    // therefore must NOT see pending — [true, data-2] is the forbidden pair.
    expect(renderLog).toEqual(["[true, data-1]"]);
    expect(userLog).toEqual(["[false, data-2]"]);
    renderLog.length = 0;
    userLog.length = 0;

    gate.resolve();
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(renderLog).toEqual(["[false, data-2]"]);
    expect(userLog).toEqual(["[false, data-2]"]);
  });

  it("sync memo over a transition-held signal is visible to latest() and isPending()", async () => {
    const log: string[] = [];
    let setX!: (v: number) => void;
    const gate = deferred<void>();

    createRoot(() => {
      const [x, set] = createSignal(1);
      setX = set;
      const m = createMemo(() => x() * 10);
      createRenderEffect(
        () =>
          `sig=[latest=${latest(x)} pend=${isPending(x)}] memo=[latest=${latest(() =>
            m()
          )} pend=${isPending(() => m())}]`,
        v => {
          log.push(v);
        }
      );
    });
    flush();
    expect(log).toEqual(["sig=[latest=1 pend=false] memo=[latest=10 pend=false]"]);
    log.length = 0;

    const act = action(function* () {
      setX(2);
      yield gate.promise;
    });
    act();
    flush();
    // The held write tunnels through the sync memo: the derived in-flight
    // value (20) and pending state must match the raw signal's.
    expect(log).toEqual(["sig=[latest=2 pend=true] memo=[latest=20 pend=true]"]);
    log.length = 0;

    gate.resolve();
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(log).toEqual(["sig=[latest=2 pend=false] memo=[latest=20 pend=false]"]);
  });
});

/**
 * #3028 — a wrapper memo probing `isPending(a)` without also reading the
 * async memo derived from `a`.
 *
 * The failing shape: `createMemo(() => isPending(a))` (what `<Show
 * when={isPending(a)}>` compiles to) recomputes during the write's flush,
 * BEFORE the downstream async memo pends. Its probe read `a`'s held value
 * fresh, so the fresh-read pairing rule above suppressed the verdict — and
 * with no transaction registered yet, nothing ever re-asked, so the wrapper
 * stayed false for the whole flight.
 *
 * The fix is two-sided: the pairing rule only suppresses for landed answers
 * awaiting reveal (a held INPUT whose transaction still has async in flight
 * stays pending for every reader), and a probe suppressed before the async
 * registered is recorded and re-woken at the registration site.
 */
describe("isPending wrapper memo over a signal with async downstream (#3028)", () => {
  const tick = async () => {
    await new Promise(r => setTimeout(r, 0));
    flush();
  };

  function makeAsyncDouble(a: () => number) {
    const resolvers: Array<() => void> = [];
    const double = createMemo(async () => {
      const x = a();
      await new Promise<void>(r => resolvers.push(r));
      return x * 2;
    });
    return { double, resolveAll: () => resolvers.splice(0).forEach(r => r()) };
  }

  it("memo of bare isPending(a) flips true while downstream async is in flight", async () => {
    const [a, setA] = createSignal(0);
    let resolveAll!: () => void;
    let dispose!: () => void;
    const pendingLog: boolean[] = [];
    const doubleLog: number[] = [];
    createRoot(d => {
      dispose = d;
      const source = makeAsyncDouble(a);
      resolveAll = source.resolveAll;
      const m = createMemo(() => isPending(a));
      createRenderEffect(
        () => source.double(),
        v => {
          doubleLog.push(v);
        }
      );
      createRenderEffect(
        () => m(),
        v => {
          pendingLog.push(v);
        }
      );
    });
    flush();
    resolveAll();
    await tick();
    expect(doubleLog).toEqual([0]);
    expect(pendingLog).toEqual([false]);

    setA(1);
    flush();
    // async in flight: a's new question is unanswered — isPending(a) must be true
    expect(pendingLog).toEqual([false, true]);

    resolveAll();
    await tick();
    expect(doubleLog).toEqual([0, 2]);
    expect(pendingLog).toEqual([false, true, false]);
    dispose();
  });

  it("memo reading both a() and isPending(a) flips true (issue variant B)", async () => {
    const [a, setA] = createSignal(0);
    let resolveAll!: () => void;
    let dispose!: () => void;
    const pendingLog: boolean[] = [];
    createRoot(d => {
      dispose = d;
      const source = makeAsyncDouble(a);
      resolveAll = source.resolveAll;
      createRenderEffect(
        () => source.double(),
        () => {}
      );
      const m = createMemo(() => (a(), isPending(a)));
      createRenderEffect(
        () => m(),
        v => {
          pendingLog.push(v);
        }
      );
    });
    flush();
    resolveAll();
    await tick();
    expect(pendingLog).toEqual([false]);

    setA(1);
    flush();
    expect(pendingLog).toEqual([false, true]);

    resolveAll();
    await tick();
    expect(pendingLog).toEqual([false, true, false]);
    dispose();
  });

  it("control: memo reading double() too flips true (issue's workaround)", async () => {
    const [a, setA] = createSignal(0);
    let resolveAll!: () => void;
    let dispose!: () => void;
    const pendingLog: boolean[] = [];
    createRoot(d => {
      dispose = d;
      const source = makeAsyncDouble(a);
      resolveAll = source.resolveAll;
      const m = createMemo(() => (source.double(), isPending(a)));
      createRenderEffect(
        () => {
          try {
            return m();
          } catch {
            return false;
          }
        },
        v => {
          pendingLog.push(v);
        }
      );
    });
    flush();
    resolveAll();
    await tick();

    setA(1);
    flush();
    expect(pendingLog[pendingLog.length - 1]).toBe(true);

    resolveAll();
    await tick();
    expect(pendingLog[pendingLog.length - 1]).toBe(false);
    dispose();
  });

  it("plain sync write (no async downstream) never glitches the wrapper true", () => {
    const [a, setA] = createSignal(0);
    let dispose!: () => void;
    const pendingLog: boolean[] = [];
    createRoot(d => {
      dispose = d;
      const m = createMemo(() => isPending(a));
      createRenderEffect(
        () => m(),
        v => {
          pendingLog.push(v);
        }
      );
    });
    flush();
    expect(pendingLog).toEqual([false]);

    setA(1);
    flush();
    // The held-write companion churn inside the flush must not surface: a
    // plain write commits this flush, so the wrapper never reports pending.
    expect(pendingLog).toEqual([false]);
    dispose();
  });

  it("second write during an open flight keeps the wrapper true", async () => {
    const [a, setA] = createSignal(0);
    let resolveAll!: () => void;
    let dispose!: () => void;
    const pendingLog: boolean[] = [];
    createRoot(d => {
      dispose = d;
      const source = makeAsyncDouble(a);
      resolveAll = source.resolveAll;
      createRenderEffect(
        () => source.double(),
        () => {}
      );
      const m = createMemo(() => isPending(a));
      createRenderEffect(
        () => m(),
        v => {
          pendingLog.push(v);
        }
      );
    });
    flush();
    resolveAll();
    await tick();
    expect(pendingLog).toEqual([false]);

    setA(1);
    flush();
    expect(pendingLog).toEqual([false, true]);

    setA(2);
    flush();
    expect(pendingLog).toEqual([false, true]);

    resolveAll();
    await tick();
    resolveAll();
    await tick();
    expect(pendingLog).toEqual([false, true, false]);
    dispose();
  });
});
