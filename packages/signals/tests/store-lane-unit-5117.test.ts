// #5117 (W): a projection's lane leaf re-runs a reader in a closing branch, as a memo's does.
import { expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  untrack
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

function desk() {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const drain = async () => {
    for (let n = 0; n < 30 && asks.length; n++) {
      for (const a of asks.splice(0)) a.res(a.key);
      await tick();
    }
  };
  return { ask, drain };
}

/** A non-keyed `<Show>`: the branch is a child of the selecting memo. */
function show(when: () => boolean, child: () => void) {
  const condition = createMemo(when);
  return createMemo(() => (condition() ? untrack(child) : undefined));
}

for (const form of ["memo", "projection"] as const)
  it(`#5117 (${form}): readers inside and outside a closing branch show one value`, async () => {
    const d = desk();
    const shown: { outer?: string; inner?: string } = {};
    let act!: (x: number) => void;
    createRoot(() => {
      const [s, setS] = createSignal(0);
      const [o, setO] = createOptimistic(() => d.ask("o:" + s()));
      let p: { n: any };
      if (form === "memo") {
        const m = createMemo(() => o());
        p = {
          get n() {
            return m();
          }
        };
      } else p = createProjection<{ n: any }>(draft => void (draft.n = o()), { n: 0 });
      act = action(function* (x: number) {
        setS(x);
        setO("G");
        yield d.ask("save");
      });
      createRenderEffect(
        () => p.n,
        v => void (shown.outer = String(v))
      );
      const branch = show(
        () => s() < 2,
        () =>
          createRenderEffect(
            () => p.n,
            v => void (shown.inner = String(v))
          )
      );
      createRenderEffect(branch, () => {});
    });
    await tick();
    await d.drain();
    act(2);
    await tick();
    const mid = { ...shown };
    await d.drain();
    expect(mid).toEqual({ outer: "G", inner: "G" });
  });
