/** @vitest-environment jsdom */
// ssrSource "hybrid" store handoff (#3498). Server is truth; the client's
// run during hydration is a trace whose first yield duplicates what the
// server serialized. Three rules govern the handoff from the adopted server
// answer to the live client source:
//
// 1. The handoff waits for the first server answer to LAND — synchronous when
//    the serialized value is already settled, otherwise at the landing
//    (resolve or reject). Never at hydration end; hydration is never held.
// 2. Only the handoff run's first yield is the duplicate. Later runs
//    (dependency change, refresh()) commit their first yield normally.
// 3. A rejected server answer is the adopted answer: the store surfaces the
//    error until a later, non-handoff run replaces it.
//
// Harness notes: `stopHydration()` ends the synchronous claim pass (the
// snapshot scope releases, as `hydrate()` does at the end of its pass). With
// a streamed <Loading> boundary still pending, hydration is NOT done after
// that — `sharedConfig.done` stays false and onHydrationEnd callbacks wait —
// which is the window these rules are about.
//
// The pins for rules 1 and 3 adapt the tests Monkeylordz wrote for #3499.
import { afterEach, describe, expect, test } from "vitest";
import { createRoot, createSignal, flush, NotReadyError, refresh } from "@solidjs/signals";
import {
  enableHydration,
  sharedConfig,
  createMemo,
  createStore,
  createOptimisticStore
} from "../src/client/hydration.js";
import { Loading } from "../src/client/flow.js";

enableHydration();

function startHydration(data: Record<string, any>) {
  sharedConfig.hydrating = true;
  sharedConfig.has = id => id in data;
  sharedConfig.load = id => data[id];
}
function stopHydration() {
  sharedConfig.hydrating = false;
  sharedConfig.has = undefined;
  sharedConfig.load = undefined;
  delete (globalThis as any)._$HY;
}
const tick = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
  flush();
};
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Observed here so a rejection the store never adopts (disposal before the
  // landing) is not an unhandled rejection in the test runner.
  promise.catch(() => {});
  return { promise, resolve, reject };
}
// A streamed boundary's serialized ref: pending until the chunk arrives.
function pendingBoundary() {
  let resolve!: () => void;
  const promise: any = new Promise<void>(r => {
    resolve = () => {
      promise.s = 1;
      promise.v = true;
      r();
    };
  });
  return { promise, resolve };
}

type Counter = { count: number };
const families = [
  ["createStore", createStore],
  ["createOptimisticStore", createOptimisticStore]
] as const;

describe("hybrid store handoff — rule 1: waits for the first server answer to land", () => {
  afterEach(stopHydration);

  for (const [name, create] of families) {
    test(`${name}: a pending answer under seedLoadingValue lands when it arrives, not at the pass end`, async () => {
      const server = deferred<Counter>();
      startHydration({ t0: server.promise });
      const [version, setVersion] = createSignal(1);
      let dispose!: () => void;
      const [state] = createRoot(
        d => {
          dispose = d;
          return create<Counter>(
            async function* (draft) {
              draft.count = version();
              yield;
            },
            { count: 0 },
            { ssrSource: "hybrid", seedLoadingValue: true }
          );
        },
        { id: "t" }
      );
      try {
        // Commit #0 serves through the claim pass.
        flush();
        expect(state.count).toBe(0);
        // The pass ends with the server answer still pending: no takeover
        // supersedes the server flight.
        stopHydration();
        await tick();
        expect(state.count).toBe(0);
        // The late answer is authoritative and lands on arrival.
        server.resolve({ count: 5 });
        await tick();
        expect(state.count).toBe(5);
        // The handoff run's first yield (count = 1) is the duplicate.
        await tick();
        expect(state.count).toBe(5);
        // Rule 2: a later run's first yield commits.
        setVersion(2);
        await tick();
        expect(state.count).toBe(2);
      } finally {
        dispose();
      }
    });

    test(`${name}: a pending answer without a loading window lands on arrival and the client continues from it`, async () => {
      const server = deferred<Counter>();
      const gate = deferred<void>();
      startHydration({ t0: server.promise });
      let dispose!: () => void;
      const [state] = createRoot(
        d => {
          dispose = d;
          return create<Counter>(
            async function* (draft) {
              draft.count = 1;
              yield;
              await gate.promise;
              draft.count = 2;
              yield;
            },
            { count: 0 },
            { ssrSource: "hybrid" }
          );
        },
        { id: "t" }
      );
      try {
        flush();
        expect(() => state.count).toThrow(NotReadyError);
        stopHydration();
        await tick();
        expect(() => state.count).toThrow(NotReadyError);
        server.resolve({ count: 5 });
        await tick();
        expect(state.count).toBe(5);
        // The handoff happened at the landing: the client generator is
        // running (its first yield absorbed) and continues.
        gate.resolve();
        await tick();
        expect(state.count).toBe(2);
      } finally {
        gate.resolve();
        dispose();
      }
    });
  }

  test("the handoff does not wait for hydration end (a streamed boundary still pending)", async () => {
    const server = deferred<Counter>();
    const gate = deferred<void>();
    const boundary = pendingBoundary();
    (globalThis as any)._$HY = {
      modules: {},
      loading: {},
      r: { t0: server.promise, t1: boundary.promise },
      events: [],
      completed: new WeakSet()
    };
    startHydration({ t0: server.promise, t1: boundary.promise });
    let dispose!: () => void;
    let state!: Counter;
    createRoot(
      d => {
        dispose = d;
        [state] = createStore<Counter>(
          async function* (draft) {
            draft.count = 1;
            yield;
            await gate.promise;
            draft.count = 2;
            yield;
          },
          { count: 0 },
          { ssrSource: "hybrid", seedLoadingValue: true }
        );
        Loading({
          fallback: "loading...",
          get children() {
            return "content" as any;
          }
        });
      },
      { id: "t" }
    );
    try {
      flush();
      expect(state.count).toBe(0);
      // The claim pass ends, but the boundary keeps hydration open.
      stopHydration();
      let ended = false;
      sharedConfig.onHydrationEnd!(() => (ended = true));
      await tick();
      expect(sharedConfig.done).toBe(false);
      expect(ended).toBe(false);
      expect(state.count).toBe(0);
      // Server answer lands and hands off while hydration is still open.
      server.resolve({ count: 5 });
      await tick();
      expect(state.count).toBe(5);
      gate.resolve();
      await tick();
      expect(state.count).toBe(2);
      expect(sharedConfig.done).toBe(false);
      expect(ended).toBe(false);
      // Hydration end changes nothing for the store.
      boundary.resolve();
      await tick();
      expect(ended).toBe(true);
      expect(state.count).toBe(2);
    } finally {
      gate.resolve();
      dispose();
    }
  });

  test("hydration end is not held by a pending server answer, and the answer still lands after it", async () => {
    const server = deferred<Counter>();
    startHydration({ t0: server.promise });
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        return createStore<Counter>(
          async function* (draft) {
            draft.count = 1;
            yield;
          },
          { count: 0 },
          { ssrSource: "hybrid", seedLoadingValue: true }
        );
      },
      { id: "t" }
    );
    try {
      flush();
      let ended = false;
      sharedConfig.onHydrationEnd!(() => (ended = true));
      stopHydration();
      await tick();
      expect(ended).toBe(true);
      expect(sharedConfig.done).toBe(true);
      expect(state.count).toBe(0);
      server.resolve({ count: 5 });
      await tick();
      expect(state.count).toBe(5);
      await tick();
      expect(state.count).toBe(5);
    } finally {
      dispose();
    }
  });

  test("a settled answer whose landing the loading window defers is adopted before the handoff", async () => {
    // The wire shape of a settled ref: a promise object stamped s/v. Under a
    // loading window the client must not unwrap it during the claim walk, so
    // its landing is deferred a microtask (readHydratedValue).
    const settled: any = Promise.resolve({ count: 5 });
    settled.s = 1;
    settled.v = { count: 5 };
    startHydration({ t0: settled });
    const [version, setVersion] = createSignal(1);
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        return createStore<Counter>(
          async function* (draft) {
            draft.count = version();
            yield;
          },
          { count: 0 },
          { ssrSource: "hybrid", seedLoadingValue: true }
        );
      },
      { id: "t" }
    );
    try {
      flush();
      expect(state.count).toBe(0);
      // The settled ref lands on the microtask after the claim walk; the
      // handoff follows the landing instead of superseding it.
      stopHydration();
      await tick();
      expect(state.count).toBe(5);
      await tick();
      expect(state.count).toBe(5);
      setVersion(2);
      await tick();
      expect(state.count).toBe(2);
    } finally {
      dispose();
    }
  });

  test("a settled answer hands off at the end of the claim pass, as before", async () => {
    startHydration({ t0: { v: { count: 5 }, s: 1 } });
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        return createStore<Counter>(
          async function* (draft) {
            draft.count = 1;
            yield;
            draft.count = 2;
            yield;
          },
          { count: 0 },
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );
    try {
      flush();
      expect(state.count).toBe(5);
      stopHydration();
      await tick();
      expect(state.count).toBe(2);
    } finally {
      dispose();
    }
  });

  test("a settled answer whose adoption retries (NotReady trace) still hands off after it lands", async () => {
    startHydration({ t1: { v: { count: 5 }, s: 1 } });
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        // A client-only sibling is unasked through the claim pass: the hybrid
        // store's trace reads it synchronously and suspends, so the creation
        // run does not land the server answer — a later retry run does.
        const clientOnly = createMemo(() => 40, { ssrSource: "client" });
        return createStore<Counter>(
          () => {
            const base = clientOnly();
            return (async () => {
              await sleep(1);
              return { count: base + 1 };
            })();
          },
          { count: 0 },
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );
    try {
      flush();
      expect(() => state.count).toThrow(NotReadyError);
      stopHydration();
      flush();
      // The retry landed the server answer synchronously inside the flush;
      // the handoff follows it.
      expect(state.count).toBe(5);
      await sleep(10);
      flush();
      expect(state.count).toBe(41);
    } finally {
      dispose();
    }
  });

  test("no serialized entry: the client is authoritative from its first run", async () => {
    startHydration({});
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        return createStore<Counter>(
          async function* (draft) {
            draft.count = 1;
            yield;
          },
          { count: 0 },
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );
    try {
      flush();
      stopHydration();
      await tick();
      expect(state.count).toBe(1);
    } finally {
      dispose();
    }
  });
});

describe("hybrid store handoff — rule 2: only the handoff run's first yield is the duplicate", () => {
  afterEach(stopHydration);

  for (const [name, create] of families) {
    test(`${name}: refresh() after the handoff commits its first yield`, async () => {
      startHydration({ t0: { v: { count: 5 }, s: 1 } });
      let dispose!: () => void;
      const [state] = createRoot(
        d => {
          dispose = d;
          return create<Counter>(
            async function* (draft) {
              draft.count = 1;
              yield;
            },
            { count: 0 },
            { ssrSource: "hybrid" }
          );
        },
        { id: "t" }
      );
      try {
        flush();
        expect(state.count).toBe(5);
        stopHydration();
        await tick();
        // Handoff run: its single yield is the duplicate.
        expect(state.count).toBe(5);
        await refresh(state);
        await tick();
        expect(state.count).toBe(1);
      } finally {
        dispose();
      }
    });
  }

  test("a later run of a promise-shaped mutation source writes to the real draft", async () => {
    startHydration({ t0: { v: { count: 5 }, s: 1 } });
    const [version, setVersion] = createSignal(1);
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        return createStore<Counter>(
          async draft => {
            const v = version();
            await sleep(1);
            draft.count = v;
          },
          { count: 0 },
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );
    try {
      flush();
      expect(state.count).toBe(5);
      stopHydration();
      await sleep(10);
      flush();
      // Handoff run: its writes reproduce the server answer and are absorbed.
      expect(state.count).toBe(5);
      setVersion(2);
      await sleep(10);
      flush();
      expect(state.count).toBe(2);
    } finally {
      dispose();
    }
  });
});

describe("hybrid store handoff — rule 3: a rejected server answer is the adopted answer", () => {
  afterEach(stopHydration);

  test("a pending answer that rejects surfaces the error until refresh()", async () => {
    const server = deferred<Counter>();
    startHydration({ t0: server.promise });
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        return createStore<Counter>(
          async function* (draft) {
            draft.count = 2;
            yield;
          },
          { count: 0 },
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );
    try {
      flush();
      expect(() => state.count).toThrow(NotReadyError);
      stopHydration();
      await tick();
      expect(() => state.count).toThrow(NotReadyError);
      const error = new Error("server failed");
      server.reject(error);
      await tick();
      expect(() => state.count).toThrow(error.message);
      // No handoff run papers over the rejection.
      await tick();
      expect(() => state.count).toThrow(error.message);
      await refresh(state);
      await tick();
      expect(state.count).toBe(2);
    } finally {
      dispose();
    }
  });

  test("a pending answer under seedLoadingValue that rejects surfaces the error until refresh()", async () => {
    const server = deferred<Counter>();
    startHydration({ t0: server.promise });
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        return createStore<Counter>(
          async function* (draft) {
            draft.count = 2;
            yield;
          },
          { count: 0 },
          { ssrSource: "hybrid", seedLoadingValue: true }
        );
      },
      { id: "t" }
    );
    try {
      flush();
      expect(state.count).toBe(0);
      stopHydration();
      await tick();
      expect(state.count).toBe(0);
      const error = new Error("server failed");
      server.reject(error);
      await tick();
      expect(() => state.count).toThrow(error.message);
      await tick();
      expect(() => state.count).toThrow(error.message);
      await refresh(state);
      await tick();
      expect(state.count).toBe(2);
    } finally {
      dispose();
    }
  });

  test("a settled rejection surfaces the error until refresh()", async () => {
    const error = new Error("server failed");
    startHydration({ t0: { v: error, s: 2 } });
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        return createStore<Counter>(
          async function* (draft) {
            draft.count = 2;
            yield;
          },
          { count: 0 },
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );
    try {
      flush();
      expect(() => state.count).toThrow(error.message);
      stopHydration();
      await tick();
      expect(() => state.count).toThrow(error.message);
      await refresh(state);
      await tick();
      expect(state.count).toBe(2);
    } finally {
      dispose();
    }
  });
});
