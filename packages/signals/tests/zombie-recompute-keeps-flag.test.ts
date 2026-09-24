// #3543: a zombie that recomputes must stay a zombie.
//
// A recompute defers the previous pass's children as zombies on the owner's
// `_pendingFirstChild` (REACTIVE_ZOMBIE) until the owner's commit disposes
// them; the replacement children take `_firstChild`. While any transaction is
// parked, the scheduler reruns zombies for mainline writes (#3463: a zombie
// renders until the commit that disposes it), and `recompute` /
// `updateIfNecessary` rewrote `_flags` wholesale — dropping REACTIVE_ZOMBIE.
// `disposeChildren` keys its parent-chain splice off that flag, so the
// de-flagged zombie spliced itself out of the LIVE chain: with `_prevSibling`
// null that is `parent._firstChild = null`, orphaning the replacement, which
// stays subscribed to its sources and recomputes forever. One leaked node per
// owner rerun; the reduced case reached HUGE_FAN_OUT.
//
// Shape (the compiled `<Show when={n() > 0 && n() < 2}>` condition): an
// owner memo that creates a nested memo reading `n` on every pass, a parked
// action writing an unrelated signal a sibling reads, and `n` alternating.

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

function setup() {
  const state = { innerRuns: 0 };
  let nNode!: any;
  let condOwner!: any;
  let setN!: (v: number) => void;
  let resolveSave: () => void = () => {};
  let save!: () => Promise<void>;

  const dispose = createRoot(d => {
    const [n, _setN] = createSignal(0);
    setN = _setN;
    nNode = DEV!.getSignals(getOwner()!)[0];
    const [saved, setSaved] = createSignal(false);
    // the action writes before it parks, so the write is the transaction's
    save = action(function* () {
      setSaved(true);
      yield new Promise<void>(r => (resolveSave = r));
    }) as () => Promise<void>;
    // sibling binding reading the action-written signal
    createRenderEffect(saved, () => {});
    // <Show when={n() > 0 && n() < 2}> compiles the getter to
    // `memo(() => n() > 0)() && n() < 2`: Show's condition memo creates a
    // nested sync memo on `n` and reads `n` directly too
    const conditionValue = createMemo(() => {
      condOwner = getOwner();
      const inner = createMemo(
        () => {
          state.innerRuns++;
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
  return {
    state,
    setN,
    save,
    resolve: () => resolveSave(),
    observers: () => DEV!.getObservers(nNode).length,
    liveChildren: () => DEV!.getChildren(condOwner).length,
    dispose
  };
}

function alternate(setN: (v: number) => void, times: number) {
  for (let i = 1; i <= times; i++) {
    setN(i % 2);
    flush();
  }
}

it("keeps the subscriber count bounded while an unrelated action is parked", async () => {
  const { state, setN, save, resolve, observers, liveChildren, dispose } = setup();

  // control: no transaction — one nested memo replaces the last each pass
  // (`&&` short-circuits at n=0, so the count depends on parity: measure it)
  const runsBefore = state.innerRuns;
  alternate(setN, 40);
  const control = observers();
  const controlRuns = state.innerRuns - runsBefore;
  expect(liveChildren()).toBe(1);

  // park an unrelated action, then keep alternating
  const p = save();
  flush();
  const before = state.innerRuns;
  alternate(setN, 40);
  expect(observers()).toBe(control);
  expect(liveChildren()).toBe(1);
  // no extra runs: the owner commits every pass, so its zombie is disposed by
  // the commit before the zombie queue runs (#3546) — an orphan would add a
  // run per pass for every leaked node, and a pre-commit zombie rerun added
  // one zombie run plus one second owner pass per write
  expect(state.innerRuns - before).toBe(controlRuns);

  // and after the action lands
  resolve();
  await p;
  flush();
  alternate(setN, 40);
  expect(observers()).toBe(control);
  expect(liveChildren()).toBe(1);

  dispose();
  expect(observers()).toBe(0);
});
