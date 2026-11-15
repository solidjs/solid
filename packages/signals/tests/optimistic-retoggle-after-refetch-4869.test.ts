// #4869: a keyed optimistic row toggled twice while the first toggle's
// action is out, a refetch landing between the toggles. The refetch
// corrects the first guess, whose screen stays until its hold lands
// (D-34); the second toggle's setter composes on that screen and its guess
// must show. It went on a new carrier over the committed row and was
// dropped as no change. The DOM version is
// packages/web/test/optimistic-retoggle-after-refetch-4869.spec.tsx.
import { test, expect } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush,
  refresh
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  flush();
};

test("#4869 a second toggle shows after a refetch landed between the toggles", async () => {
  let server = [{ id: 0, done: false }];
  const asks: Record<string, () => void> = {};
  const ask = (k: string, f = () => {}) =>
    new Promise<void>(
      r =>
        (asks[k] = () => {
          delete asks[k];
          f();
          r();
        })
    );
  let n = 0,
    t = 0,
    out = "";
  const list = createMemo(async () => {
    await ask("list" + n++);
    return structuredClone(server);
  });
  const [todos, setTodos] = createOptimisticStore(() => list(), null as any, { key: "id" } as any);
  const toggle = action(function* () {
    setTodos((d: any[]) => {
      d[0].done = !d[0].done;
    });
    yield ask("toggle" + t++, () => {
      server = server.map(x => ({ ...x, done: !x.done }));
    });
    refresh(list);
  });
  const refetch = action(function* () {
    refresh(list);
  });
  createRoot(() =>
    createRenderEffect(
      () => (todos as any[]).map(r => (r.done ? "done" : "open")).join(","),
      v => {
        out = v;
      }
    )
  );
  asks.list0();
  await tick();
  expect(out).toBe("open");
  toggle();
  await tick();
  expect(out).toBe("done");
  refetch();
  await tick();
  asks.list1();
  await tick();
  expect(out).toBe("done");
  toggle();
  await tick();
  expect(out).toBe("open");
  asks.toggle0();
  await tick();
  asks.list2();
  await tick();
  expect(out).toBe("open");
  asks.toggle1();
  await tick();
  asks.list3();
  await tick();
  expect(out).toBe("open");
});
