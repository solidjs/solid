/** @vitest-environment jsdom */
// ssrSource "hybrid" store handoff (#3498). Server is truth; the client's
// run during hydration is a trace whose first yield duplicates what the
// server serialized. Four rules govern the handoff from the adopted server
// answer to the live client source:
//
// 1. The handoff waits for the first server answer to LAND — synchronous when
//    the serialized value is already settled, otherwise at the landing
//    (resolve or reject). Never at hydration end; hydration is never held.
// 2. Only the handoff run's first yield is the duplicate. Later runs
//    (dependency change, refresh()) commit their first yield normally.
// 3. A rejected server answer is the adopted answer: the store surfaces the
//    error until a later, non-handoff run replaces it.
// 4. A dependency change before the pending answer lands supersedes it: the
//    client takes over on that run (its first yield commits — not a
//    handoff), and the abandoned server flight's landing or rejection is
//    dropped.
//
// The handoff is for STREAMS. A sync or promise-shaped hybrid source has no
// iteration for the client to continue — a handoff run would only refetch
// what the server serialized — so for those shapes `"hybrid"` is identical
// to `"server"`: the adopted answer is final until a dependency changes or
// `refresh()` (maintainer ruling: hybrid is only for streams realistically;
// memos and function-form signals already behaved this way). The adoption
// pass detects the shape and arms the handoff only for an async iterable.
//
// Harness notes: `stopHydration()` ends the synchronous claim pass (the
// snapshot scope releases, as `hydrate()` does at the end of its pass). With
// a streamed <Loading> boundary still pending, hydration is NOT done after
// that — `sharedConfig.done` stays false and onHydrationEnd callbacks wait —
// which is the window these rules are about.
//
// The pins for rules 1 and 3 adapt the tests Monkeylordz wrote for #3499.
import { afterEach, describe, expect, test } from "vitest";
import {
  createLoadingBoundary,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  NotReadyError,
  refresh
} from "@solidjs/signals";
import {
  enableHydration,
  sharedConfig,
  createMemo,
  createProjection,
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

// The adoption pass runs the source once as a TRACE under a MockPromise swap
// of the global (subFetch). That run is never consumed, so it is not a
// start: count only runs under the real Promise.
const RealPromise = Promise;

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
    // The client source's await point, released by the test. (Not a timer:
    // the handoff run starts on a microtask after the retry's flush, so a
    // `sleep(1)` inside the source raced the test's own `sleep(10)` — one
    // stalled scheduling tick of ≥9ms on a loaded CI runner and the longer
    // timer, created first, fired first.)
    const answer = deferred<void>();
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        // A client-only sibling is unasked through the claim pass: the hybrid
        // store's trace reads it synchronously and suspends, so the creation
        // run does not land the server answer — a later retry run does. The
        // read happens OUTSIDE the generator (a generator body's throw is a
        // rejected step, not a sync throw), and the source is a stream: only
        // an async-iterable shape hands off.
        const clientOnly = createMemo(() => 40, { ssrSource: "client" });
        return createStore<Counter>(
          draft => {
            const base = clientOnly();
            return (async function* () {
              await answer.promise;
              draft.count = base + 1;
              yield;
              draft.count = base + 2;
              yield;
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
      // the handoff follows it on a microtask and runs the client source.
      expect(state.count).toBe(5);
      await tick();
      expect(state.count).toBe(5);
      // The handoff run's first yield is the duplicate; the second commits.
      answer.resolve();
      await tick();
      expect(state.count).toBe(42);
    } finally {
      answer.resolve();
      dispose();
    }
  });

  test("a promise-shaped source whose adoption retries (NotReady trace) adopts and latches: no handoff", async () => {
    startHydration({ t1: { v: { count: 5 }, s: 1 } });
    const [version, setVersion] = createSignal(1);
    let starts = 0;
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        const clientOnly = createMemo(() => 40, { ssrSource: "client" });
        return createStore<Counter>(
          // The sibling read is synchronous (outside any async body) so the
          // trace suspends synchronously; the answer is promise-shaped.
          () => {
            const base = clientOnly() + version();
            if (Promise === RealPromise) starts++;
            return Promise.resolve({ count: base });
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
      expect(state.count).toBe(5);
      await tick();
      // The retry's adoption is final: no client run follows it.
      expect(state.count).toBe(5);
      expect(starts).toBe(0);
      // A dependency change is a real run, as under "server".
      setVersion(2);
      await tick();
      expect(state.count).toBe(42);
      expect(starts).toBe(1);
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

  test("a later run of a promise-shaped mutation source writes to the real draft (no handoff run precedes it)", async () => {
    startHydration({ t0: { v: { count: 5 }, s: 1 } });
    const [version, setVersion] = createSignal(1);
    // One gate per real run, resolved by the test: the runs start on a
    // microtask after the test's own step, so a real timer inside the source
    // would race a real timer in the test (the CI flake in rule 1's NotReady
    // case). The hydration trace runs execute the source under a MockPromise
    // swap (subFetch); their gates are inert — never consumed — and not
    // recorded.
    const gates: Array<ReturnType<typeof deferred<void>>> = [];
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        return createStore<Counter>(
          async draft => {
            const v = version();
            const gate = deferred<void>();
            if (Promise === RealPromise) gates.push(gate);
            await gate.promise;
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
      await tick();
      // Promise-shaped: no handoff run. The adopted answer stands and the
      // client source has not started.
      expect(gates.length).toBe(0);
      expect(state.count).toBe(5);
      // The first real run is the dependency change; it writes the real draft.
      setVersion(2);
      await tick();
      expect(gates.length).toBe(1);
      gates.splice(0).forEach(g => g.resolve());
      await tick();
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

describe("hybrid store handoff — rule 4: a dependency change before the landing supersedes the server answer", () => {
  afterEach(stopHydration);

  // The source counts its runs: the adopt trace pulls the generator once
  // (run 1), so any run past the takeover is an extra run.
  function counted(version: () => number) {
    let runs = 0;
    const source = async function* (draft: Counter) {
      runs++;
      draft.count = version();
      yield;
    };
    return { source, runs: () => runs };
  }

  for (const [name, create] of families) {
    test(`${name}: the client takes over on the change, its first yield commits, and the late landing is ignored`, async () => {
      const server = deferred<Counter>();
      startHydration({ t0: server.promise });
      const [version, setVersion] = createSignal(1);
      const { source, runs } = counted(version);
      let dispose!: () => void;
      const [state] = createRoot(
        d => {
          dispose = d;
          return create<Counter>(source, { count: 0 }, { ssrSource: "hybrid" });
        },
        { id: "t" }
      );
      try {
        flush();
        expect(() => state.count).toThrow(NotReadyError);
        expect(runs()).toBe(1);
        stopHydration();
        await tick();
        expect(() => state.count).toThrow(NotReadyError);
        // (a) A dependency changes while the server answer is still pending:
        // the client is authoritative from this run, and it is not a handoff
        // — its first yield commits.
        setVersion(2);
        await tick();
        expect(state.count).toBe(2);
        expect(runs()).toBe(2);
        // (b) The abandoned server answer lands: dropped, no run, no flip.
        server.resolve({ count: 5 });
        await tick();
        expect(state.count).toBe(2);
        expect(runs()).toBe(2);
        await tick();
        expect(state.count).toBe(2);
        expect(runs()).toBe(2);
        // Live: a later change runs the client source as usual.
        setVersion(3);
        await tick();
        expect(state.count).toBe(3);
        expect(runs()).toBe(3);
      } finally {
        dispose();
      }
    });
  }

  test("the abandoned server flight's rejection is dropped: no error surfaces", async () => {
    const server = deferred<Counter>();
    startHydration({ t0: server.promise });
    const [version, setVersion] = createSignal(1);
    const { source, runs } = counted(version);
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        return createStore<Counter>(source, { count: 0 }, { ssrSource: "hybrid" });
      },
      { id: "t" }
    );
    try {
      flush();
      stopHydration();
      await tick();
      expect(() => state.count).toThrow(NotReadyError);
      setVersion(2);
      await tick();
      expect(state.count).toBe(2);
      // (c) The superseded flight rejects: not the store's answer any more.
      server.reject(new Error("server failed"));
      await tick();
      expect(state.count).toBe(2);
      expect(runs()).toBe(2);
      await tick();
      expect(state.count).toBe(2);
      expect(runs()).toBe(2);
    } finally {
      dispose();
    }
  });

  test("under seedLoadingValue: the client takes over from commit #0 and the late landing is ignored", async () => {
    const server = deferred<Counter>();
    startHydration({ t0: server.promise });
    const [version, setVersion] = createSignal(1);
    const { source, runs } = counted(version);
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        return createStore<Counter>(
          source,
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
      expect(runs()).toBe(1);
      // (d) The dependency change supersedes the pending placeholder's answer.
      setVersion(2);
      await tick();
      expect(state.count).toBe(2);
      expect(runs()).toBe(2);
      server.resolve({ count: 5 });
      await tick();
      expect(state.count).toBe(2);
      expect(runs()).toBe(2);
    } finally {
      dispose();
    }
  });

  test("a settled answer deferred by the loading window is superseded the same way", async () => {
    // The settled ref's landing is deferred past the claim walk (a pending
    // flight from the engine's view); a change before that microtask wins.
    const settled: any = Promise.resolve({ count: 5 });
    settled.s = 1;
    settled.v = { count: 5 };
    startHydration({ t0: settled });
    const [version, setVersion] = createSignal(1);
    const { source, runs } = counted(version);
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        return createStore<Counter>(
          source,
          { count: 0 },
          { ssrSource: "hybrid", seedLoadingValue: true }
        );
      },
      { id: "t" }
    );
    try {
      flush();
      expect(state.count).toBe(0);
      expect(runs()).toBe(1);
      stopHydration();
      // The pass has ended but the deferred landing's microtask has not run.
      setVersion(2);
      flush();
      await tick();
      expect(state.count).toBe(2);
      expect(runs()).toBe(2);
      await tick();
      expect(state.count).toBe(2);
      expect(runs()).toBe(2);
    } finally {
      dispose();
    }
  });
});

describe("hybrid store handoff — rule 5: the handoff opens no pending window (#3574)", () => {
  afterEach(stopHydration);

  // The handoff run continues the adopted answer's stream (#3551: the server
  // consumes one yield, the client continues the iteration), and a stream is
  // not pending between yields — the adopted answer is step 0, the client's
  // first yield its duplicate. So the store reads settled from the landing
  // until the client source yields something NEW; `isPending` does not read
  // true over the initial load, and the handoff is its tail (maintainer
  // ruling). Pinned through a consumer born after the landing — the
  // shape of a streamed <Loading> resuming to claim its fragment while the
  // handoff run is in flight — and through `isPending` directly.
  function mount(state: Counter) {
    // `isPending` reads under the boundary too: an unanswered store suspends
    // that read the same way it suspends the value read.
    let view: string | { text: string; pending: boolean };
    const dispose = createRoot(d => {
      const boundary = createLoadingBoundary(
        () => ({ text: `content:${state.count}`, pending: isPending(() => state.count) }),
        () => "fallback" as const
      );
      createRenderEffect(boundary, v => {
        view = v;
      });
      return d;
    });
    flush();
    return {
      view: () => (typeof view === "string" ? view : view.text),
      pending: () => (typeof view === "string" ? undefined : view.pending),
      dispose
    };
  }

  test("generator: a boundary created before the client's first yield shows the adopted answer", async () => {
    const server = deferred<Counter>();
    const first = deferred<void>();
    const second = deferred<void>();
    startHydration({ t0: server.promise });
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        return createStore<Counter>(
          async function* (draft) {
            await first.promise;
            draft.count = 1;
            yield;
            await second.promise;
            draft.count = 2;
            yield;
          },
          { count: 0 },
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );
    let consumer: ReturnType<typeof mount> | undefined;
    try {
      flush();
      stopHydration();
      await tick();
      // Before the landing the store is genuinely unanswered: a boundary
      // created now shows its fallback (the shell's fallback is legitimate).
      expect(() => state.count).toThrow(NotReadyError);
      consumer = mount(state);
      expect(consumer.view()).toBe("fallback");
      consumer.dispose();

      server.resolve({ count: 5 });
      await tick();
      expect(state.count).toBe(5);
      // The handoff run is in flight (`first` is closed). A boundary created
      // now reads the answer, and nothing is pending — no new question is in
      // flight, the answer is the one on screen.
      consumer = mount(state);
      expect(consumer.view()).toBe("content:5");
      expect(consumer.pending()).toBe(false);

      // The duplicate first yield lands silently; the next one updates.
      first.resolve();
      await tick();
      expect(state.count).toBe(5);
      expect(consumer.view()).toBe("content:5");
      expect(consumer.pending()).toBe(false);
      second.resolve();
      await tick();
      expect(state.count).toBe(2);
      expect(consumer.view()).toBe("content:2");
    } finally {
      first.resolve();
      second.resolve();
      consumer?.dispose();
      dispose();
    }
  });

  test("promise: no handoff — the adopted answer is final, nothing is pending, the client source never starts", async () => {
    const server = deferred<Counter>();
    startHydration({ t0: server.promise });
    let starts = 0;
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        return createStore<Counter>(
          async () => {
            if (Promise === RealPromise) starts++;
            // A handoff run would land this and be observable; the ruling is
            // that there is no such run for a promise-shaped source.
            return { count: 6 };
          },
          { count: 0 },
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );
    let consumer: ReturnType<typeof mount> | undefined;
    try {
      flush();
      stopHydration();
      await tick();
      expect(() => state.count).toThrow(NotReadyError);
      expect(starts).toBe(0);

      server.resolve({ count: 5 });
      await tick();
      expect(state.count).toBe(5);
      consumer = mount(state);
      expect(consumer.view()).toBe("content:5");
      expect(consumer.pending()).toBe(false);

      await tick();
      await tick();
      expect(state.count).toBe(5);
      expect(consumer.view()).toBe("content:5");
      expect(consumer.pending()).toBe(false);
      expect(starts).toBe(0);
    } finally {
      consumer?.dispose();
      dispose();
    }
  });

  test("promise: a rejecting client run after the adoption (refresh) still surfaces its error", async () => {
    const server = deferred<Counter>();
    startHydration({ t0: server.promise });
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        return createStore<Counter>(
          async () => {
            throw new Error("client failed");
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
      server.resolve({ count: 5 });
      await tick();
      // No handoff run: the client source's rejection does not replace the
      // adopted answer on its own.
      expect(state.count).toBe(5);
      await tick();
      expect(state.count).toBe(5);
      // A real run (refresh) does, as under "server".
      await refresh(state).catch(() => {});
      await tick();
      expect(() => state.count).toThrow("client failed");
    } finally {
      dispose();
    }
  });

  test("a client-only mount (no hydration) still shows the fallback until the first value", async () => {
    // The quiet window is a HANDOFF property: outside hydration there is no
    // adopted answer, so a fresh async store suspends its boundary as ever.
    const gate = deferred<void>();
    let dispose!: () => void;
    const [state] = createRoot(d => {
      dispose = d;
      return createStore<Counter>(
        async function* (draft) {
          await gate.promise;
          draft.count = 1;
          yield;
        },
        { count: 0 },
        { ssrSource: "hybrid" }
      );
    });
    let consumer: ReturnType<typeof mount> | undefined;
    try {
      flush();
      expect(() => state.count).toThrow(NotReadyError);
      consumer = mount(state);
      expect(consumer.view()).toBe("fallback");
      gate.resolve();
      await tick();
      expect(state.count).toBe(1);
      expect(consumer.view()).toBe("content:1");
    } finally {
      gate.resolve();
      consumer?.dispose();
      dispose();
    }
  });
});

describe('hybrid store — non-iterable shapes latch: identical to "server" (maintainer ruling)', () => {
  afterEach(stopHydration);

  // A `version`-reading source of each non-iterable shape. Real runs are
  // counted under the real Promise only (the adoption pass traces the source
  // under subFetch's MockPromise swap; a trace is not a run).
  type Shape = readonly [
    string,
    (version: () => number, starts: () => void) => (draft: Counter) => any
  ];
  const shapes: readonly Shape[] = [
    [
      "sync mutation",
      (version, starts) => draft => {
        if (Promise === RealPromise) starts();
        draft.count = version();
      }
    ],
    [
      "sync return",
      (version, starts) => () => {
        if (Promise === RealPromise) starts();
        return { count: version() };
      }
    ],
    [
      "promise",
      (version, starts) => async () => {
        if (Promise === RealPromise) starts();
        return { count: version() };
      }
    ]
  ];

  // The observable sequence of a store through hydration and its first
  // post-hydration change: what it reads at each step and how many real runs
  // the client source has made.
  async function observe(
    create: (typeof families)[number][1],
    shape: Shape[1],
    ssrSource: "server" | "hybrid",
    serialized: any
  ) {
    startHydration({ t0: serialized });
    const [version, setVersion] = createSignal(1);
    let starts = 0;
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        return create<Counter>(
          shape(version, () => starts++),
          { count: 0 },
          { ssrSource }
        );
      },
      { id: "t" }
    );
    const read = () => {
      try {
        return state.count;
      } catch (e) {
        return e instanceof NotReadyError ? "pending" : `error:${(e as Error).message}`;
      }
    };
    const seq: Array<[string, any, number]> = [];
    try {
      flush();
      seq.push(["claim pass", read(), starts]);
      stopHydration();
      await tick();
      seq.push(["hydration done", read(), starts]);
      await tick();
      await tick();
      seq.push(["settled", read(), starts]);
      setVersion(2);
      await tick();
      seq.push(["dependency change", read(), starts]);
      await refresh(state).catch(() => {});
      await tick();
      seq.push(["refresh", read(), starts]);
    } finally {
      stopHydration();
      dispose();
    }
    return seq;
  }

  for (const [family, create] of families) {
    for (const [shapeName, shape] of shapes) {
      test(`${family} / ${shapeName}: settled answer — adopted, no client run until a dependency changes`, async () => {
        const hybrid = await observe(create, shape, "hybrid", { v: { count: 5 }, s: 1 });
        expect(hybrid).toEqual([
          ["claim pass", 5, 0],
          ["hydration done", 5, 0],
          ["settled", 5, 0],
          ["dependency change", 2, 1],
          ["refresh", 2, 2]
        ]);
        const server = await observe(create, shape, "server", { v: { count: 5 }, s: 1 });
        expect(hybrid).toEqual(server);
      });

      test(`${family} / ${shapeName}: rejected answer — adopted, no client run until refresh`, async () => {
        const rejected = { v: new Error("server failed"), s: 2 };
        const hybrid = await observe(create, shape, "hybrid", rejected);
        expect(hybrid).toEqual([
          ["claim pass", "error:server failed", 0],
          ["hydration done", "error:server failed", 0],
          ["settled", "error:server failed", 0],
          ["dependency change", 2, 1],
          ["refresh", 2, 2]
        ]);
        const server = await observe(create, shape, "server", rejected);
        expect(hybrid).toEqual(server);
      });
    }
  }

  test("createProjection / promise: settled answer — adopted, no client run until a dependency changes", async () => {
    startHydration({ t0: { v: { count: 5 }, s: 1 } });
    const [version, setVersion] = createSignal(1);
    let starts = 0;
    let dispose!: () => void;
    const state = createRoot(
      d => {
        dispose = d;
        return createProjection<Counter>(
          async () => {
            if (Promise === RealPromise) starts++;
            return { count: version() };
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
      await tick();
      expect(state.count).toBe(5);
      expect(starts).toBe(0);
      setVersion(2);
      await tick();
      expect(state.count).toBe(2);
      expect(starts).toBe(1);
    } finally {
      dispose();
    }
  });

  test("promise: a still-pending answer lands and latches; isPending reads false through the landing", async () => {
    const server = deferred<Counter>();
    startHydration({ t0: server.promise });
    let starts = 0;
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        return createStore<Counter>(
          async () => {
            if (Promise === RealPromise) starts++;
            return { count: 6 };
          },
          { count: 0 },
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );
    let view: any;
    let consumerDispose: (() => void) | undefined;
    try {
      flush();
      stopHydration();
      await tick();
      expect(() => state.count).toThrow(NotReadyError);
      server.resolve({ count: 5 });
      await tick();
      expect(state.count).toBe(5);
      consumerDispose = createRoot(d => {
        createRenderEffect(
          () => ({ count: state.count, pending: isPending(() => state.count) }),
          v => {
            view = v;
          }
        );
        return d;
      });
      flush();
      expect(view).toEqual({ count: 5, pending: false });
      await tick();
      await tick();
      expect(view).toEqual({ count: 5, pending: false });
      expect(starts).toBe(0);
    } finally {
      consumerDispose?.();
      dispose();
    }
  });

  test("promise + seedLoadingValue: the deferred settled landing is adopted, not superseded by a client run", async () => {
    // The settled ref's landing is deferred past the claim walk under a
    // loading window (readHydratedValue). Before the ruling the creation flip
    // ran the client source as a handoff that superseded that landing; now
    // the landing itself is the answer and the source does not run.
    const settled: any = Promise.resolve({ count: 5 });
    settled.s = 1;
    settled.v = { count: 5 };
    startHydration({ t0: settled });
    const [version, setVersion] = createSignal(1);
    let starts = 0;
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        return createStore<Counter>(
          async () => {
            if (Promise === RealPromise) starts++;
            return { count: version() };
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
      expect(state.count).toBe(5);
      await tick();
      expect(state.count).toBe(5);
      expect(starts).toBe(0);
      setVersion(2);
      await tick();
      expect(state.count).toBe(2);
      expect(starts).toBe(1);
    } finally {
      dispose();
    }
  });

  test("the async-iterable shape still hands off (the trace decides the shape, not the option)", async () => {
    startHydration({ t0: { v: { count: 5 }, s: 1 } });
    let starts = 0;
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        return createStore<Counter>(
          async function* (draft) {
            if (Promise === RealPromise) starts++;
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
      expect(starts).toBe(1);
      expect(state.count).toBe(2);
    } finally {
      dispose();
    }
  });
});
