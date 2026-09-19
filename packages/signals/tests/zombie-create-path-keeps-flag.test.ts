// #3543 follow-up: a zombie whose FIRST run happens mid-flush must stay a
// zombie too.
//
// `recompute`'s wipe of `_flags` has two shapes: the regular rerun (covered
// by zombie-recompute-keeps-flag.test.ts) and the `create` pass — the first
// run of a node — which additionally carries REACTIVE_SNAPSHOT_STALE. The
// create pass IS reachable on a zombie: `markDisposal` flags every child of a
// rerunning owner, including a lazy memo that has never run, and that
// memo's first read goes `prepareComputed` → `recompute(comp, true)`. A fix
// that preserved REACTIVE_ZOMBIE only on the non-create arm (the #3545
// variant, `el._flags & (create ? REACTIVE_SNAPSHOT_STALE : REACTIVE_ZOMBIE)`)
// de-flags exactly this node, and `disposeChildren` then splices it out of
// the owner's LIVE chain instead of the pending one. The lazy memo is created
// last, so it heads the chain (`_prevSibling === null`) and the bad splice is
// `parent._firstChild = <its dead zombie sibling>`: the owner's current
// children are orphaned — never disposed by the owner, never zombified by its
// next rerun, still subscribed to their sources after the root is gone.
//
// Unlike the rerun shape, this one needs no parked transaction: the zombie's
// create pass is driven synchronously by a read from the owner's new pass,
// inside the same flush that disposes it. The parked-action phase is kept so
// the scheduler's zombie reruns (#3463) are in the mix as well.
//
// Shape: an owner memo that on every pass creates a render effect and THEN a
// lazy memo on `n`. The effect's compute runs synchronously at creation, so
// on a `p=true` pass it reads the lazy memo the previous pass left behind —
// which the owner's rerun has just flagged as a zombie.

import {
  DEV,
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  getOwner,
  isDisposed
} from "../src/index.js";

afterEach(() => flush());

function setup() {
  const state = { effectRuns: 0, latestEffect: null as any };
  let nNode!: any;
  let owner!: any;
  let setN!: (v: number) => void;
  let setP!: (v: boolean) => void;
  let resolveSave: () => void = () => {};
  let save!: () => Promise<void>;

  const dispose = createRoot(d => {
    const [n, _setN] = createSignal(0);
    const [p, _setP] = createSignal(true);
    setN = _setN;
    setP = _setP;
    nNode = DEV!.getSignals(getOwner()!)[0];
    const [saved, setSaved] = createSignal(false);
    // the action writes before it parks, so the write is the transaction's
    save = action(function* () {
      setSaved(true);
      yield new Promise<void>(r => (resolveSave = r));
    }) as () => Promise<void>;
    // sibling binding reading the action-written signal
    createRenderEffect(saved, () => {});
    let lz: (() => boolean) | undefined;
    const ownerMemo = createMemo(() => {
      owner = getOwner();
      // runs now, reading the PREVIOUS pass's lazy memo — a zombie at this
      // point — through its create pass
      createRenderEffect(
        () => {
          state.effectRuns++;
          return p() && lz ? lz() : false;
        },
        () => {}
      );
      // the node just prepended (a zombie rerunning later must not pass for
      // it, so it is taken here rather than from inside the compute)
      state.latestEffect = DEV!.getChildren(owner)[0];
      // created last: heads the owner's child chain (`_prevSibling === null`)
      lz = createMemo(() => n() > 0, { lazy: true });
      return p();
    });
    createRenderEffect(ownerMemo, () => {});
    return d;
  });
  flush();
  return {
    state,
    setN,
    setP,
    save,
    resolve: () => resolveSave(),
    observers: () => DEV!.getObservers(nNode).length,
    // the owner's live chain must hold the current pass's effect and nothing
    // dead: the bad splice leaves a disposed zombie as its only member
    expectChainSane: () => {
      const children = DEV!.getChildren(owner);
      expect(children).toContain(state.latestEffect);
      expect(children.filter(c => isDisposed(c))).toEqual([]);
    },
    dispose
  };
}

function round(setN: (v: number) => void, setP: (v: boolean) => void, times: number) {
  for (let i = 1; i <= times; i++) {
    setP(false);
    flush();
    setN(i % 2);
    setP(true);
    flush();
  }
}

it("keeps the owner's chain intact when a zombie's first run happens mid-flush", async () => {
  const { state, setN, setP, save, resolve, observers, expectChainSane, dispose } = setup();

  // steady state after one round: nothing left observing `n` once the pass
  // that read the previous lazy memo has disposed it
  round(setN, setP, 1);
  const steady = observers();
  expectChainSane();

  // no transaction: the zombie's create pass alone is enough to hit the bug
  for (let i = 0; i < 20; i++) {
    round(setN, setP, 1);
    expectChainSane();
    expect(observers()).toBe(steady);
  }

  // park an unrelated action so the scheduler reruns zombies too (#3463)
  const p = save();
  flush();
  for (let i = 0; i < 20; i++) {
    round(setN, setP, 1);
    expectChainSane();
    expect(observers()).toBe(steady);
  }

  // and after the action lands
  resolve();
  await p;
  flush();
  for (let i = 0; i < 20; i++) {
    round(setN, setP, 1);
    expectChainSane();
    expect(observers()).toBe(steady);
  }

  // an orphan would survive the root: still subscribed, still running
  dispose();
  expect(observers()).toBe(0);
  const runs = state.effectRuns;
  round(setN, setP, 2);
  expect(state.effectRuns).toBe(runs);
});
