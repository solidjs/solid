/**
 * SPEC TESTS — affects() marks propagate through derivation (#2882 gap 2).
 *
 * A mark is a synthetic in-flight change: it rides the same status rails as
 * real async pending. Anything whose value derives from marked data reads
 * pending for the mark's lifetime — the probe does not need to physically
 * read the marked node. Constraints pinned here:
 * - a bare mark (no async in flight) still pends downstream memos;
 * - a mark registered after a verdict materialized wakes it;
 * - release at the transaction's settle clears downstream verdicts;
 * - a landing mid-mark (affects + refresh resolving) does not strip the
 *   mark early — pending holds until settle;
 * - a mark never blocks its own transaction's settlement;
 * - store record marks reach derived readers of captured row proxies.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  affects,
  createLoadingBoundary,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  mapArray,
  refresh
} from "../src/index.js";

const tick = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};

describe("affects — propagation through derivation", () => {
  it("a bare mark on a signal pends downstream memos until settle", async () => {
    const [count] = createSignal(1);
    let derived!: () => number;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      derived = createMemo(() => count() * 2);
      createRenderEffect(derived, () => {});
    });
    flush();
    expect(derived()).toBe(2);

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(count);
      yield new Promise<void>(r => (resolveIt = r));
    });
    const done = act();
    flush();
    expect(isPending(() => derived())).toBe(true); // the mark reaches the derivation
    expect(isPending(derived as any)).toBe(true); // accessor-form probe too

    resolveIt();
    await done;
    flush();
    expect(isPending(() => derived())).toBe(false);
    expect(derived()).toBe(2); // value intact through the window
    dispose();
  });

  it("a late mark wakes an already-materialized derived verdict, release flips it back", async () => {
    const [count] = createSignal(1);
    const log: boolean[] = [];
    let derived!: () => number;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      derived = createMemo(() => count() * 2);
      const pending = createMemo(() => isPending(() => derived()));
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
    expect(log.at(-1)).toBe(true); // woken through the rails

    resolveIt();
    await done;
    flush();
    expect(log.at(-1)).toBe(false);
    dispose();
  });

  it("declared reload: pending holds through a mid-mark landing until settle", async () => {
    const [id] = createSignal(1);
    let resolveFetch!: (v: number) => void;
    let source!: () => number;
    let derived!: () => number;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      source = createMemo(() => {
        id();
        return new Promise<number>(r => (resolveFetch = r));
      }) as unknown as () => number;
      derived = createMemo(() => source() * 2);
      createRenderEffect(derived, () => {});
    });
    flush();
    resolveFetch(10);
    await tick();
    expect(derived()).toBe(20);

    let resolveAct!: () => void;
    const act = action(function* () {
      affects(source as any);
      refresh(source as any);
      yield new Promise<void>(r => (resolveAct = r));
    });
    const done = act();
    flush();
    expect(isPending(() => source())).toBe(true);
    expect(isPending(() => derived())).toBe(true); // downstream sees the declared reload

    resolveFetch(10); // quiet confirm lands mid-mark…
    await tick();
    expect(isPending(() => derived())).toBe(true); // …but the mark holds until settle

    resolveAct();
    await done;
    await tick();
    expect(isPending(() => derived())).toBe(false);
    expect(isPending(() => source())).toBe(false);
    dispose();
  });

  it("a mark never blocks its own transaction's settlement", async () => {
    const [count] = createSignal(1);
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const derived = createMemo(() => count() * 2);
      // A render effect observing the marked graph is the deadlock shape:
      // it must not register the mark as a transition blocker.
      createRenderEffect(derived, () => {});
    });
    flush();

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(count);
      yield new Promise<void>(r => (resolveIt = r));
    });
    const done = act();
    flush();
    resolveIt();
    // If the mark blocked settlement this await would hang.
    await done;
    flush();
    expect(isPending(count)).toBe(false);
    dispose();
  });

  it("store record mark pends a derived memo reading a captured row proxy", async () => {
    type Row = { name: string };
    let state!: { rows: Row[] };
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      [state] = createOptimisticStore<{ rows: Row[] }>(
        s => {
          s.rows = [{ name: "a" }, { name: "b" }];
        },
        { rows: [] }
      );
    });
    flush();

    const row = state.rows[0]; // captured, like a <For> row
    let derived!: () => string;
    createRoot(() => {
      derived = createMemo(() => row.name.toUpperCase());
      createRenderEffect(derived, () => {});
    });
    flush();
    expect(derived()).toBe("A");

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(state);
      yield new Promise<void>(r => (resolveIt = r));
    });
    const done = act();
    flush();
    expect(isPending(() => derived())).toBe(true); // record mark → leaf → derivation

    resolveIt();
    await done;
    flush();
    expect(isPending(() => derived())).toBe(false);
    dispose();
  });

  it("a mark does not flip an initialized Loading boundary to its fallback", async () => {
    const [count] = createSignal(1);
    let result: any;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const derived = createMemo(() => count() * 2);
      const boundary = createLoadingBoundary(
        () => derived(),
        () => "loading"
      );
      createRenderEffect(
        () => (result = boundary()),
        () => {}
      );
    });
    flush();
    expect(result).toBe(2);

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(count);
      yield new Promise<void>(r => (resolveIt = r));
    });
    const done = act();
    flush();
    // The value never went away — marks are pending, not loading.
    expect(result).toBe(2);
    expect(isPending(() => count())).toBe(true);

    resolveIt();
    await done;
    flush();
    expect(result).toBe(2);
    expect(isPending(() => count())).toBe(false);
    dispose();
  });

  it("keyed mark pends derived readers of that slot only", async () => {
    type Msg = { text: string; status: string };
    const [state] = createStore<{ msg: Msg }>({ msg: { text: "hi", status: "sent" } });
    let statusView!: () => string;
    let textView!: () => string;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      statusView = createMemo(() => `[${state.msg.status}]`);
      textView = createMemo(() => `[${state.msg.text}]`);
      createRenderEffect(statusView, () => {});
      createRenderEffect(textView, () => {});
    });
    flush();

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(state.msg, "status");
      yield new Promise<void>(r => (resolveIt = r));
    });
    const done = act();
    flush();
    expect(isPending(() => statusView())).toBe(true); // derived from the marked slot
    expect(isPending(() => textView())).toBe(false); // sibling derivation stays crisp

    resolveIt();
    await done;
    flush();
    expect(isPending(() => statusView())).toBe(false);
    dispose();
  });

  it("a mark declared before the action's first optimistic write still lights tracked badges (#2887)", async () => {
    // affects(store) as an action's FIRST statement writes the isPending
    // companion while its owner node is still lane-less; the optimistic write
    // that follows must not absorb the companion's lane into the store's
    // async-carrying lane, or the badge effect defers to settle.
    type User = { name: string };
    let serverUsers: User[] = [{ name: "a" }];
    const getUsers = async () => serverUsers.map(u => ({ ...u }));
    const [users, setUsers] = createOptimisticStore<User[]>(() => getUsers(), []);
    const log: boolean[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      // <For each={users}> stand-in: keeps live subscribers on the array.
      const rows = mapArray(
        () => users,
        u => u.name
      );
      createRenderEffect(
        () => rows(),
        () => {}
      );
      const badge = createMemo(() => isPending(() => users.length));
      createRenderEffect(badge, v => {
        log.push(v);
      });
    });
    flush();
    await Promise.resolve();
    flush();
    expect(users.length).toBe(1); // initial load settled
    log.length = 0;

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(users); // declared first — before any write
      setUsers(u => {
        u.push({ name: "b" });
      });
      yield new Promise<void>(r => (resolveIt = r));
      serverUsers = [{ name: "a" }, { name: "b" }];
      refresh(users as any);
    });
    const done = act();
    flush();
    expect(log).toContain(true); // the badge lit DURING the action
    expect(isPending(() => users.length)).toBe(true);

    resolveIt();
    await done;
    await new Promise(r => setTimeout(r, 0));
    flush();
    await new Promise(r => setTimeout(r, 0));
    flush();
    expect(isPending(() => users.length)).toBe(false);
    expect(log.at(-1)).toBe(false);
    dispose();
  });
});
