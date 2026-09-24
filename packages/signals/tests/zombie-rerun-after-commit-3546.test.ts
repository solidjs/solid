// #3546: zombies of a committing owner do not rerun before the commit.
//
// While any transaction is parked, the ambient flush reruns the zombie queue
// so the zombies of PARKED owners — still on screen until the commit that
// disposes them (#3463) — follow mainline writes (#2916). It ran that queue
// before committing the flush's own pending nodes, so an owner that recreates
// a child every pass (the compiled `<Show when={n() > 0 && n() < 2}>`
// condition) paid twice per write: its old child, dirtied by the same write
// and zombified by the owner's pass, reran as a zombie, changed, and notified
// the owner through the previous pass's dependency tail — kept linked by A30
// until the commit trims it — and the owner recomputed a second time with
// identical inputs, creating and disposing one more child. Now the commit
// runs first: a zombie whose owner commits this flush is disposed by that
// commit and never reruns, exactly as when no transaction is parked. A30 is
// untouched — the tail is still kept for the commit to trim (#3469, #3410).

import {
  DEV,
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  getOwner
} from "../src/index.js";

afterEach(() => flush());

/** An action that writes a signal a render effect reads, then parks. */
function parkedAction() {
  let resolveSave: () => void = () => {};
  const [saved, setSaved] = createSignal(false);
  const save = action(function* () {
    setSaved(true);
    yield new Promise<void>(r => (resolveSave = r));
  }) as () => Promise<void>;
  createRenderEffect(saved, () => {});
  return { save, resolve: () => resolveSave() };
}

function alternate(setN: (v: number) => void, times: number) {
  for (let i = 1; i <= times; i++) {
    setN(i % 2);
    flush();
  }
}

it("an owner that recreates a child per pass runs once per mainline write while an unrelated action is parked", async () => {
  const state = { ownerRuns: 0, childCreations: 0, childRuns: 0 };
  let condOwner!: any;
  let setN!: (v: number) => void;
  let save!: () => Promise<void>;
  let resolve!: () => void;

  const dispose = createRoot(d => {
    const [n, _setN] = createSignal(0);
    setN = _setN;
    ({ save, resolve } = parkedAction());
    // <Show when={n() > 0 && n() < 2}> compiles the getter to
    // `memo(() => n() > 0)() && n() < 2`: the condition memo creates a nested
    // sync memo on `n` every pass and reads `n` directly too
    const conditionValue = createMemo(() => {
      state.ownerRuns++;
      condOwner = getOwner();
      state.childCreations++;
      const inner = createMemo(
        () => {
          state.childRuns++;
          return n() > 0;
        },
        { sync: true }
      );
      return inner() && n() < 2;
    });
    const condition = createMemo(conditionValue, { equals: (a, b) => !a === !b, sync: true });
    const show = createMemo(() => (condition() ? "Visible" : undefined));
    createRenderEffect(show, () => {});
    return d;
  });
  flush();

  // control: no transaction parked — one owner pass, one child per write
  const base = { ...state };
  alternate(setN, 40);
  const control = {
    ownerRuns: state.ownerRuns - base.ownerRuns,
    childCreations: state.childCreations - base.childCreations,
    childRuns: state.childRuns - base.childRuns
  };
  expect(control.ownerRuns).toBe(40);
  expect(control.childCreations).toBe(40);
  expect(DEV!.getChildren(condOwner).length).toBe(1);

  // park an unrelated action, then keep alternating: the same cost
  const p = save();
  flush();
  const before = { ...state };
  alternate(setN, 40);
  expect(state.ownerRuns - before.ownerRuns).toBe(control.ownerRuns);
  expect(state.childCreations - before.childCreations).toBe(control.childCreations);
  expect(state.childRuns - before.childRuns).toBe(control.childRuns);
  expect(DEV!.getChildren(condOwner).length).toBe(1);

  // and after the action lands
  resolve();
  await p;
  flush();
  const after = { ...state };
  alternate(setN, 40);
  expect(state.ownerRuns - after.ownerRuns).toBe(control.ownerRuns);
  expect(state.childCreations - after.childCreations).toBe(control.childCreations);
  expect(state.childRuns - after.childRuns).toBe(control.childRuns);

  dispose();
});

// The router redirect shape (#2916 / #3463): the outlet's swap to an async
// branch parks, branch "a" stays displayed as the zombie old tree, and a
// mainline write in a later flush must still reach it — its memo reruns and
// its render effect applies the new value in that same flush.
it("zombies of a genuinely parked owner still rerun for mainline writes in a later flush", async () => {
  const [route, setRoute] = createSignal("a");
  const [version, setVersion] = createSignal(0);
  const state = { pageRuns: 0, applied: [] as number[], outletRuns: 0 };
  let resolveB: (v: string) => void = () => {};

  const dispose = createRoot(d => {
    const outlet = createMemo(() => {
      state.outletRuns++;
      if (route() === "a") {
        const pageData = createMemo(() => {
          state.pageRuns++;
          return version();
        });
        createRenderEffect(pageData, v => {
          state.applied.push(v);
        });
        return "A";
      }
      return createMemo(() => new Promise<string>(r => (resolveB = r)))();
    });
    createRenderEffect(outlet, () => {});
    return d;
  });
  flush();
  expect(state.pageRuns).toBe(1);
  expect(state.applied).toEqual([0]);

  // park the swap alone: branch "a" is the zombie old tree
  setRoute("b");
  flush();
  expect(state.outletRuns).toBe(2);
  expect(state.pageRuns).toBe(1);

  // an independent mainline flush: the displayed old tree follows it
  setVersion(1);
  flush();
  expect(state.pageRuns).toBe(2);
  expect(state.applied).toEqual([0, 1]);
  // the parked owner did not rerun for it
  expect(state.outletRuns).toBe(2);

  resolveB("B");
  await Promise.resolve();
  flush();
  expect(state.pageRuns).toBe(2);
  expect(state.applied).toEqual([0, 1]);

  dispose();
});

// A zombie that reruns notifies the subscribers that survive the commit — a
// live reader outside the parked tree, its own render effect — and not one
// the commit just disposed: a child a live owner replaced this pass, dirtied
// by the same write, is gone before the zombie queue runs and never reruns.
it("a zombie that reruns notifies only subscribers that survive the commit", async () => {
  const [route, setRoute] = createSignal("a");
  const [version, setVersion] = createSignal(0);
  const state = {
    zombieRuns: 0,
    zombieApplied: [] as number[],
    outsideRuns: 0,
    ownerRuns: 0,
    childRuns: [] as number[], // per child generation
    childApplied: [] as string[]
  };
  let zombieMemo!: () => number;
  let recreatingOwner!: any;
  let resolveB: (v: string) => void = () => {};

  const dispose = createRoot(d => {
    const outlet = createMemo(() => {
      if (route() === "a") {
        const pageData = createMemo(() => {
          state.zombieRuns++;
          return version();
        });
        zombieMemo = pageData;
        createRenderEffect(pageData, v => {
          state.zombieApplied.push(v);
        });
        return "A";
      }
      return createMemo(() => new Promise<string>(r => (resolveB = r)))();
    });
    createRenderEffect(outlet, () => {});
    // a live reader of the (soon zombie) memo, outside the parked tree
    const outside = createMemo(() => {
      state.outsideRuns++;
      return zombieMemo() * 10;
    });
    createRenderEffect(outside, () => {});
    // a live owner that replaces its child every pass. Child 0 reads the
    // zombie memo (and the written signal); its replacement does not — a
    // tracked read of a dirty node pulls it inline, and this test wants the
    // zombie QUEUE's rerun, after the commit
    const owner = createMemo(() => {
      state.ownerRuns++;
      recreatingOwner = getOwner();
      const gen = state.childRuns.length;
      state.childRuns.push(0);
      const child = createMemo(() => {
        state.childRuns[gen]++;
        return `${gen}:${version() === 0 ? zombieMemo() : "-"}:${version()}`;
      });
      createRenderEffect(child, v => {
        state.childApplied.push(v);
      });
      return version();
    });
    createRenderEffect(owner, () => {});
    return d;
  });
  flush();
  expect(state.zombieRuns).toBe(1);
  expect(state.outsideRuns).toBe(1);
  expect(state.ownerRuns).toBe(1);
  expect(state.childRuns).toEqual([1]);
  expect(state.childApplied).toEqual(["0:0:0"]);

  // park the swap: `pageData` is a zombie of the parked outlet
  setRoute("b");
  flush();
  expect(state.zombieRuns).toBe(1);

  // one mainline write: the owner's pass replaces child 0 with child 1, the
  // commit disposes child 0 and trims the owner's tail, THEN the zombie reruns
  setVersion(1);
  flush();
  expect(state.zombieRuns).toBe(2);
  expect(state.zombieApplied).toEqual([0, 1]);
  // survivors: the outside reader re-derives from it
  expect(state.outsideRuns).toBe(2);
  // the owner ran once and created one child; child 0 — dirtied by the same
  // write, a subscriber of the zombie memo — was disposed by the commit
  // before the zombie queue ran and never reran
  expect(state.ownerRuns).toBe(2);
  expect(state.childRuns).toEqual([1, 1]);
  expect(state.childApplied).toEqual(["0:0:0", "1:-:1"]);
  expect(DEV!.getChildren(recreatingOwner).length).toBe(2); // child memo + its effect

  resolveB("B");
  await Promise.resolve();
  flush();
  expect(state.zombieRuns).toBe(2);
  expect(state.ownerRuns).toBe(2);

  dispose();
});
