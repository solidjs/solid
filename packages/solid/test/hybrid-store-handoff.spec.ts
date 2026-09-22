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
    // The client source's promise-shaped answer, released by the test. (Not a
    // timer: the handoff run starts on a microtask after the retry's flush,
    // so a `sleep(1)` inside the source raced the test's own `sleep(10)` —
    // one stalled scheduling tick of ≥9ms on a loaded CI runner and the
    // longer timer, created first, fired first.)
    const answer = deferred<void>();
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
            return answer.promise.then(() => ({ count: base + 1 }));
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
      // The handoff run's promise-shaped answer commits when it lands.
      answer.resolve();
      await tick();
      expect(state.count).toBe(41);
    } finally {
      answer.resolve();
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
    // One gate per run, resolved by the test: the runs start on a microtask
    // after the test's own step, so a real timer inside the source would race
    // a real timer in the test (the CI flake in rule 1's NotReady case).
    const gates: Array<ReturnType<typeof deferred<void>>> = [];
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        return createStore<Counter>(
          async draft => {
            const v = version();
            const gate = deferred<void>();
            gates.push(gate);
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
      // Handoff run (and the creation run's, absorbed): every run so far
      // reproduces the server answer. The hydration trace run executes the
      // source under a MockPromise swap (subFetch), so ITS gate is inert —
      // never consumed, nothing to resolve.
      const release = () =>
        gates.splice(0).forEach(g => typeof g.resolve === "function" && g.resolve());
      expect(gates.length).toBeGreaterThanOrEqual(1);
      release();
      await tick();
      expect(state.count).toBe(5);
      setVersion(2);
      await tick();
      expect(gates.length).toBeGreaterThanOrEqual(1);
      release();
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

  // The handoff run re-asks the question the adopted answer already answers,
  // and a re-ask of the same question is silent (05-async-data, `isPending`):
  // the store reads settled from the landing until the client source yields
  // something NEW. Pinned through a consumer born after the landing — the
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

  test("promise: a boundary created before the client's answer shows the adopted answer", async () => {
    const server = deferred<Counter>();
    const gate = deferred<void>();
    startHydration({ t0: server.promise });
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        return createStore<Counter>(
          async () => {
            await gate.promise;
            // The hybrid contract expects the client to reproduce the server
            // answer; a different value here only makes the landing
            // observable (the store reconciles what lands, as before).
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

      server.resolve({ count: 5 });
      await tick();
      expect(state.count).toBe(5);
      consumer = mount(state);
      expect(consumer.view()).toBe("content:5");
      expect(consumer.pending()).toBe(false);

      gate.resolve();
      await tick();
      expect(state.count).toBe(6);
      expect(consumer.view()).toBe("content:6");
      expect(consumer.pending()).toBe(false);
    } finally {
      gate.resolve();
      consumer?.dispose();
      dispose();
    }
  });

  test("promise: a rejecting handoff run still surfaces its error", async () => {
    const server = deferred<Counter>();
    const gate = deferred<void>();
    startHydration({ t0: server.promise });
    let dispose!: () => void;
    const [state] = createRoot(
      d => {
        dispose = d;
        return createStore<Counter>(
          async () => {
            await gate.promise;
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
      expect(state.count).toBe(5);
      gate.resolve();
      await tick();
      expect(() => state.count).toThrow("client failed");
    } finally {
      gate.resolve();
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
