import { test, expect } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray
} from "../src/index.js";

type Item = { id: number; text: string };

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

// #4971: a keyed projection over [...answer, ...placeholders]. The add's
// placeholder (id -1) is replaced by the server's row (id 24) when the add is
// accepted. A subscribed read of `length` must follow the landed array.
test("#4971 a subscribed length over a keyed projection follows a replaced placeholder", async () => {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const take = (key: string) => {
    const i = asks.findIndex(a => a.key === key);
    if (i < 0) throw new Error("no ask " + key);
    return asks.splice(i, 1)[0];
  };
  const out = { rows: "", count: "" };
  const { add, dispose } = createRoot(dispose => {
    const [list, setList] = createSignal<Item[]>(async () => await ask("list"), {
      loadingValue: [] as Item[]
    } as any);
    const [adding, guessAdding] = createOptimistic<Item[]>(() => []);
    const rows = createMemo(() => [
      ...list().map(it => ({ id: it.id, text: it.text })),
      ...adding().map(a => ({ id: a.id, text: a.text + " (adding…)" }))
    ]);
    const items: any = createProjection(() => rows() as any, [] as any, { key: "id" } as any);
    const count = createMemo(() => `${items.length} items`);
    const mapped = mapArray(
      () => items,
      (it: any) => () => it.text
    );
    createRenderEffect(
      () =>
        mapped()
          .map((r: any) => r())
          .join(", "),
      v => {
        out.rows = v;
      }
    );
    createRenderEffect(count, v => {
      out.count = v;
    });
    const add = action(function* (key: number, text: string) {
      guessAdding(xs => [...xs, { id: key, text }]);
      const it: Item = yield ask(`add:${text}`);
      setList(xs => [...xs, it]);
    });
    return { add, dispose };
  });
  await tick();
  take("list").res([
    { id: 21, text: "repro" },
    { id: 22, text: "patch" }
  ]);
  await tick();
  expect(`${out.rows} | ${out.count}`).toBe("repro, patch | 2 items");
  add(-1, "ship");
  await tick();
  expect(`${out.rows} | ${out.count}`).toBe("repro, patch, ship (adding…) | 3 items");
  take("add:ship").res({ id: 24, text: "ship" });
  await tick();
  expect(`${out.rows} | ${out.count}`).toBe("repro, patch, ship | 3 items");
  dispose();
});
