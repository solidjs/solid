/**
 * #4451 — a derived store heals with its `Errored` like the memo it derives
 * from (E3: a derived store reads like its memo; D-39: an error fallback
 * stays until a new answer replaces the error; D-25: a verdict reader's
 * derivation is the lane's).
 *
 * `m = createMemo(() => latest(s))` throws; `<Errored><Show when={v()}>…`
 * reads it plainly or through `createStore(d => { d.v = m() })`. An action
 * writes `s` to a good value and stays open: `m`'s pass is the action's
 * verdict lane's and shows the new value now (F-6), so the memo form heals
 * at the flush. The derive's pass is that lane's too (#4478), but its write
 * found no leaf — the first read of `v` threw at the pull, before the leaf
 * was born — so the staging sat on the container, and the leaf born in the
 * same flush took it as a plain staging the park then held with the frame.
 * The store form stayed on the error fallback until the action landed, and
 * a memo over `v` read the committed `undefined` beneath (NaN downstream).
 *
 * The leaf is now born carrying the lane's derivation, as `holdWithDerive`
 * leaves a leaf that existed at the write. Each case runs both forms and
 * compares every screen (the generator's E3 pair); the memo form's concrete
 * screens pin what the pair shows.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  latest
} from "../../src/index.js";

type Form = "memo" | "store";
type Shape = { loading?: boolean; asyncLeaf?: boolean; memoOver?: boolean };

const task = () => new Promise<void>(r => setTimeout(r, 0));

function scene(form: Form, shape: Shape) {
  const [s, setS] = createSignal(1);
  const screen: { view?: unknown; leaf?: unknown } = {};
  const flights: ((v: number) => void)[] = [];
  let release!: () => void;
  const dispose = createRoot(dispose => {
    const m = createMemo(() => {
      const v = latest(s);
      if (v === 1) throw new Error(`m:${v}`);
      return v;
    });
    let v: () => number;
    if (form === "memo") v = m;
    else {
      const [store] = createStore<{ v?: number }>(d => {
        d.v = m();
      }, {});
      v = () => store.v!;
    }
    // An async memo over the view (the leaf waits on it under a Loading), or
    // a sync one (reads the view's value as a derivation).
    const over = shape.asyncLeaf
      ? createMemo(() => {
          const x = v();
          return new Promise<number>(res => flights.push(res)).then(() => x + 100);
        })
      : createMemo(() => v() + 100);
    const content = () => {
      createRenderEffect(
        () => `${v()}${shape.asyncLeaf || shape.memoOver ? ` ${over()}` : ""}`,
        x => void (screen.leaf = x)
      );
      return "span";
    };
    const root = createErrorBoundary(
      () =>
        // `<Show when={v()}>`: the branch (and a Loading in it) is built by
        // the pass that finds the condition truthy.
        createMemo(() => {
          if (!v()) return "[F]";
          return shape.loading ? createLoadingBoundary(content, () => "[L]") : content();
        }),
      () => "[E]"
    );
    createRenderEffect(
      () => {
        let x: any = root();
        while (typeof x === "function") x = x();
        return x;
      },
      x => void (screen.view = x)
    );
    return dispose;
  });
  const act = action(function* (next: number) {
    setS(next);
    yield new Promise<void>(r => (release = r));
  });
  const snap = () => `${screen.view}${screen.view === "span" ? " " + screen.leaf : ""}`;
  return {
    snap,
    act,
    release: () => release(),
    land: () => flights.splice(0).forEach(r => r(0)),
    dispose
  };
}

/** Screens after: mount; the action; its flush; a task; the flight landing
 * (a task); the action's end (a task). */
async function run(form: Form, shape: Shape): Promise<string[]> {
  const t = scene(form, shape);
  const screens: string[] = [];
  flush();
  screens.push(t.snap());
  t.act(2);
  screens.push(t.snap());
  flush();
  screens.push(t.snap());
  await task();
  flush();
  screens.push(t.snap());
  t.land();
  await task();
  flush();
  screens.push(t.snap());
  t.release();
  await task();
  flush();
  screens.push(t.snap());
  t.dispose();
  return screens;
}

describe("a derived store heals with its Errored like the memo it derives from (#4451)", () => {
  it("the Show over the store opens at the action's flush, as over the memo", async () => {
    const memo = await run("memo", {});
    expect(memo).toEqual(["[E]", "[E]", "span 2", "span 2", "span 2", "span 2"]);
    expect(await run("store", {})).toEqual(memo);
  });

  it("a nested Loading born in the recovery shows its fallback over both forms", async () => {
    const memo = await run("memo", { loading: true, asyncLeaf: true });
    // (When the Errored heals here is #4425's: a Loading the recovery pass
    // mounts is recorded on it. The pair is the pin; the flight is the
    // lane's, so its landing reveals with the action's end.)
    expect(memo[0]).toBe("[E]");
    expect(memo.at(-1)).toBe("span 2 102");
    expect(await run("store", { loading: true, asyncLeaf: true })).toEqual(memo);
  });

  it("a memo over the store's key derives from the lane's value, not the committed undefined", async () => {
    const memo = await run("memo", { memoOver: true });
    expect(memo).toEqual(["[E]", "[E]", "span 2 102", "span 2 102", "span 2 102", "span 2 102"]);
    expect(await run("store", { memoOver: true })).toEqual(memo);
  });
});
