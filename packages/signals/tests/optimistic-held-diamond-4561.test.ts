import { expect, it } from "vitest";
import {
  action,
  createEffect,
  createLoadingBoundary,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  refresh
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

it("#4561 held(): a diamond lattice of pending memos is walked linearly", async () => {
  const L = 22;
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const settle = async (key: string, v: any) => {
    asks
      .splice(
        asks.findIndex(a => a.key === key),
        1
      )[0]
      .res(v);
    await tick();
  };
  let setFilter!: (f: string) => void, closeOne!: (id: number) => any;
  const dispose = createRoot(d => {
    const [filter, sf] = createSignal("open");
    setFilter = sf;
    const [issues, set] = createOptimisticStore<any[]>(() => ask(`issues:${filter()}`), [], {
      key: "id"
    });
    closeOne = action(function* (id: number) {
      set(
        l =>
          void l.splice(
            l.findIndex(t => t.id === id),
            1
          )
      );
      yield ask(`close:${id}`);
      refresh(issues);
    });
    const b = createLoadingBoundary(
      () => {
        createRenderEffect(filter, () => {});
        let layer: (() => any)[] = [createMemo(() => issues.map((i: any) => i.id).join(","))];
        for (let i = 0; i < L; i++) {
          const p = layer;
          layer = [
            createMemo(() => p.map(m => m()).join("|").length),
            createMemo(() => p.map(m => m()).join("|").length + 1)
          ];
        }
        const top = layer;
        createEffect(
          () => top.map(m => m()).join(),
          () => {}
        );
        return "c";
      },
      () => "L"
    );
    createRenderEffect(b, () => {});
    return d;
  });
  await tick();
  await settle("issues:open", [{ id: 1 }, { id: 3 }, { id: 4 }]);
  setFilter("closed");
  await tick();
  const t0 = performance.now();
  closeOne(1);
  flush();
  expect(performance.now() - t0).toBeLessThan(50);
  dispose();
});
