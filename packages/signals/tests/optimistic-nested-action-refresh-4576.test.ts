import { expect, test } from "vitest";
import {
  action,
  createErrorBoundary,
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

test("nested action guesses over a filter change: the memo's screen ends on the last refresh (F-2, D-33)", async () => {
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
  let shown = "",
    issuesRef: any,
    setFilter!: (v: string) => void,
    closeTwo!: (a: number, b: number) => unknown,
    dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const [filter, sf] = createSignal("open");
    setFilter = sf;
    const [issues, set] = createOptimisticStore<{ id: number }[]>(
      () => ask(`issues:${filter()}`),
      [],
      { key: "id" }
    );
    issuesRef = issues;
    const other = createMemo(() => ask(`other:${filter()}`));
    const remove = (id: number) =>
      set(xs => {
        const i = xs.findIndex(t => t.id === id);
        if (i >= 0) xs.splice(i, 1);
      });
    const inner = action(function* (id: number) {
      remove(id);
      yield ask(`close:${id}`);
      refresh(issues);
    });
    closeTwo = action(function* (a: number, b: number) {
      remove(a);
      yield inner(b);
      yield ask(`close:${a}`);
      refresh(issues);
    });
    createRenderEffect(
      createMemo(() => `${filter()}: ${issues.map(r => `[#${r.id}]`).join("")}`),
      v => {
        shown = v;
      }
    );
    createRenderEffect(
      createErrorBoundary(
        () => other(),
        () => "ERR"
      ) as any,
      () => {}
    );
  });
  await tick();
  await settle("issues:open", [{ id: 1 }, { id: 3 }, { id: 4 }]);
  await settle("other:open", "O-open");
  setFilter("closed");
  await tick();
  closeTwo(1, 2);
  await tick();
  await settle("issues:closed", [{ id: 1 }, { id: 2 }, { id: 5 }]);
  await settle("other:closed", "O-closed");
  await settle("close:2", {});
  await settle("issues:closed", [{ id: 1 }, { id: 5 }]);
  await settle("close:1", {});
  await settle("issues:closed", [{ id: 5 }]);
  for (let i = 0; i < 5; i++) await tick();
  expect(asks.map(a => a.key)).toEqual([]);
  expect(issuesRef.map((r: any) => r.id)).toEqual([5]);
  expect(shown).toBe("closed: [#5]");
  dispose();
});
