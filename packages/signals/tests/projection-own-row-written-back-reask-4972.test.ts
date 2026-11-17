import { test, expect } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  untrack
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

type Card = { id: number; title: string };
type Move = { id: number; index: number; card: Card };

test("#4972 a rename landing after a re-ask, over a reorder that wrote the projection's own row back", async () => {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const take = (key: string) => {
    const i = asks.findIndex(a => a.key === key);
    if (i < 0) throw new Error("no ask " + key);
    return asks.splice(i, 1)[0];
  };
  let screen: any = "";
  const seen = new Map<number, any>();
  let move!: (m: Move) => void,
    rename!: (id: number, t: string) => void,
    setVisit!: (fn: (v: number) => number) => void;
  const dispose = createRoot(d => {
    const [visit, _setVisit] = createSignal(0);
    setVisit = _setVisit as any;
    const [todoAns, setTodoAns] = createSignal<Card[]>(
      async () => (visit() >= 0 ? await ask("cards") : []) as any
    );
    const [moving, guessMoving] = createOptimistic<Move[]>(() => []);
    const [renaming, guessRenaming] = createOptimistic<{ id: number; title: string }[]>(() => []);
    const applyMove = (rs: Card[], m: Move) => {
      const w = rs.filter(r => r.id !== m.id);
      return [...w.slice(0, m.index), m.card, ...w.slice(m.index)];
    };
    const titleOf = (id: number, t: string) =>
      renaming().reduce((v, r) => (r.id === id ? r.title : v), t);
    const rowsMemo = createMemo(() =>
      moving()
        .reduce(applyMove, todoAns())
        .map(r => ({ id: r.id, title: titleOf(r.id, r.title), base: r }))
    );
    const rows: any = createProjection(() => rowsMemo() as any, [] as any, { key: "id" } as any);
    move = action(function* (m: Move) {
      guessMoving(ms => [...ms, m]);
      yield ask(`move:${m.id},${m.index}`);
      setTodoAns(rs => applyMove(rs, m));
    });
    rename = action(function* (id: number, title: string) {
      guessRenaming(rs => [...rs, { id, title }]);
      const r: Card = yield ask(`rename:${id}`);
      setTodoAns(rs => rs.map(x => (x.id === id ? { ...x, title: r.title } : x)));
    });
    const b = createLoadingBoundary(
      () =>
        mapArray(
          () => rows,
          (r: any) => {
            seen.set(
              untrack(() => r.id),
              r
            );
            const row = { text: "" };
            createRenderEffect(
              () => `#${r.id} ${r.title}`,
              v => void (row.text = v)
            );
            return row;
          }
        ),
      () => "loading",
      { on: () => visit() }
    );
    createRenderEffect(
      () => {
        const v = b();
        return typeof v === "function" ? v() : v;
      },
      v => void (screen = v)
    );
    return d;
  });
  const shown = () =>
    Array.isArray(screen) ? screen.map((r: any) => r.text).join(", ") : String(screen);
  const land = async (k: string, v: any) => {
    while (asks.some(a => a.key === k)) take(k).res(v);
    await tick();
  };
  take("cards").res([
    { id: 1, title: "Write spec" },
    { id: 2, title: "Fix login" }
  ]);
  await tick();
  rename(1, "Bravo");
  await tick();
  move({ id: 2, index: 0, card: seen.get(2).base });
  await tick();
  setVisit(v => v + 1);
  await tick();
  await land("cards", [
    { id: 2, title: "Fix login" },
    { id: 1, title: "Write spec" }
  ]);
  take("rename:1").res({ id: 1, title: "Bravo" });
  await tick();
  await land("cards", [
    { id: 2, title: "Fix login" },
    { id: 1, title: "Bravo" }
  ]);
  expect(shown()).toBe("#2 Fix login, #1 Bravo");
  dispose();
});
