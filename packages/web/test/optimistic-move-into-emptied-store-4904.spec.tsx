/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4904 (fuzz seed 44, one keyed optimistic store per fetch): a card moved
// into a list that just emptied renders as one undefined row once every
// answer has landed, when each row reads the list's first row (`rows[0]`).
import { test, expect } from "vitest";
import { For, action, createSignal, createOptimisticStore, flush, refresh } from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
type Row = { id: number };
type Col = "todo" | "doing" | "done";

function board(copy: boolean, plain: boolean) {
  const srv: Record<Col, number[]> = { todo: [1, 2], doing: [4], done: [3, 5] };
  const fl: Record<string, ((v: any) => void)[]> = {};
  const ask = (k: string) => new Promise<any>(r => (fl[k] ??= []).push(r));
  const air = () =>
    Object.keys(fl)
      .filter(x => fl[x].length)
      .join(" ");
  const land = (k: string, v: any) => {
    const rs = fl[k] ?? [];
    if (!rs.length) throw new Error("no ask " + k + " in " + air());
    fl[k] = [];
    rs.forEach(r => r(structuredClone(v)));
  };
  const landCards = (col: Col) =>
    land(
      col,
      srv[col].map(id => ({ id }))
    );
  const landMove = (id: number, from: Col, to: Col, at: number) => {
    srv[from] = srv[from].filter(x => x !== id);
    srv[to].splice(at, 0, id);
    land(`move:${id}`, {});
  };

  const c = document.body.appendChild(document.createElement("div"));
  const [todoAns] = createSignal<any>(() => ask("todo"), { loadingValue: null } as any);
  const [doingAns] = createSignal<any>(() => ask("doing"), { loadingValue: null } as any);
  const [doneAns] = createSignal<any>(() => ask("done"), { loadingValue: null } as any);
  const anss = { todo: todoAns, doing: doingAns, done: doneAns };
  const derive = (a: () => any) =>
    plain
      ? () => a() ?? []
      : (d: Row[]) => {
          const v = a();
          if (v) d.splice(0, d.length, ...v);
        };
  const [todo, setTodo] = createOptimisticStore<Row[]>(derive(todoAns) as any, [], {
    key: "id"
  } as any);
  const [doing, setDoing] = createOptimisticStore<Row[]>(derive(doingAns) as any, [], {
    key: "id"
  } as any);
  const [done, setDone] = createOptimisticStore<Row[]>(derive(doneAns) as any, [], {
    key: "id"
  } as any);
  const stores = { todo, doing, done },
    sets = { todo: setTodo, doing: setDoing, done: setDone };

  const move = action(function* (id: number, from: Col, to: Col) {
    const found = stores[from].find(r => r.id === id)!;
    const row = copy ? { ...found } : found;
    sets[from]((rs: Row[]) => rs.filter(r => r.id !== id));
    sets[to]((rs: Row[]) => [...rs, row]);
    yield ask(`move:${id}`);
    refresh(anss[from]);
    refresh(anss[to]);
  });

  const col = (rows: Row[]) => (
    <ul>
      <For each={rows}>
        {(r: any) => (
          <li>
            <b>{String(r?.id)}</b>
            {rows[0]?.id === r?.id ? "" : " up"}
          </li>
        )}
      </For>
    </ul>
  );
  const dispose = render(
    () => (
      <div>
        {col(todo)}
        {col(doing)}
        {col(done)}
      </div>
    ),
    c
  );
  const state = () =>
    [...c.querySelectorAll("ul")]
      .map(u => [...u.querySelectorAll("b")].map(b => b.textContent).join(","))
      .join(" | ");
  const cleanup = () => {
    dispose();
    c.remove();
  };
  return { landCards, landMove, move, state, air, cleanup };
}

for (const [name, copy, plain] of [
  ["the row itself, draft derive", false, false],
  ["a copied row, draft derive", true, false],
  ["a copied row, plain derive", true, true],
  ["the row itself, plain derive", false, true]
] as const) {
  test(`a row moved into an emptied keyed optimistic store renders once the answers land (${name})`, async () => {
    const b = board(copy, plain);
    const S = async (f: () => void) => {
      f();
      await tick();
    };
    await S(() => {
      b.landCards("todo");
      b.landCards("doing");
      b.landCards("done");
    });
    expect(b.state()).toBe("1,2 | 4 | 3,5");
    await S(() => b.move(4, "doing", "todo"));
    await S(() => b.landMove(4, "doing", "todo", 2));
    await S(() => b.landCards("doing"));
    expect(b.state()).toBe("1,2,4 |  | 3,5");
    await S(() => b.move(3, "done", "doing"));
    expect(b.state()).toBe("1,2,4 | 3 | 5");
    await S(() => b.landMove(3, "done", "doing", 0));
    await S(() => b.landCards("todo"));
    await S(() => b.landCards("done"));
    expect(b.state()).toBe("1,2,4 | 3 | 5");
    await S(() => b.landCards("doing"));
    expect(b.air()).toBe("");
    expect(b.state()).toBe("1,2,4 | 3 | 5");
    b.cleanup();
  });
}
