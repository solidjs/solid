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

test("a rename that lands after a re-ask, over a reorder that wrote the row's own base back", async () => {
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

  const [visit, setVisit] = createSignal(0);
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

  const move = action(function* (m: Move) {
    guessMoving(ms => [...ms, m]);
    yield ask(`move:${m.id},${m.index}`);
    setTodoAns(rs => applyMove(rs, m));
  });
  const rename = action(function* (id: number, title: string) {
    guessRenaming(rs => [...rs, { id, title }]);
    const r: Card = yield ask(`rename:${id}`);
    setTodoAns(rs => rs.map(x => (x.id === id ? { ...x, title: r.title } : x)));
  });

  const seen = new Map<number, any>();
  render(
    () => (
      <Loading on={visit()} fallback={<p>loading</p>}>
        <ul>
          <For each={rows}>
            {(r: any) => (
              seen.set(
                untrack(() => r.id),
                r
              ),
              (
                <li>
                  #{r.id} {r.title}
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
  rename(1, "Bravo");
  await tick();
  move({ id: 2, index: 0, card: seen.get(2).base });
  await tick(); // up #2, carrying the row's own base
  setVisit(v => v + 1);
  await tick(); // board left and opened again: re-ask
  const land = async (k: string, v: any) => {
    while (asks.some(a => a.key === k)) take(k).res(v);
    await tick();
  };
  await land("cards", [
    { id: 2, title: "Fix login" },
    { id: 1, title: "Write spec" }
  ]);
  take("rename:1").res({ id: 1, title: "Bravo" });
  await tick();
  // the list is asked again (in the air: move:2,0 and cards); answering it:
  await land("cards", [
    { id: 2, title: "Fix login" },
    { id: 1, title: "Bravo" }
  ]); // throws RangeError: Invalid array length (actualInsertIntoHeap)
  expect(screen()).toBe("#2 Fix login, #1 Bravo");
});
