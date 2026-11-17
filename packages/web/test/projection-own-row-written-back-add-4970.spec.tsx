/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { test, expect } from "vitest";
import {
  For,
  Loading,
  action,
  untrack,
  createMemo,
  createSignal,
  createOptimistic,
  createProjection,
  flush
} from "solid-js";
import { render } from "../src/index.js";
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test("an accepted add written into the answer shows after a reorder that wrote the row's own base back", async () => {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const take = (key: string) => {
    const i = asks.findIndex(a => a.key === key);
    if (i < 0) throw new Error("no ask " + key);
    return asks.splice(i, 1)[0];
  };
  const c = document.body.appendChild(document.createElement("div"));
  type Card = { id: number; title: string };
  type Move = { id: number; index: number; card: Card };

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

  const move = action(function* (m: Move) {
    guessMoving(ms => [...ms, m]);
    yield ask(`move:${m.id},${m.index}`);
    setTodoAns(rs => applyMove(rs, m));
  });
  const add = action(function* (k: number, title: string) {
    guessAdding(as => [...as, { k, title }]);
    const r: Card = yield ask(`add:${title}`);
    setTodoAns(rs => [...rs, { id: r.id, title: r.title }]);
  });

  const seen = new Map<string, any>();
  render(
    () => (
      <Loading fallback={<p>loading</p>}>
        <ul>
          <For each={rows}>
            {(r: any) => (
              seen.set(
                untrack(() => r.k),
                r
              ),
              (
                <li>
                  {r.id ? `#${r.id} ` : ""}
                  {r.title}
                </li>
              )
            )}
          </For>
        </ul>
      </Loading>
    ),
    c
  );
  const screen = () => [...c.querySelectorAll("li")].map(l => l.textContent).join(", ");

  take("cards").res([
    { id: 1, title: "Write spec" },
    { id: 2, title: "Fix login" }
  ]);
  await tick();
  add(1, "Plan sprint");
  await tick();
  move({ id: 1, index: 1, card: seen.get("c1").base });
  await tick(); // down #1: the move carries the row's own base (a row of `rows`)
  expect(screen()).toBe("#2 Fix login, #1 Write spec, Plan sprint (adding…)");
  take("move:1,1").res({});
  await tick();
  take("add:Plan sprint").res({ id: 7, title: "Plan sprint" });
  await tick();
  expect(screen()).toBe("#2 Fix login, #1 Write spec, #7 Plan sprint"); // got "#2 Fix login, #1 Write spec"
});
