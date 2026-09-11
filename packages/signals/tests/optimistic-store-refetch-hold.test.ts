/**
 * #2951 — bare (transaction-less) optimistic store writes made while the
 * store's own truth is in flight must ride that refetch, not revert at plain
 * flush end. Optimistic state clears when truth lands or its transaction
 * settles — never on a timer.
 *
 * The broken shape: a click handler writes a plain dep (triggering a refetch
 * of the derived optimistic store) and pushes an optimistic row in the same
 * tick. The flush's transition adopted the write but nothing marked it
 * blocked — signal-form createOptimistic carries the pending async and the
 * override on ONE node (so transitionBlocked sees both), while the store form
 * splits them between the firewall computed and the store targets' layer. The
 * transition settled in the same flush that started the refetch, its settle
 * consumed the layer, and the next click's draft composed on committed base —
 * clobbering the still-rendered optimistic row instead of stacking on it.
 */
import { expect, test } from "vitest";
import {
  action,
  createEffect,
  createOptimisticStore,
  createRoot,
  createSignal,
  flush,
  refresh
} from "../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 0));

function setup() {
  let setCount!: (v: number) => void;
  let setS!: (fn: (s: { items: string[] }) => void) => void;
  let dispose!: () => void;
  const resolvers: ((items: string[]) => void)[] = [];
  const views: string[][] = [];

  createRoot(d => {
    dispose = d;
    const [count, _setCount] = createSignal(0);
    setCount = _setCount;
    const [store, _setS] = createOptimisticStore<{ items: string[] }>(
      async () => {
        count();
        const items = await new Promise<string[]>(r => resolvers.push(r));
        return { items };
      },
      { items: [] }
    );
    setS = _setS;
    createEffect(
      () => store.items.slice(),
      v => {
        views.push(v);
      }
    );
  });
  return { setCount, setS, resolvers, views, dispose };
}

test("#2951: consecutive bare writes stack on the same optimistic view until truth lands", async () => {
  const { setCount, setS, resolvers, views, dispose } = setup();
  flush();
  await tick();
  resolvers[0](["A"]);
  await tick();
  flush();
  expect(views.at(-1)).toEqual(["A"]);

  // Click 1: plain dep write starts a (slow) refetch; the bare optimistic
  // push in the same tick must survive the flush that starts it.
  setCount(1);
  setS(d => {
    d.items.push("U2*");
  });
  flush();
  await tick();
  expect(views.at(-1)).toEqual(["A", "U2*"]);

  // Clicks 2 and 3 land while truth is still in flight: each draft composes
  // ON TOP of the live optimistic view (same primitive -> same transaction).
  setCount(2);
  setS(d => {
    expect(d.items.slice()).toEqual(["A", "U2*"]);
    d.items.push("U3*");
  });
  flush();
  await tick();
  expect(views.at(-1)).toEqual(["A", "U2*", "U3*"]);

  setCount(3);
  setS(d => {
    d.items.push("U4*");
  });
  flush();
  await tick();
  expect(views.at(-1)).toEqual(["A", "U2*", "U3*", "U4*"]);

  // Truth supersedes every tentative layer: the projection landing consumes
  // the overrides and the settled transaction sweeps the rest.
  const all = ["A", "U2", "U3", "U4"];
  for (let i = 1; i < resolvers.length; i++) resolvers[i](all);
  await tick();
  flush();
  await tick();
  flush();
  expect(views.at(-1)).toEqual(all);
  dispose();
});

test("#2951: write order within the tick does not matter (optimistic write first)", async () => {
  const { setCount, setS, resolvers, views, dispose } = setup();
  flush();
  await tick();
  resolvers[0](["A"]);
  await tick();
  flush();

  setS(d => {
    d.items.push("U2*");
  });
  setCount(1);
  flush();
  await tick();
  expect(views.at(-1)).toEqual(["A", "U2*"]);

  setS(d => {
    d.items.push("U3*");
  });
  setCount(2);
  flush();
  await tick();
  expect(views.at(-1)).toEqual(["A", "U2*", "U3*"]);

  const all = ["A", "U2", "U3"];
  for (let i = 1; i < resolvers.length; i++) resolvers[i](all);
  await tick();
  flush();
  await tick();
  flush();
  expect(views.at(-1)).toEqual(all);
  dispose();
});

test("#2951: a bare write during an already in-flight refetch (later tick) also holds", async () => {
  const { setCount, setS, resolvers, views, dispose } = setup();
  flush();
  await tick();
  resolvers[0](["A"]);
  await tick();
  flush();

  // Start the refetch alone.
  setCount(1);
  flush();
  await tick();
  expect(views.at(-1)).toEqual(["A"]);

  // A later tick's bare optimistic write must still ride the in-flight truth.
  setS(d => {
    d.items.push("U2*");
  });
  flush();
  await tick();
  expect(views.at(-1)).toEqual(["A", "U2*"]);

  resolvers[1](["A", "U2"]);
  await tick();
  flush();
  await tick();
  flush();
  expect(views.at(-1)).toEqual(["A", "U2"]);
  dispose();
});

test("#2951: bare write on a derived store with settled truth keeps flash semantics", async () => {
  const { setS, resolvers, views, dispose } = setup();
  flush();
  await tick();
  resolvers[0](["A"]);
  await tick();
  flush();
  expect(views.at(-1)).toEqual(["A"]);

  // No refetch in flight: an ambient optimistic write with no transaction and
  // no truth on the way reverts at plain flush end, as before.
  setS(d => {
    d.items.push("X*");
  });
  flush();
  expect(views.at(-1)).toEqual(["A"]);
  dispose();
});

// The compose half, one landing later: three votes in flight as actions
// (optimistic `votes++`, server confirm, `refresh(store)`). When the first
// vote's truth lands while the second is still retained, the landing is
// staged into the retaining transaction and the second vote's increment is
// replayed over it. A THIRD click's draft then read the staged truth WITHOUT
// that replayed override (draft reads composed overrides only while no
// pending backing existed — ensurePB's hand-off reseeds from the view on
// the first write, but `votes++` reads first): base 1, wrote 2, and the
// override landed on the value already displayed — the click was invisible
// and the count stuck until truth caught up.
test("#2951 compose half: an increment made after a sibling landing still stacks on the retained increment", async () => {
  type Row = { id: number; votes: number };
  const db: Row[] = [{ id: 1, votes: 0 }];
  const fetches: Array<() => void> = [];
  const getList = () => new Promise<Row[]>(res => fetches.push(() => res(structuredClone(db))));
  const confirms: Array<() => void> = [];
  const addVote = () =>
    new Promise<void>(res =>
      confirms.push(() => {
        db[0].votes++;
        res();
      })
    );
  const views: number[] = [];
  let list!: Row[];
  let vote!: () => unknown;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    let setList!: (fn: (l: Row[]) => void) => void;
    [list, setList] = createOptimisticStore<Row[]>(() => getList(), []);
    vote = action(function* () {
      setList(l => {
        l[0].votes++;
      });
      yield addVote();
      refresh(list as any);
    });
    createEffect(
      () => list[0]?.votes,
      v => {
        views.push(v);
      }
    );
  });
  flush();
  fetches.shift()!();
  await tick();
  flush();
  const settle = async () => {
    await tick();
    flush();
    await tick();
    flush();
  };

  vote(); // A
  await settle();
  vote(); // B
  await settle();
  expect(list[0].votes).toBe(2);

  confirms.shift()!(); // A confirmed → A refreshes
  await settle();
  fetches.shift()!(); // A's truth (1) lands; B still in flight, its +1 replays
  await settle();
  expect(list[0].votes).toBe(2);

  vote(); // C: must stack on B's retained increment, not on the staged truth
  await settle();
  expect(list[0].votes).toBe(3);

  confirms.shift()!();
  await settle();
  fetches.shift()!(); // B's truth (2) lands; C's +1 replays
  await settle();
  expect(list[0].votes).toBe(3);

  confirms.shift()!();
  await settle();
  fetches.shift()!(); // C's truth (3) lands
  await settle();
  expect(list[0].votes).toBe(3);
  // Every visible value is monotonic — no click ever reads back a smaller
  // count (equal-value re-runs at a landing's override → committed swap are
  // fine).
  expect(views.filter((v, i) => i === 0 || v !== views[i - 1])).toEqual([0, 1, 2, 3]);
  dispose();
  flush();
});
