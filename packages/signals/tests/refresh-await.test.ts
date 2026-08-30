/**
 * refresh(target) returns a Promise of the target's NEXT QUIESCENT STATE.
 *
 * Contract under test:
 * - Accessor targets resolve with the settled value; store targets resolve
 *   with the store node passed (root or nested — the family re-asks as one).
 * - Quiescence, not flight identity: a superseding refresh (or any newer
 *   invalidation) folds every waiter onto whatever finally lands.
 * - The seam is the landing itself, not graph notification: an equal-value
 *   landing (completely silent to subscribers) still settles the promise.
 * - A failed re-ask rejects with the error; `yield refresh(x)` in an action
 *   throws back at the yield point like any failed step.
 * - Inside an action, truth landing into the held transaction is STAGED; the
 *   promise settles then and delivers the staged value — never the caller's
 *   own optimistic override.
 * - The re-ask stays verdict-quiet (isPending false) exactly as before.
 * - Fire-and-forget refresh() is unchanged: an ignored promise never
 *   surfaces an unhandled rejection.
 */
import { expect, test } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createOptimistic,
  createProjection,
  createRoot,
  createSignal,
  flush,
  isPending,
  refresh
} from "../src/index.js";

const tick = () => new Promise<void>(r => setTimeout(r, 0));

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("sync source: resolves with the re-executed value", async () => {
  let runs = 0;
  let m!: () => number;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    m = createMemo(() => ++runs);
    createEffect(m, () => {});
  });
  flush();
  expect(m()).toBe(1);

  const p = refresh(m);
  flush();
  await expect(p).resolves.toBe(2);
  expect(m()).toBe(2);
  dispose();
});

test("async source: resolves with the landed value; the window stays quiet", async () => {
  const gates: ReturnType<typeof deferred<string>>[] = [];
  let m!: () => string;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    m = createMemo(() => {
      const gate = deferred<string>();
      gates.push(gate);
      return gate.promise as unknown as string;
    });
    createEffect(m, () => {});
  });
  flush();
  gates[0].resolve("v1");
  await tick();
  flush();
  expect(m()).toBe("v1");

  let settled = false;
  const p = refresh(m).then(v => ((settled = true), v));
  flush();
  await tick();
  // Mid-window: stale-while-revalidate serves v1, the re-ask is quiet, and
  // the promise has not settled.
  expect(m()).toBe("v1");
  expect(isPending(m)).toBe(false);
  expect(settled).toBe(false);

  gates[1].resolve("v2");
  await tick();
  flush();
  await expect(p).resolves.toBe("v2");
  expect(m()).toBe("v2");
  dispose();
});

test("equal-value landing (silent to the graph) still settles the promise", async () => {
  const gates: ReturnType<typeof deferred<string>>[] = [];
  const effectRuns: string[] = [];
  let m!: () => string;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    m = createMemo(() => {
      const gate = deferred<string>();
      gates.push(gate);
      return gate.promise as unknown as string;
    });
    createEffect(m, v => void effectRuns.push(v));
  });
  flush();
  gates[0].resolve("same");
  await tick();
  flush();
  expect(effectRuns).toEqual(["same"]);

  const p = refresh(m);
  flush();
  await tick();
  gates[1].resolve("same");
  await tick();
  flush();
  await expect(p).resolves.toBe("same");
  // The landing never notified the graph — only the promise witnessed it.
  expect(effectRuns).toEqual(["same"]);
  dispose();
});

test("failed re-ask rejects with the error", async () => {
  const gates: ReturnType<typeof deferred<string>>[] = [];
  let m!: () => string;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    m = createMemo(() => {
      const gate = deferred<string>();
      gates.push(gate);
      return gate.promise as unknown as string;
    });
    createEffect(m, () => {});
  });
  flush();
  gates[0].resolve("v1");
  await tick();
  flush();

  const p = refresh(m);
  flush();
  await tick();
  gates[1].reject(new Error("refetch failed"));
  await tick();
  flush();
  await expect(p).rejects.toThrow("refetch failed");
  dispose();
});

test("fire-and-forget refresh with a failing re-ask surfaces no unhandled rejection", async () => {
  const gates: ReturnType<typeof deferred<string>>[] = [];
  let m!: () => string;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    m = createMemo(() => {
      const gate = deferred<string>();
      gates.push(gate);
      return gate.promise as unknown as string;
    });
    createEffect(m, () => {});
  });
  flush();
  gates[0].resolve("v1");
  await tick();
  flush();

  refresh(m); // statement position — promise ignored
  flush();
  await tick();
  gates[1].reject(new Error("nobody listening"));
  // Drain enough turns that an unhandled rejection would have been reported
  // (vitest fails the test run on any).
  await tick();
  await tick();
  flush();
  dispose();
});

test("supersession: waiters from both refreshes deliver the final landing", async () => {
  const gates: ReturnType<typeof deferred<string>>[] = [];
  let m!: () => string;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    m = createMemo(() => {
      const gate = deferred<string>();
      gates.push(gate);
      return gate.promise as unknown as string;
    });
    createEffect(m, () => {});
  });
  flush();
  gates[0].resolve("v1");
  await tick();
  flush();

  const p1 = refresh(m);
  flush();
  await tick();
  const p2 = refresh(m); // supersedes flight 2 with flight 3
  flush();
  await tick();

  // The superseded flight landing is ignored — not delivered to anyone.
  gates[1].resolve("stale");
  await tick();
  flush();
  gates[2].resolve("final");
  await tick();
  flush();
  await expect(p1).resolves.toBe("final");
  await expect(p2).resolves.toBe("final");
  expect(m()).toBe("final");
  dispose();
});

test("store target resolves with the node passed (root and nested)", async () => {
  let runs = 0;
  let proj!: { profile: { value: number } };
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    proj = createProjection(
      async draft => {
        await Promise.resolve();
        draft.profile.value = ++runs;
      },
      { profile: { value: 0 } }
    );
  });
  flush();
  await tick();
  expect(proj.profile.value).toBe(1);

  const p = refresh(proj as any);
  flush();
  await tick();
  await expect(p).resolves.toBe(proj);
  expect(proj.profile.value).toBe(2);

  // A nested node re-asks the same family projection but resolves with the
  // node the caller was looking at.
  const p2 = refresh(proj.profile as any);
  flush();
  await tick();
  await expect(p2).resolves.toBe(proj.profile);
  expect(proj.profile.value).toBe(3);
  dispose();
});

test("yield refresh in an action: staged landing delivers, the override does not", async () => {
  let server = "v1";
  let m!: () => string;
  let opt!: () => string;
  let setOpt!: (v: string) => void;
  const views: string[] = [];
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    m = createMemo(() => Promise.resolve().then(() => server) as unknown as string);
    const [o, so] = createOptimistic(() => m());
    opt = o;
    setOpt = so;
    createEffect(
      () => opt(),
      v => void views.push(v)
    );
  });
  flush();
  await tick();
  flush();
  expect(views.at(-1)).toBe("v1");

  let delivered: string | undefined;
  const hold = deferred();
  const act = action(async function* () {
    setOpt("optimistic");
    server = "v2";
    delivered = (yield refresh(m)) as string;
    // Keep the transaction open past the delivery so the mid-hold state is
    // observable from the test.
    yield hold.promise;
  });
  const done = act();
  flush();
  await tick();
  flush();
  await tick();
  // Mid-hold: the app sees the override; the promise delivered the STAGED
  // landing (the transaction cannot commit v2 while the action holds it).
  expect(views.at(-1)).toBe("optimistic");
  expect(delivered).toBe("v2");

  hold.resolve();
  await done;
  flush();
  // Settlement reveals the committed truth.
  expect(opt()).toBe("v2");
  expect(views.at(-1)).toBe("v2");
  dispose();
});

test("disposed target: already quiescent — resolves immediately with the last value", async () => {
  let m!: () => number;
  const d = createRoot(dispose => {
    m = createMemo(() => 42);
    createEffect(m, () => {});
    return dispose;
  });
  flush();
  expect(m()).toBe(42);
  d();
  await expect(refresh(m)).resolves.toBe(42);
});

test("iterable-backed source: resolves at the fresh iteration's first yield", async () => {
  type Pump<T> = { iterable: AsyncIterable<T>; push: (v: T) => void; returns: number };
  function pump<T>(): Pump<T> {
    let waiter: ((r: IteratorResult<T>) => void) | null = null;
    const buffered: IteratorResult<T>[] = [];
    const self: Pump<T> = {
      returns: 0,
      iterable: {
        [Symbol.asyncIterator]: () => ({
          next: () =>
            new Promise<IteratorResult<T>>(res => {
              if (buffered.length) res(buffered.shift()!);
              else waiter = res;
            }),
          return: () => {
            self.returns++;
            return Promise.resolve({ done: true as const, value: undefined });
          }
        })
      },
      push(value: T) {
        const r = { done: false as const, value };
        if (waiter) {
          const w = waiter;
          waiter = null;
          w(r);
        } else buffered.push(r);
      }
    };
    return self;
  }

  const streams = [pump<number>(), pump<number>()];
  let run = 0;
  let m!: () => number;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    m = createMemo(() => streams[run++].iterable as unknown as number);
    createEffect(m, () => {});
  });
  flush();
  streams[0].push(1);
  await tick();
  flush();
  expect(m()).toBe(1);

  let settled = false;
  const p = refresh(m).then(v => ((settled = true), v));
  flush();
  await tick();
  // Old iteration closed (supersession), fresh one pumping, promise waiting
  // on its first yield.
  expect(streams[0].returns).toBe(1);
  expect(settled).toBe(false);

  streams[1].push(2);
  await tick();
  flush();
  await expect(p).resolves.toBe(2);
  expect(m()).toBe(2);
  dispose();
});

test("plain signal accessor: refresh is a no-op — already quiescent, resolves with the value", async () => {
  const [count] = createSignal(1);
  await expect(refresh(count as any)).resolves.toBe(1);
});
