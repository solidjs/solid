/**
 * Fold scheduling under in-flight transitions (#3089).
 *
 * Store setter/recompute writes land in a pending backing and FOLD into the
 * committed backing at flush. Two properties are pinned here:
 *
 * 1. Strand-proofing: "fold map non-empty ⇒ drain scheduled" is not an
 *    invariant — a held re-queue or an incomplete-transition flush (which
 *    skips commitPendingNodes) leaves entries behind after `scheduled` was
 *    consumed. queueFold arming a drain only when the map was empty then
 *    stranded every LATER fold: queued silently, never drained, committed
 *    base frozen at its seed while the nodes committed — readers on
 *    different rails saw torn state (length 0, keys ["0"], element intact).
 *
 * 2. Write attribution: a fold written while a transition is active belongs
 *    to that transition and must not commit before it settles — including
 *    UNOBSERVED keys, which have no pending node for the drain's held check
 *    to see (the write-time stamp is their hold).
 */
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  snapshot
} from "../../src/index.js";
import { $TARGET } from "../../src/store/store.js";

/** Parks an action on its own optimistic store; returns the settle handle. */
function parkForeignAction() {
  let leakSet: any;
  createRoot(() => {
    const [leak, set] = createOptimisticStore([{ id: 9 }]);
    leakSet = set;
    createRenderEffect(
      () => leak[0].id,
      () => {}
    );
  });
  flush();
  let settle!: () => void;
  const gate = new Promise<void>(r => (settle = r));
  const leakAction = action(function* () {
    leakSet((d: any) => {
      d[0].id = 10;
    });
    yield gate;
  });
  const done = leakAction();
  flush();
  return async () => {
    settle();
    await done;
    flush();
  };
}

it("an in-flight foreign action does not strand unrelated derived-store folds (#3089)", async () => {
  const settleForeign = parkForeignAction();

  // Unrelated derived store over an unrelated optimistic source, fresh root.
  let resolveServer!: () => void;
  const serverDone = new Promise<void>(r => (resolveServer = r));
  let users: any, setUsers: any, view: any;
  createRoot(() => {
    [users, setUsers] = createOptimisticStore([{ id: 1 }]);
    [view] = createStore((draft: any[]) => {
      const prev = new Map(draft.map((r: any) => [r.data?.id, r]));
      const next = users.map((u: any) => prev.get(u.id) ?? { data: u, selected: false });
      draft.length = 0;
      for (const r of next) draft.push(r);
    }, [] as any[]);
    createRenderEffect(
      () => view.length,
      () => {}
    );
  });
  flush();

  // The initial derive's fold must land despite the parked foreign
  // transition: every committed-rail read agrees.
  expect(view.length).toBe(1);
  expect(Object.keys(view)).toEqual(["0"]);
  expect(view[0].data.id).toBe(1);
  expect(snapshot(view).length).toBe(1);

  // An optimistic membership edit mid-action: the user's store shows the
  // overlay; the derived view's committed rails stay coherent at committed
  // state (the re-derive is transition-scoped and lands at settle).
  const add = action(function* () {
    setUsers((d: any) => {
      d.push({ id: 2 });
    });
    yield serverDone;
  });
  const p = add();
  flush();
  expect(users.length).toBe(2);
  expect(view.length).toBe(1); // committed — never 0, never torn
  expect(Object.keys(view)).toEqual(["0"]);
  expect(view[0]).not.toBeUndefined();

  resolveServer();
  await p;
  flush();
  expect(view.length).toBe(1); // optimistic push reverted at settle
  expect(Object.keys(view)).toEqual(["0"]);

  await settleForeign();
});

it("plain store and signal writes commit while a foreign action is in flight", async () => {
  const settleForeign = parkForeignAction();

  let sawEffect: any;
  let store: any, setStore: any, sig: any, setSig: any;
  createRoot(() => {
    [store, setStore] = createStore({ n: 0 });
    [sig, setSig] = createSignal(0);
    createRenderEffect(
      () => [store.n, sig()],
      (v: any) => {
        sawEffect = v;
      }
    );
  });
  flush();

  setStore((d: any) => {
    d.n = 1;
  });
  setSig(1);
  flush();

  expect(store.n).toBe(1);
  expect(snapshot(store).n).toBe(1);
  expect(sig()).toBe(1);
  expect(sawEffect).toEqual([1, 1]);

  await settleForeign();
});

it("writes to an unobserved store inside an action hold until settle", async () => {
  // No observers anywhere: the drain's pending-node held check has nothing
  // to consult — only the write-time transition stamp defers this fold.
  // Plain reads (and snapshot) serve the pending view, so the committed
  // backing is probed directly.
  const [store, setStore] = createStore({ n: 0 });
  const committed = () => ((store as any)[$TARGET].pb ?? (store as any)[$TARGET].v).n;
  const committedBase = () => (store as any)[$TARGET].v.n;
  let settle!: () => void;
  const gate = new Promise<void>(r => (settle = r));
  const act = action(function* () {
    setStore(d => {
      d.n = 1;
    });
    yield gate;
  });
  const p = act();
  flush();
  expect(store.n).toBe(0); // ambient reads serve committed while held
  expect(committedBase()).toBe(0); // committed backing untouched mid-action

  settle();
  await p;
  flush();
  expect(committedBase()).toBe(1); // fold lands with the settle
  expect(committed()).toBe(1);
});
