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

test("#4970 an accepted add shows after a reorder wrote the projection's own row back", async () => {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const take = (key: string) => {
    const i = asks.findIndex(a => a.key === key);
    if (i < 0) throw new Error("no ask " + key);
    return asks.splice(i, 1)[0];
  };
  let screen: any = "";
  const seen = new Map<string, any>();
  let move!: (m: Move) => void, add!: (k: number, t: string) => void;
  const dispose = createRoot(d => {
    const [todoAns, setTodoAns] = createSignal<Card[]>(async () => await ask("cards"));
    const [moving, guessMoving] = createOptimistic<Move[]>(() => []);
    const [adding, guessAdding] = createOptimistic<{ k: number; title: string }[]>(() => []);
    const applyMove = (rs: Card[], m: Move) => {
      const w = rs.filter(r => r.id !== m.id);
      return [...w.slice(0, m.index), m.card, ...w.slice(m.index)];
    };
    const real = createMemo(() =>
      moving()
        .reduce(applyMove, todoAns())
        .map(r => ({ k: `c${r.id}`, id: r.id, title: r.title, base: r }))
    );
    const rowsMemo = createMemo(() => [
      ...real(),
      ...adding().map(a => ({
        k: `n${a.k}`,
        id: 0,
        title: a.title + " (adding…)",
        base: { id: 0, title: a.title }
      }))
    ]);
    const rows: any = createProjection(() => rowsMemo() as any, [] as any, { key: "k" } as any);
    move = action(function* (m: Move) {
      guessMoving(ms => [...ms, m]);
      yield ask(`move:${m.id},${m.index}`);
      setTodoAns(rs => applyMove(rs, m));
    });
    add = action(function* (k: number, title: string) {
      guessAdding(as => [...as, { k, title }]);
      const r: Card = yield ask(`add:${title}`);
      setTodoAns(rs => [...rs, { id: r.id, title: r.title }]);
    });
    const b = createLoadingBoundary(
      () =>
        mapArray(
          () => rows,
          (r: any) => {
            seen.set(
              untrack(() => r.k),
              r
            );
            const row = { text: "" };
            createRenderEffect(
              () => `${r.id ? `#${r.id} ` : ""}${r.title}`,
              v => void (row.text = v)
            );
            return row;
          }
        ),
      () => "loading"
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
  take("cards").res([
    { id: 1, title: "Write spec" },
    { id: 2, title: "Fix login" }
  ]);
  await tick();
  add(1, "Plan sprint");
  await tick();
  move({ id: 1, index: 1, card: seen.get("c1").base });
  await tick();
  expect(shown()).toBe("#2 Fix login, #1 Write spec, Plan sprint (adding…)");
  take("move:1,1").res({});
  await tick();
  take("add:Plan sprint").res({ id: 7, title: "Plan sprint" });
  await tick();
  expect(shown()).toBe("#2 Fix login, #1 Write spec, #7 Plan sprint");
  dispose();
});
