/**
 * SPEC TESTS — the question-scoped pending model (2026-07-13 re-rule).
 *
 * The verdict: a read is pending iff a value change is in flight for it that
 * has not yet revealed, or it carries a live `affects` mark.
 *
 * - Same-question motion (refresh/poll/confirm — a re-ask with input values
 *   stable) is NOT pending: the shown data still answers the question being
 *   asked.
 * - A new question (any tracked input changed value since the last reveal)
 *   pends everything under the source until its answer reveals. Nothing can
 *   silence it — pendingness is monotone.
 * - Optimistic writes are verdict-inert: they neither announce pending on
 *   their own slots nor mask anyone else's (the store-wide mask / A21 is
 *   deleted). To downstream async they are real input changes.
 * - `affects(target, key?)` is the only declaration verb: additive pending
 *   on the named slot AND everything derived from it (marks ride the status
 *   rails — see tests/affects-propagation.test.ts), held from declaration to
 *   its transaction's settle/revert.
 *
 * These supersede the A20/A21 mask pins. Scenario numbers reference the
 * question-scoped pending plan (Part 3).
 */
import { describe, expect, it } from "vitest";
import {
  action,
  affects,
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  latest,
  refresh,
  type SourceAccessor
} from "../src/index.js";

function deferredFetcher<T>(compute: (arg: number) => T) {
  const resolvers: Array<() => void> = [];
  return {
    calls: 0,
    fetch(arg: number): Promise<T> {
      this.calls++;
      return new Promise<T>(r => resolvers.push(() => r(compute(arg))));
    },
    resolveAll(): void {
      const pending = resolvers.splice(0);
      for (const r of pending) r();
    }
  };
}

// Macrotask settle: async store projections resume off a timer-visible turn.
const tick = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};

type Thing = { foo: number; foos: string[] };

/** Derived optimistic store fetching by id, with hand-controlled resolution. */
function createThing() {
  const [id, setId] = createSignal(1);
  const fetcher = deferredFetcher((i: number) => ({
    foo: i * 10,
    foos: [`alpha-${i}`, `beta-${i}`]
  }));
  let thing!: Thing;
  let setThing!: (fn: (s: Thing) => void) => void;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    [thing, setThing] = createOptimisticStore<Thing>(
      async s => {
        const i = id();
        const v = await fetcher.fetch(i);
        s.foo = v.foo;
        s.foos = v.foos;
      },
      { foo: 0, foos: [] }
    );
    // Render effects make the graph transition-coordinated like a real app.
    createRenderEffect(
      () => thing.foos.length,
      () => {}
    );
    createRenderEffect(
      () => thing.foo,
      () => {}
    );
  });
  flush();
  return {
    id,
    setId,
    fetcher,
    get thing() {
      return thing;
    },
    setThing,
    dispose
  };
}

async function settleInitial(t: ReturnType<typeof createThing>) {
  t.fetcher.resolveAll();
  await tick();
  expect(t.thing.foo).toBe(10);
  expect(isPending(() => t.thing.foos)).toBe(false);
}

describe("same-question motion is silent", () => {
  it("3.4/3.5-bare: refresh() alone never pends the store (was: pended every leaf)", async () => {
    const t = createThing();
    await settleInitial(t);

    refresh(t.thing as any);
    flush();
    // Fetch is genuinely in flight…
    expect(t.fetcher.calls).toBe(2);
    // …but the question (id === 1) is unchanged: nothing is pending.
    expect(isPending(() => t.thing.foos)).toBe(false);
    expect(isPending(() => t.thing.foo)).toBe(false);

    t.fetcher.resolveAll();
    await tick();
    expect(isPending(() => t.thing.foos)).toBe(false);
    t.dispose();
  });

  it("3.4: polling (repeated refresh) stays silent every cycle", async () => {
    const t = createThing();
    await settleInitial(t);

    for (let cycle = 0; cycle < 3; cycle++) {
      refresh(t.thing as any);
      flush();
      expect(isPending(() => t.thing.foos)).toBe(false);
      t.fetcher.resolveAll();
      await tick();
    }
    expect(t.fetcher.calls).toBe(4);
    t.dispose();
  });

  it("3.1/3.2: optimistic write + confirm refresh — silent throughout, siblings untouched", async () => {
    const t = createThing();
    await settleInitial(t);

    let resolveMutation!: () => void;
    const increment = action(function* () {
      t.setThing(s => {
        s.foo++;
      });
      yield new Promise<void>(r => (resolveMutation = r));
      refresh(t.thing as any);
    });

    const done = increment();
    flush();
    // Optimistic value displays instantly; nothing pends (no motion yet, and
    // optimistic writes are verdict-inert on their own slots).
    expect(t.thing.foo).toBe(11);
    expect(isPending(() => t.thing.foo)).toBe(false);
    expect(isPending(() => t.thing.foos)).toBe(false);

    resolveMutation();
    await done;
    flush();
    // Confirm refetch in flight: same question ⇒ still silent, everywhere.
    expect(t.fetcher.calls).toBe(2);
    expect(isPending(() => t.thing.foo)).toBe(false);
    expect(isPending(() => t.thing.foos)).toBe(false);

    t.fetcher.resolveAll();
    await tick();
    expect(t.thing.foo).toBe(10); // authority wins at reveal
    expect(isPending(() => t.thing.foo)).toBe(false);
    t.dispose();
  });

  it("a quiet refetch does not poison an isPending memo with NotReady", async () => {
    const t = createThing();
    await settleInitial(t);

    const log: boolean[] = [];
    createRoot(() => {
      const pending = createMemo(() => isPending(() => t.thing.foos));
      createRenderEffect(pending, v => {
        log.push(v);
      });
    });
    flush();
    expect(log).toEqual([false]);

    refresh(t.thing as any);
    flush();
    // The memo must neither flip true nor suspend on the in-flight fetch.
    expect(log).toEqual([false]);

    t.fetcher.resolveAll();
    await tick();
    expect(log).toEqual([false]);
    t.dispose();
  });
});

describe("new questions pend and cannot be silenced (the foos bug, fixed without masking)", () => {
  it("3.1: navigation pends every leaf; an optimistic write mid-flight does NOT mask it", async () => {
    const t = createThing();
    await settleInitial(t);

    // Navigation: id changed ⇒ new question ⇒ the whole store pends.
    t.setId(2);
    flush();
    expect(isPending(() => t.thing.foos)).toBe(true);
    expect(isPending(() => t.thing.foo)).toBe(true);

    // The old A21 mask flipped these false here. Under the question-scoped
    // model the optimistic write displays but is verdict-inert — the
    // navigation's pending survives on every slot, written or not.
    t.setThing(s => {
      s.foo++;
    });
    flush();
    expect(t.thing.foo).toBe(11); // displays immediately
    expect(isPending(() => t.thing.foos)).toBe(true);
    expect(isPending(() => t.thing.foo)).toBe(true);

    t.fetcher.resolveAll();
    await tick();
    expect(t.thing.foos).toEqual(["alpha-2", "beta-2"]);
    expect(isPending(() => t.thing.foos)).toBe(false);
    t.dispose();
  });

  it("navigation DURING a quiet confirm flips the verdict on (re-ask does not launder a new question)", async () => {
    const t = createThing();
    await settleInitial(t);

    refresh(t.thing as any);
    flush();
    expect(isPending(() => t.thing.foos)).toBe(false); // quiet confirm

    t.setId(2);
    flush();
    expect(isPending(() => t.thing.foos)).toBe(true); // question changed mid-flight

    // A re-refresh while the new question is unanswered must stay pending.
    refresh(t.thing as any);
    flush();
    expect(isPending(() => t.thing.foos)).toBe(true);

    t.fetcher.resolveAll();
    await tick();
    expect(isPending(() => t.thing.foos)).toBe(false);
    t.dispose();
  });

  it("a reactive isPending memo flips true when a quiet confirm is overtaken by navigation", async () => {
    const t = createThing();
    await settleInitial(t);

    const log: boolean[] = [];
    createRoot(() => {
      const pending = createMemo(() => isPending(() => t.thing.foos));
      createRenderEffect(pending, v => {
        log.push(v);
      });
    });
    flush();
    expect(log).toEqual([false]);

    refresh(t.thing as any);
    flush();
    expect(log).toEqual([false]);

    t.setId(2);
    flush();
    expect(log.at(-1)).toBe(true);

    t.fetcher.resolveAll();
    await tick();
    expect(log.at(-1)).toBe(false);
    t.dispose();
  });
});

describe("plain optimistic stores (no source)", () => {
  it("writes display and revert without ever pending", () => {
    const [state, setState] = createOptimisticStore({ count: 0 });
    setState(s => {
      s.count++;
    });
    expect(state.count).toBe(1);
    expect(isPending(() => state.count)).toBe(false);
    flush();
    expect(state.count).toBe(0);
    expect(isPending(() => state.count)).toBe(false);
  });

  it("writes inside an action stay verdict-inert for the action's lifetime", async () => {
    const [state, setState] = createOptimisticStore({ count: 0 });
    let resolveMutation!: () => void;
    const increment = action(function* () {
      setState(s => {
        s.count++;
      });
      yield new Promise<void>(r => (resolveMutation = r));
    });
    const done = increment();
    flush();
    expect(state.count).toBe(1);
    expect(isPending(() => state.count)).toBe(false);
    resolveMutation();
    await done;
    flush();
    expect(state.count).toBe(0);
    expect(isPending(() => state.count)).toBe(false);
  });
});

describe("signal parity (createOptimistic)", () => {
  it("4.8: quiet confirm silent; upstream question change pends while the override displays", async () => {
    const [id, setId] = createSignal(1);
    const fetcher = deferredFetcher((i: number) => i * 10);
    let data!: SourceAccessor<number>;
    let setData!: (v: number) => void;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      [data, setData] = createOptimistic(() => fetcher.fetch(id()));
      createRenderEffect(data, () => {});
    });
    flush();
    fetcher.resolveAll();
    await tick();
    expect(data()).toBe(10);
    expect(isPending(data)).toBe(false);

    // Optimistic write + same-question confirm inside an action: silent
    // throughout — the shipped "no spinner over your own confirm" reproduces
    // with no mask. (Outside an action the override reverts at flush end, so
    // the transaction is what holds it over the confirm.)
    let resolveMutation!: () => void;
    const increment = action(function* () {
      setData(11);
      yield new Promise<void>(r => (resolveMutation = r));
      refresh(data);
    });
    const done = increment();
    flush();
    expect(data()).toBe(11);
    expect(isPending(data)).toBe(false);
    resolveMutation();
    await done;
    flush();
    expect(isPending(data)).toBe(false); // confirm in flight: same question
    fetcher.resolveAll();
    await tick();
    expect(data()).toBe(10); // authority wins at reveal
    expect(isPending(data)).toBe(false);

    // Optimistic write, then an upstream question change: honest mixed state —
    // the override keeps displaying while the slot reads pending.
    let resolveWrite!: () => void;
    const write = action(function* () {
      setData(99);
      yield new Promise<void>(r => (resolveWrite = r));
    });
    const writeDone = write();
    flush();
    expect(data()).toBe(99);
    expect(isPending(data)).toBe(false);
    setId(2);
    flush();
    expect(data()).toBe(99); // still displaying the optimistic value
    expect(isPending(data)).toBe(true); // was false under the A20 mask

    fetcher.resolveAll();
    resolveWrite();
    await writeDone;
    await tick();
    expect(data()).toBe(20);
    expect(isPending(data)).toBe(false);
    dispose();
  });

  it("plain signal navigation affordance: the written input pends while downstream async digests", async () => {
    const [id, setId] = createSignal(1);
    const fetcher = deferredFetcher((i: number) => i * 10);
    let data!: SourceAccessor<number>;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      data = createMemo(() => fetcher.fetch(id()));
      createRenderEffect(data, () => {});
    });
    flush();
    fetcher.resolveAll();
    await tick();

    setId(2);
    flush();
    // The held write on `id` is a known change unrevealed — the natural
    // route-level wide affordance.
    expect(isPending(() => id())).toBe(true);
    expect(isPending(data)).toBe(true);

    fetcher.resolveAll();
    await tick();
    expect(isPending(() => id())).toBe(false);
    expect(data()).toBe(20);
    dispose();
  });
});

describe("affects — the declaration verb", () => {
  it("3.5: reload button — affects(store) + refresh pends the whole store until settle", async () => {
    const t = createThing();
    await settleInitial(t);

    const reload = action(function* () {
      affects(t.thing);
      refresh(t.thing as any);
      yield Promise.resolve();
    });
    const done = reload();
    flush();
    expect(isPending(() => t.thing.foos)).toBe(true); // declared motion
    expect(isPending(() => t.thing.foo)).toBe(true);

    await done;
    t.fetcher.resolveAll();
    await tick();
    expect(isPending(() => t.thing.foos)).toBe(false); // mark released at settle
    expect(isPending(() => t.thing.foo)).toBe(false);
    t.dispose();
  });

  it("3.6: slot form — affects(record, key) pends exactly the named slot", async () => {
    type Msg = { text: string; status: string };
    const [state, setState] = createOptimisticStore<{ messages: Msg[] }>({
      messages: [{ text: "hi", status: "sent" }]
    });
    let resolveSend!: () => void;
    const send = action(function* () {
      setState(s => {
        s.messages.push({ text: "new", status: "sending" });
      });
      affects(state.messages[1], "status");
      yield new Promise<void>(r => (resolveSend = r));
    });

    const done = send();
    flush();
    // The declared slot pends (gray bubble)…
    expect(isPending(() => state.messages[1].status)).toBe(true);
    // …its sibling slot and other rows stay crisp.
    expect(isPending(() => state.messages[1].text)).toBe(false);
    expect(isPending(() => state.messages[0].status)).toBe(false);

    resolveSend();
    await done;
    flush();
    expect(isPending(() => state.messages[0].status)).toBe(false);
  });

  it("record form — affects(record) covers every read through that record, not siblings", async () => {
    type Row = { name: string };
    const [state, setState] = createOptimisticStore<{ rows: Row[] }>({
      rows: [{ name: "a" }, { name: "b" }]
    });
    let resolveIt!: () => void;
    const act = action(function* () {
      affects(state.rows[0]);
      yield new Promise<void>(r => (resolveIt = r));
    });

    const done = act();
    flush();
    expect(isPending(() => state.rows[0].name)).toBe(true);
    expect(isPending(() => state.rows[1].name)).toBe(false);

    resolveIt();
    await done;
    flush();
    expect(isPending(() => state.rows[0].name)).toBe(false);
  });

  it("accessor form — affects(signal) pends the signal for the transaction's lifetime", async () => {
    const [count] = createSignal(0);
    let resolveIt!: () => void;
    const act = action(function* () {
      affects(count);
      yield new Promise<void>(r => (resolveIt = r));
    });

    const done = act();
    flush();
    expect(isPending(count)).toBe(true);
    expect(isPending(() => count())).toBe(true);

    resolveIt();
    await done;
    flush();
    expect(isPending(count)).toBe(false);
  });

  it("affects marks release reactively (a subscribed isPending memo flips back)", async () => {
    const [count] = createSignal(0);
    const log: boolean[] = [];
    createRoot(() => {
      const pending = createMemo(() => isPending(count));
      createRenderEffect(pending, v => {
        log.push(v);
      });
    });
    flush();
    expect(log).toEqual([false]);

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(count);
      yield new Promise<void>(r => (resolveIt = r));
    });
    const done = act();
    flush();
    expect(log.at(-1)).toBe(true);

    resolveIt();
    await done;
    flush();
    expect(log.at(-1)).toBe(false);
  });

  it("affects with no transaction and no async releases at flush end", () => {
    const [count] = createSignal(0);
    affects(count);
    expect(isPending(count)).toBe(true); // held within the current batch
    flush();
    expect(isPending(count)).toBe(false); // nothing async below ⇒ no window
  });
});

describe("affects — captured proxies (#2882)", () => {
  // The contract: a keyless mark covers every read through the marked record's
  // subtree — by identity, regardless of whether the probe's read path
  // physically traverses the marked record. `<For>` hands rows captured child
  // proxies, so row probes never enter through the root.

  type Row = { name: string; tags: { primary: string } };
  const seedRows = (): Row[] => [
    { name: "a", tags: { primary: "x" } },
    { name: "b", tags: { primary: "y" } }
  ];

  it("affects(store) covers a captured row proxy (<For> row shape, derived store)", async () => {
    let state!: { rows: Row[] };
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      [state] = createOptimisticStore<{ rows: Row[] }>(
        s => {
          s.rows = seedRows();
        },
        { rows: [] }
      );
    });
    flush();

    const row = state.rows[0]; // captured child proxy, like a <For> row
    let resolveIt!: () => void;
    const act = action(function* () {
      affects(state);
      yield new Promise<void>(r => (resolveIt = r));
    });

    const done = act();
    flush();
    expect(isPending(() => state.rows[0].name)).toBe(true); // path through root (already worked)
    expect(isPending(() => row.name)).toBe(true); // captured proxy — the #2882 gap

    resolveIt();
    await done;
    flush();
    expect(isPending(() => row.name)).toBe(false); // released at settle
    dispose();
  });

  it("affects(plain store) covers captured proxies at any depth", async () => {
    const [state] = createStore<{ rows: Row[] }>({ rows: seedRows() });
    const tags = state.rows[0].tags; // captured two levels deep

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(state);
      yield new Promise<void>(r => (resolveIt = r));
    });

    const done = act();
    flush();
    expect(isPending(() => tags.primary)).toBe(true);

    resolveIt();
    await done;
    flush();
    expect(isPending(() => tags.primary)).toBe(false);
  });

  it("affects(plain store) covers an untouched symbol-keyed grandchild", async () => {
    const meta = Symbol("meta");
    const [state] = createStore({ outer: { [meta]: { value: 1 } } });

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(state);
      yield new Promise<void>(r => (resolveIt = r));
    });

    const done = act();
    flush();
    const child = state.outer[meta];
    expect(isPending(() => child.value)).toBe(true);

    resolveIt();
    await done;
    flush();
    expect(isPending(() => child.value)).toBe(false);
  });

  it("affects(array store) covers symbol-keyed metadata", async () => {
    const meta = Symbol("meta");
    const initial = Object.assign([{ value: 0 }], { [meta]: { value: 1 } });
    const [state] = createStore(initial);

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(state);
      yield new Promise<void>(r => (resolveIt = r));
    });

    const done = act();
    flush();
    const metadata = state[meta];
    expect(isPending(() => metadata.value)).toBe(true);

    resolveIt();
    await done;
    flush();
    expect(isPending(() => metadata.value)).toBe(false);
  });

  it("keyless mark on a nested record covers its captured subtree, not siblings", async () => {
    const [state] = createStore<{ rows: Row[] }>({ rows: seedRows() });
    const tags0 = state.rows[0].tags;
    const tags1 = state.rows[1].tags;

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(state.rows[0]);
      yield new Promise<void>(r => (resolveIt = r));
    });

    const done = act();
    flush();
    expect(isPending(() => tags0.primary)).toBe(true); // inside the marked subtree
    expect(isPending(() => tags1.primary)).toBe(false); // sibling stays crisp
    expect(isPending(() => state.rows[1].name)).toBe(false);

    resolveIt();
    await done;
    flush();
    expect(isPending(() => tags0.primary)).toBe(false);
  });

  it("registering a mark wakes an already-materialized false verdict on a captured proxy", async () => {
    const [state] = createStore<{ rows: Row[] }>({ rows: seedRows() });
    const row = state.rows[0];
    const log: boolean[] = [];
    createRoot(() => {
      const pending = createMemo(() => isPending(() => row.name));
      createRenderEffect(pending, v => {
        log.push(v);
      });
    });
    flush();
    expect(log).toEqual([false]); // verdict materialized before any mark exists

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(state);
      yield new Promise<void>(r => (resolveIt = r));
    });
    const done = act();
    flush();
    expect(log.at(-1)).toBe(true); // a later mark must flip the captured-proxy verdict

    resolveIt();
    await done;
    flush();
    expect(log.at(-1)).toBe(false); // and release must flip it back
  });

  // Optimistic stores make in-flight writes readable outside the action, so
  // the two declaration-ordering tests use them (a plain store's writes are
  // transition-held and invisible to outside probes anyway).
  it("records added after the mark registers are not covered (snapshot at declaration)", async () => {
    const [state, setState] = createOptimisticStore<{ rows: Row[] }>({ rows: seedRows() });

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(state);
      setState(s => {
        s.rows.push({ name: "c", tags: { primary: "z" } });
      });
      yield new Promise<void>(r => (resolveIt = r));
    });

    const done = act();
    flush();
    const added = state.rows[2];
    expect(added.name).toBe("c"); // optimistic write is visible…
    expect(isPending(() => state.rows.length)).toBe(true); // …the rows record itself is marked…
    expect(isPending(() => added.name)).toBe(false); // …but the new record was not in the declared scope

    resolveIt();
    await done;
    flush();
  });

  it("overlapping keyless marks: a re-declaration covers records added since the first", async () => {
    const [state, setState] = createOptimisticStore<{ rows: Row[] }>({ rows: seedRows() });

    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const first = action(function* () {
      affects(state);
      yield new Promise<void>(r => (resolveFirst = r));
    });
    const second = action(function* () {
      setState(s => {
        s.rows.push({ name: "c", tags: { primary: "z" } });
      });
      affects(state); // second mark while the first is live: must re-snapshot
      yield new Promise<void>(r => (resolveSecond = r));
    });

    const doneFirst = first();
    flush();
    const doneSecond = second();
    flush();
    const added = state.rows[2];
    expect(isPending(() => added.name)).toBe(true); // in the second declaration's scope

    resolveFirst();
    await doneFirst;
    flush();
    expect(isPending(() => added.name)).toBe(true); // second mark still live
    expect(isPending(() => state.rows[0].name)).toBe(true);

    resolveSecond();
    await doneSecond;
    flush();
    expect(isPending(() => added.name)).toBe(false);
    expect(isPending(() => state.rows[0].name)).toBe(false);
  });

  it("multiple keys throw in dev — keys are not a path", () => {
    const [state] = createStore<{ rows: Row[] }>({ rows: seedRows() });
    expect(() => (affects as any)(state, "rows", "length")).toThrow(/single optional key/);
  });

  it("optimistically written records visible at declaration time are covered", async () => {
    const [state, setState] = createOptimisticStore<{ rows: Row[] }>({ rows: seedRows() });

    let resolveIt!: () => void;
    const act = action(function* () {
      setState(s => {
        s.rows.push({ name: "c", tags: { primary: "z" } });
      });
      affects(state); // declared AFTER the write: the walk must read through overlays
      yield new Promise<void>(r => (resolveIt = r));
    });

    const done = act();
    flush();
    const added = state.rows[2];
    expect(added.name).toBe("c");
    expect(isPending(() => added.name)).toBe(true);

    resolveIt();
    await done;
    flush();
    expect(isPending(() => added.name)).toBe(false);
  });
});

describe("affects — cross-family raw sharing (#2904)", () => {
  // A derived store whose projection lands the SOURCE store's value adopts
  // the source's raw object as its backing (reconcile's swap). Reads through
  // the derived proxy then never touch the source family's node map, so a
  // keyed mark carried only by the source's leaf node was invisible to them.
  // Keyed marks now register an identity scope (owning raw + key), the same
  // mechanism keyless marks use for captured proxies (#2882).

  it("keyed affects(source, key) is visible through a derived optimistic store (the issue repro)", () => {
    const [s] = createOptimisticStore<{ a: number }>(() => ({ a: 1 }), { a: 0 });
    const [s2] = createOptimisticStore<{ a: number }>(() => s, { a: 0 } as any);
    flush();

    expect(isPending(() => s.a)).toBe(false);
    expect(isPending(() => s2.a)).toBe(false);

    affects(s, "a");
    expect(isPending(() => s.a)).toBe(true);
    expect(isPending(() => s2.a)).toBe(true);
    flush(); // ambient mark releases at flush end
    expect(isPending(() => s.a)).toBe(false);
    expect(isPending(() => s2.a)).toBe(false);
  });

  it("keyless affects(source) is visible through a derived optimistic store", () => {
    const [s] = createOptimisticStore<{ a: number }>(() => ({ a: 1 }), { a: 0 });
    const [s2] = createOptimisticStore<{ a: number }>(() => s, { a: 0 } as any);
    flush();

    affects(s);
    expect(isPending(() => s.a)).toBe(true);
    expect(isPending(() => s2.a)).toBe(true);
  });

  it("keyed marks stay scoped to their key across families", () => {
    const [s] = createOptimisticStore<{ a: number; b: number }>(() => ({ a: 1, b: 2 }), {
      a: 0,
      b: 0
    });
    const [s2] = createOptimisticStore<{ a: number; b: number }>(() => s, {
      a: 0,
      b: 0
    } as any);
    flush();

    affects(s, "a");
    expect(isPending(() => s2.a)).toBe(true);
    expect(isPending(() => s2.b)).toBe(false); // other keys of the shared record stay crisp
  });

  it("keyed mark held by an action releases at settle, through both proxies", async () => {
    const [s] = createOptimisticStore<{ a: number }>(() => ({ a: 1 }), { a: 0 });
    const [s2] = createOptimisticStore<{ a: number }>(() => s, { a: 0 } as any);
    flush();

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(s, "a");
      yield new Promise<void>(r => (resolveIt = r));
    });

    const done = act();
    flush();
    expect(isPending(() => s.a)).toBe(true);
    expect(isPending(() => s2.a)).toBe(true);

    resolveIt();
    await done;
    flush();
    expect(isPending(() => s.a)).toBe(false);
    expect(isPending(() => s2.a)).toBe(false);
  });

  it("a node born in the other family during a keyed window inherits the mark", async () => {
    const [s] = createOptimisticStore<{ a: number }>(() => ({ a: 1 }), { a: 0 });
    const [s2] = createOptimisticStore<{ a: number }>(() => s, { a: 0 } as any);
    flush();

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(s, "a");
      yield new Promise<void>(r => (resolveIt = r));
    });
    const done = act();
    flush();

    // Tracked read during the window: materializes s2's own node for "a",
    // which must be born marked (birth inheritance, keyed-narrowed).
    const log: boolean[] = [];
    createRoot(() => {
      const pending = createMemo(() => isPending(() => s2.a));
      createRenderEffect(pending, v => {
        log.push(v);
      });
    });
    flush();
    expect(log.at(-1)).toBe(true);

    resolveIt();
    await done;
    flush();
    expect(log.at(-1)).toBe(false); // released with the action's settle
  });
});

describe("digestion windows (same-question landings are ordinary changes downstream)", () => {
  it("4b: a quiet landing that changes data pends downstream async until it settles", async () => {
    const [id] = createSignal(1);
    let serverValue = 10;
    const sourceFetch = deferredFetcher((_: number) => serverValue);
    const derivedFetch = deferredFetcher((v: number) => v * 2);

    let state!: { data: number };
    let derived!: SourceAccessor<number>;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      [state] = createOptimisticStore<{ data: number }>(
        async s => {
          id();
          s.data = await sourceFetch.fetch(0);
        },
        { data: 0 }
      );
      derived = createMemo(() => derivedFetch.fetch(state.data));
      createRenderEffect(derived, () => {});
    });
    flush();
    sourceFetch.resolveAll();
    await tick();
    derivedFetch.resolveAll();
    await tick();
    expect(derived()).toBe(20);
    expect(isPending(derived)).toBe(false);

    // Quiet re-ask: silent while the fetch flies…
    serverValue = 15;
    refresh(state as any);
    flush();
    expect(isPending(() => state.data)).toBe(false);
    expect(isPending(derived)).toBe(false);

    // …the landing carries a changed value: downstream digests honestly.
    sourceFetch.resolveAll();
    await tick();
    expect(isPending(derived)).toBe(true);

    derivedFetch.resolveAll();
    await tick();
    expect(derived()).toBe(30);
    expect(isPending(derived)).toBe(false);
    dispose();
  });

  it("4b: a quiet landing with UNCHANGED data opens no window (equality cut)", async () => {
    const [id] = createSignal(1);
    const sourceFetch = deferredFetcher((_: number) => 10);
    const derivedFetch = deferredFetcher((v: number) => v * 2);

    let state!: { data: number };
    let derived!: SourceAccessor<number>;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      [state] = createOptimisticStore<{ data: number }>(
        async s => {
          id();
          s.data = await sourceFetch.fetch(0);
        },
        { data: 0 }
      );
      derived = createMemo(() => derivedFetch.fetch(state.data));
      createRenderEffect(derived, () => {});
    });
    flush();
    sourceFetch.resolveAll();
    await tick();
    derivedFetch.resolveAll();
    await tick();
    expect(derived()).toBe(20);

    refresh(state as any);
    flush();
    sourceFetch.resolveAll();
    await tick();
    // Same value landed: no digestion, no refetch of the derived memo.
    expect(isPending(derived)).toBe(false);
    expect(derivedFetch.calls).toBe(1);
    dispose();
  });

  it("4c: an optimistic write is a real input change to downstream async", async () => {
    const derivedFetch = deferredFetcher((v: number) => v * 2);
    const [state, setState] = createOptimisticStore({ data: 10 });
    let derived!: SourceAccessor<number>;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      derived = createMemo(() => derivedFetch.fetch(state.data));
      createRenderEffect(derived, () => {});
    });
    flush();
    derivedFetch.resolveAll();
    await tick();
    expect(derived()).toBe(20);

    let resolveMutation!: () => void;
    const act = action(function* () {
      setState(s => {
        s.data = 15;
      });
      yield new Promise<void>(r => (resolveMutation = r));
    });
    const done = act();
    flush();
    // Own slot: verdict-inert. Downstream async memo: new question, pending.
    expect(isPending(() => state.data)).toBe(false);
    expect(isPending(derived)).toBe(true);

    derivedFetch.resolveAll();
    resolveMutation();
    await done;
    await tick();
    // The revert (15 → 10) is itself an input change: the memo refetches once
    // more and pends honestly until that lands too.
    expect(isPending(derived)).toBe(true);
    derivedFetch.resolveAll();
    await tick();
    expect(isPending(derived)).toBe(false);
    expect(derived()).toBe(20);
    dispose();
  });
});
