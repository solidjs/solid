/** @vitest-environment jsdom */
// ssrSource "hybrid" handoff for the signal-shaped nodes — createMemo and
// function-form createSignal over an async generator (hydrateSignalLike,
// #2993). Server is truth; the node adopts the serialized first yield, and
// the client generator continues the iteration from it. The handoff follows
// the same rules the store's does (hybrid-store-handoff.spec.ts, #3498 /
// #3551 / #3593); this file pins them on the value-shaped path:
//
// 1. The handoff waits for the first server answer to LAND — synchronous when
//    the serialized value is already settled, otherwise at the landing. The
//    client generator does not start before it (the server flight is not
//    superseded), and hydration is never held.
// 2. Only the handoff run's first yield is the duplicate. Later runs
//    (dependency change, refresh()) commit their first yield normally.
// 3. A rejected server answer is the adopted answer: the node surfaces the
//    error until a later, non-handoff run replaces it.
// 4. A dependency change before the pending answer lands supersedes it: the
//    client takes over on that run (its first yield commits — not a
//    handoff), and the abandoned server flight's landing is dropped.
// 5. The handoff opens no pending window: the adopted answer is the handoff
//    stream's step 0, the client's first yield its duplicate, and a stream
//    is not pending between yields. A `<Loading>` created in the window
//    shows content; `isPending` reads false. Maintainer ruling: isPending
//    does not read true over the initial load; the handoff is its tail.
//
// Before this fix the value-shaped gate flipped at CREATION: the client
// generator started as a fresh flight before the server answer landed
// (pending from creation until its first yield, superseding the server
// flight), which reproduced #3574's key miss on a streamed <Loading> exactly.
//
// Harness notes: `stopHydration()` ends the synchronous claim pass (the
// snapshot scope releases, as `hydrate()` does at the end of its pass). With
// a streamed <Loading> boundary still pending, hydration is NOT done after
// that — `sharedConfig.done` stays false — which is the window these rules
// are about.
import { afterEach, describe, expect, test } from "vitest";
import {
  createLoadingBoundary,
  createRenderEffect,
  createRoot,
  flush,
  isPending,
  NotReadyError,
  refresh
} from "@solidjs/signals";
import {
  enableHydration,
  sharedConfig,
  createMemo,
  createSignal
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
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Observed here so a rejection the node never adopts (disposal before the
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
function counted<T>(body: () => AsyncGenerator<T>) {
  let starts = 0;
  const source = async function* () {
    if (Promise === RealPromise) starts++;
    yield* body();
  };
  return { source, starts: () => starts };
}

type Create = (fn: any, options: any) => () => number;
const families: ReadonlyArray<readonly [string, Create]> = [
  ["createMemo", (fn, options) => createMemo(fn, options)],
  ["createSignal(fn)", (fn, options) => createSignal(fn, options)[0]]
];

describe("hybrid memo/signal handoff — rule 1: waits for the first server answer to land", () => {
  afterEach(stopHydration);

  for (const [name, create] of families) {
    test(`${name}: a pending answer lands on arrival; the client generator starts then, not before, and continues from it`, async () => {
      const server = deferred<number>();
      const gate = deferred<void>();
      startHydration({ t0: server.promise });
      const { source, starts } = counted(async function* () {
        yield 1;
        await gate.promise;
        yield 2;
      });
      let dispose!: () => void;
      const read = createRoot(
        d => {
          dispose = d;
          return create(source, { ssrSource: "hybrid" });
        },
        { id: "t" }
      );
      try {
        flush();
        expect(() => read()).toThrow(NotReadyError);
        expect(starts()).toBe(0);
        // The pass ends with the server answer still pending: no takeover
        // supersedes the server flight — the client generator has not run.
        stopHydration();
        await tick();
        expect(() => read()).toThrow(NotReadyError);
        expect(starts(), "the client generator must not start before the answer lands").toBe(0);
        // The late answer is authoritative and lands on arrival; the handoff
        // run starts at the landing.
        server.resolve(5);
        await tick();
        expect(read()).toBe(5);
        expect(starts(), "the handoff run started once the answer landed").toBe(1);
        // Its first yield (1) is the duplicate: discarded.
        await tick();
        expect(read()).toBe(5);
        // The client continues from the adopted answer.
        gate.resolve();
        await tick();
        expect(read()).toBe(2);
        expect(starts()).toBe(1);
      } finally {
        gate.resolve();
        dispose();
      }
    });

    test(`${name}: a pending answer under loadingValue serves commit #0 through the pass and lands when it arrives`, async () => {
      const server = deferred<number>();
      startHydration({ t0: server.promise });
      const [version, setVersion] = createSignal(1);
      const { source, starts } = counted(async function* () {
        yield version();
      });
      let dispose!: () => void;
      const read = createRoot(
        d => {
          dispose = d;
          return create(source, { ssrSource: "hybrid", loadingValue: 0 });
        },
        { id: "t" }
      );
      try {
        // Commit #0 serves through the claim pass.
        flush();
        expect(read()).toBe(0);
        stopHydration();
        await tick();
        expect(read()).toBe(0);
        expect(starts()).toBe(0);
        server.resolve(5);
        await tick();
        expect(read()).toBe(5);
        expect(starts()).toBe(1);
        // The handoff run's first yield (version() = 1) is the duplicate.
        await tick();
        expect(read()).toBe(5);
        // Rule 2: a later run's first yield commits.
        setVersion(2);
        await tick();
        expect(read()).toBe(2);
      } finally {
        dispose();
      }
    });
  }

  test("the handoff does not wait for hydration end (a streamed boundary still pending)", async () => {
    const server = deferred<number>();
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
    let read!: () => number;
    createRoot(
      d => {
        dispose = d;
        read = createMemo(
          async function* () {
            yield 1;
            await gate.promise;
            yield 2;
          },
          { ssrSource: "hybrid", loadingValue: 0 }
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
      expect(read()).toBe(0);
      // The claim pass ends, but the boundary keeps hydration open.
      stopHydration();
      let ended = false;
      sharedConfig.onHydrationEnd!(() => (ended = true));
      await tick();
      expect(sharedConfig.done).toBe(false);
      expect(ended).toBe(false);
      expect(read()).toBe(0);
      // Server answer lands and hands off while hydration is still open.
      server.resolve(5);
      await tick();
      expect(read()).toBe(5);
      gate.resolve();
      await tick();
      expect(read()).toBe(2);
      expect(sharedConfig.done).toBe(false);
      expect(ended).toBe(false);
      // Hydration end changes nothing for the node.
      boundary.resolve();
      await tick();
      expect(ended).toBe(true);
      expect(read()).toBe(2);
    } finally {
      gate.resolve();
      dispose();
    }
  });

  test("a settled answer whose landing the loading window defers is adopted before the handoff", async () => {
    // The wire shape of a settled ref: a promise object stamped s/v. Under a
    // loading window the client must not unwrap it during the claim walk, so
    // its landing is deferred a microtask (readHydratedValue).
    const settled: any = Promise.resolve(5);
    settled.s = 1;
    settled.v = 5;
    startHydration({ t0: settled });
    const [version, setVersion] = createSignal(1);
    const { source, starts } = counted(async function* () {
      yield version();
    });
    let dispose!: () => void;
    const read = createRoot(
      d => {
        dispose = d;
        return createMemo(source, { ssrSource: "hybrid", loadingValue: 0 });
      },
      { id: "t" }
    );
    try {
      flush();
      expect(read()).toBe(0);
      expect(starts()).toBe(0);
      // The settled ref lands on the microtask after the claim walk; the
      // handoff follows the landing instead of superseding it.
      stopHydration();
      await tick();
      expect(read()).toBe(5);
      expect(starts()).toBe(1);
      await tick();
      expect(read()).toBe(5);
      setVersion(2);
      await tick();
      expect(read()).toBe(2);
    } finally {
      dispose();
    }
  });

  for (const [name, create] of families) {
    test(`${name}: a settled answer hands off at the end of the claim pass, as before (#2993)`, async () => {
      startHydration({ t0: { v: 5, s: 1 } });
      const gate = deferred<void>();
      const { source, starts } = counted(async function* () {
        yield 1;
        await gate.promise;
        yield 2;
      });
      let dispose!: () => void;
      const read = createRoot(
        d => {
          dispose = d;
          return create(source, { ssrSource: "hybrid" });
        },
        { id: "t" }
      );
      try {
        flush();
        expect(read()).toBe(5);
        stopHydration();
        await tick();
        // The handoff run is in flight; its first yield is the duplicate.
        expect(starts()).toBe(1);
        expect(read()).toBe(5);
        gate.resolve();
        await tick();
        expect(read()).toBe(2);
      } finally {
        gate.resolve();
        dispose();
      }
    });
  }

  test("no serialized entry: the client is authoritative from its first run", async () => {
    startHydration({});
    let dispose!: () => void;
    const read = createRoot(
      d => {
        dispose = d;
        return createMemo(
          async function* () {
            yield 1;
          },
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );
    try {
      flush();
      stopHydration();
      await tick();
      expect(read()).toBe(1);
    } finally {
      dispose();
    }
  });

  test("a promise-shaped compute has no handoff: the adopted answer lands and the client source is not run (#2993)", async () => {
    // Sync and promise-shaped hybrid computes adopt the serialized value; a
    // handoff run would be a client refetch. Only the async-iterable shape
    // continues the server's stream. The streamed shape: a boundary still
    // pending keeps hydration open, and — as under hydrate() — the registry
    // accessors stay installed past the claim pass.
    const server = deferred<number>();
    const boundary = pendingBoundary();
    (globalThis as any)._$HY = {
      modules: {},
      loading: {},
      r: { t0: server.promise, t1: boundary.promise },
      events: [],
      completed: new WeakSet()
    };
    startHydration({ t0: server.promise, t1: boundary.promise });
    let starts = 0;
    let dispose!: () => void;
    let read!: () => number;
    createRoot(
      d => {
        dispose = d;
        read = createMemo(
          async () => {
            if (Promise === RealPromise) starts++;
            await new Promise<void>(() => {});
            return 1;
          },
          { ssrSource: "hybrid" }
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
      expect(() => read()).toThrow(NotReadyError);
      sharedConfig.hydrating = false;
      await tick();
      expect(sharedConfig.done).toBe(false);
      expect(starts).toBe(0);
      server.resolve(5);
      await tick();
      expect(read()).toBe(5);
      await tick();
      expect(read()).toBe(5);
      expect(starts).toBe(0);
    } finally {
      boundary.resolve();
      dispose();
    }
  });
});

describe("hybrid memo/signal handoff — rule 2: only the handoff run's first yield is the duplicate", () => {
  afterEach(stopHydration);

  for (const [name, create] of families) {
    test(`${name}: refresh() after the handoff commits its first yield`, async () => {
      startHydration({ t0: { v: 5, s: 1 } });
      let dispose!: () => void;
      const read = createRoot(
        d => {
          dispose = d;
          return create(
            async function* () {
              yield 1;
            },
            { ssrSource: "hybrid" }
          );
        },
        { id: "t" }
      );
      try {
        flush();
        expect(read()).toBe(5);
        stopHydration();
        await tick();
        // Handoff run: its single yield is the duplicate.
        expect(read()).toBe(5);
        await refresh(read as any);
        await tick();
        expect(read()).toBe(1);
      } finally {
        dispose();
      }
    });
  }
});

describe("hybrid memo/signal handoff — rule 3: a rejected server answer is the adopted answer", () => {
  afterEach(stopHydration);

  test("a pending answer that rejects surfaces the error until refresh()", async () => {
    const server = deferred<number>();
    startHydration({ t0: server.promise });
    const { source, starts } = counted(async function* () {
      yield 2;
    });
    let dispose!: () => void;
    const read = createRoot(
      d => {
        dispose = d;
        return createMemo(source, { ssrSource: "hybrid" });
      },
      { id: "t" }
    );
    try {
      flush();
      expect(() => read()).toThrow(NotReadyError);
      stopHydration();
      await tick();
      expect(() => read()).toThrow(NotReadyError);
      const error = new Error("server failed");
      server.reject(error);
      await tick();
      expect(() => read()).toThrow(error.message);
      // No handoff run papers over the rejection.
      await tick();
      expect(() => read()).toThrow(error.message);
      expect(starts()).toBe(0);
      await refresh(read as any);
      await tick();
      expect(read()).toBe(2);
      expect(starts()).toBe(1);
    } finally {
      dispose();
    }
  });

  test("a settled rejection surfaces the error until refresh()", async () => {
    const error = new Error("server failed");
    startHydration({ t0: { v: error, s: 2 } });
    const { source, starts } = counted(async function* () {
      yield 2;
    });
    let dispose!: () => void;
    const read = createRoot(
      d => {
        dispose = d;
        return createMemo(source, { ssrSource: "hybrid" });
      },
      { id: "t" }
    );
    try {
      flush();
      expect(() => read()).toThrow(error.message);
      stopHydration();
      await tick();
      expect(() => read()).toThrow(error.message);
      expect(starts()).toBe(0);
      await refresh(read as any);
      await tick();
      expect(read()).toBe(2);
    } finally {
      dispose();
    }
  });
});

describe("hybrid memo/signal handoff — rule 4: a dependency change before the landing supersedes the server answer", () => {
  afterEach(stopHydration);

  for (const [name, create] of families) {
    test(`${name}: the client takes over on the change, its first yield commits, and the late landing is ignored`, async () => {
      const server = deferred<number>();
      startHydration({ t0: server.promise });
      const [version, setVersion] = createSignal(1);
      const { source, starts } = counted(async function* () {
        yield version();
      });
      let dispose!: () => void;
      const read = createRoot(
        d => {
          dispose = d;
          return create(source, { ssrSource: "hybrid" });
        },
        { id: "t" }
      );
      try {
        flush();
        expect(() => read()).toThrow(NotReadyError);
        expect(starts()).toBe(0);
        stopHydration();
        await tick();
        expect(() => read()).toThrow(NotReadyError);
        // (a) A dependency changes while the server answer is still pending:
        // the client is authoritative from this run, and it is not a handoff
        // — its first yield commits.
        setVersion(2);
        await tick();
        expect(read()).toBe(2);
        expect(starts()).toBe(1);
        // (b) The abandoned server answer lands: dropped, no run, no flip.
        server.resolve(5);
        await tick();
        expect(read()).toBe(2);
        expect(starts()).toBe(1);
        await tick();
        expect(read()).toBe(2);
        expect(starts()).toBe(1);
        // Live: a later change runs the client source as usual.
        setVersion(3);
        await tick();
        expect(read()).toBe(3);
        expect(starts()).toBe(2);
      } finally {
        dispose();
      }
    });
  }

  test("the abandoned server flight's rejection is dropped: no error surfaces", async () => {
    const server = deferred<number>();
    startHydration({ t0: server.promise });
    const [version, setVersion] = createSignal(1);
    const { source, starts } = counted(async function* () {
      yield version();
    });
    let dispose!: () => void;
    const read = createRoot(
      d => {
        dispose = d;
        return createMemo(source, { ssrSource: "hybrid" });
      },
      { id: "t" }
    );
    try {
      flush();
      stopHydration();
      await tick();
      expect(() => read()).toThrow(NotReadyError);
      setVersion(2);
      await tick();
      expect(read()).toBe(2);
      // (c) The superseded flight rejects: not the node's answer any more.
      server.reject(new Error("server failed"));
      await tick();
      expect(read()).toBe(2);
      expect(starts()).toBe(1);
      await tick();
      expect(read()).toBe(2);
      expect(starts()).toBe(1);
    } finally {
      dispose();
    }
  });
});

describe("hybrid memo/signal handoff — rule 5: the handoff opens no pending window", () => {
  afterEach(stopHydration);

  // Pinned through a consumer born after the landing — the shape of a
  // streamed <Loading> resuming to claim its fragment while the handoff run
  // is in flight — and through `isPending` directly.
  function mount(read: () => number) {
    let view: string | { text: string; pending: boolean };
    const dispose = createRoot(d => {
      const boundary = createLoadingBoundary(
        () => ({ text: `content:${read()}`, pending: isPending(read) }),
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

  for (const [name, create] of families) {
    test(`${name}: a boundary created before the client's first yield shows the adopted answer`, async () => {
      const server = deferred<number>();
      const first = deferred<void>();
      const second = deferred<void>();
      startHydration({ t0: server.promise });
      let dispose!: () => void;
      const read = createRoot(
        d => {
          dispose = d;
          return create(
            async function* () {
              await first.promise;
              yield 1;
              await second.promise;
              yield 2;
            },
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
        // Before the landing the node is genuinely unanswered: a boundary
        // created now shows its fallback (the shell's fallback is legitimate).
        expect(() => read()).toThrow(NotReadyError);
        consumer = mount(read);
        expect(consumer.view()).toBe("fallback");
        consumer.dispose();

        server.resolve(5);
        await tick();
        expect(read()).toBe(5);
        // The handoff run is in flight (`first` is closed). A boundary created
        // now reads the answer, and nothing is pending — no new question is in
        // flight, the answer is the one on screen.
        consumer = mount(read);
        expect(consumer.view()).toBe("content:5");
        expect(consumer.pending()).toBe(false);

        // The duplicate first yield lands silently; the next one updates.
        first.resolve();
        await tick();
        expect(read()).toBe(5);
        expect(consumer.view()).toBe("content:5");
        expect(consumer.pending()).toBe(false);
        second.resolve();
        await tick();
        expect(read()).toBe(2);
        expect(consumer.view()).toBe("content:2");
      } finally {
        first.resolve();
        second.resolve();
        consumer?.dispose();
        dispose();
      }
    });
  }

  test("a client-only mount (no hydration) still shows the fallback until the first value", async () => {
    // The quiet window is a HANDOFF property: outside hydration there is no
    // adopted answer, so a fresh async memo suspends its boundary as ever.
    const gate = deferred<void>();
    let dispose!: () => void;
    const read = createRoot(d => {
      dispose = d;
      return createMemo(
        async function* () {
          await gate.promise;
          yield 1;
        },
        { ssrSource: "hybrid" }
      );
    });
    let consumer: ReturnType<typeof mount> | undefined;
    try {
      flush();
      expect(() => read()).toThrow(NotReadyError);
      consumer = mount(read);
      expect(consumer.view()).toBe("fallback");
      gate.resolve();
      await tick();
      expect(read()).toBe(1);
      expect(consumer.view()).toBe("content:1");
    } finally {
      gate.resolve();
      consumer?.dispose();
      dispose();
    }
  });
});
