import { test, expect } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
type Row = { id: number; title: string; adding?: boolean };

for (const first of ["A1", "A2"])
  test(`#4874 two entangled adds, ${first} answered first: neither truth shows before both return`, async () => {
    const asks: { key: string; res: (v: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
    const take = (key: string) =>
      asks.splice(
        asks.findIndex(a => a.key === key),
        1
      )[0];
    const [ans, setAns] = createSignal<Row[]>([{ id: 1, title: "W" }]);
    const [board, guess] = createOptimisticStore<Row[]>(() => ans().map(r => ({ ...r })), [], {
      key: "id"
    } as any);
    const add = action(function* (key: number, title: string, at: number) {
      guess(b => {
        b[at] = { id: key, title, adding: true };
      });
      const r = yield ask(`add:${title}`);
      setAns(cs => [...cs, { id: r.id, title }]);
    });
    let out = "";
    createRoot(() => {
      const rows = mapArray(
        () => board,
        (r: Row) => () => (r.adding ? `${r.title}(adding)` : `#${r.id} ${r.title}`)
      );
      createRenderEffect(
        () =>
          rows()
            .map(f => f())
            .join(" "),
        v => {
          out = v;
        }
      );
    });
    await tick();
    add(-1, "A1", board.length);
    await tick();
    add(-2, "A2", board.length);
    await tick();
    expect(out).toBe("#1 W A1(adding) A2(adding)");
    take(`add:${first}`).res({ id: first === "A1" ? 10 : 11 });
    await tick();
    expect(out).toBe("#1 W A1(adding) A2(adding)");
    const second = first === "A1" ? "A2" : "A1";
    take(`add:${second}`).res({ id: second === "A1" ? 10 : 11 });
    await tick();
    expect(out).toBe(first === "A1" ? "#1 W #10 A1 #11 A2" : "#1 W #11 A2 #10 A1");
  });

test("#4874 three entangled adds, the middle one answered first: nothing shows before all return", async () => {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const take = (key: string) =>
    asks.splice(
      asks.findIndex(a => a.key === key),
      1
    )[0];
  const [ans, setAns] = createSignal<Row[]>([{ id: 1, title: "W" }]);
  const [board, guess] = createOptimisticStore<Row[]>(() => ans().map(r => ({ ...r })), [], {
    key: "id"
  } as any);
  const add = action(function* (key: number, title: string, at: number) {
    guess(b => {
      b[at] = { id: key, title, adding: true };
    });
    const r = yield ask(`add:${title}`);
    setAns(cs => [...cs, { id: r.id, title }]);
  });
  let out = "";
  createRoot(() => {
    const rows = mapArray(
      () => board,
      (r: Row) => () => (r.adding ? `${r.title}(adding)` : `#${r.id} ${r.title}`)
    );
    createRenderEffect(
      () =>
        rows()
          .map(f => f())
          .join(" "),
      v => {
        out = v;
      }
    );
  });
  await tick();
  for (const [k, t] of [
    [-1, "A1"],
    [-2, "A2"],
    [-3, "A3"]
  ] as const) {
    add(k, t, board.length);
    await tick();
  }
  const held = "#1 W A1(adding) A2(adding) A3(adding)";
  expect(out).toBe(held);
  take("add:A2").res({ id: 11 });
  await tick();
  expect(out).toBe(held);
  take("add:A1").res({ id: 10 });
  await tick();
  expect(out).toBe(held);
  take("add:A3").res({ id: 12 });
  await tick();
  expect(out).toBe("#1 W #11 A2 #10 A1 #12 A3");
});
