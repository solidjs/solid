/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { test, expect } from "vitest";
import {
  For,
  Loading,
  action,
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

test("a count memo over a keyed projection follows a placeholder replaced by its answer", async () => {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const take = (key: string) => {
    const i = asks.findIndex(a => a.key === key);
    if (i < 0) throw new Error("no ask " + key);
    return asks.splice(i, 1)[0];
  };
  const c = document.body.appendChild(document.createElement("div"));
  type Item = { id: number; text: string };

  const [list, setList] = createSignal<Item[]>(async () => await ask("list"));
  const [adding, guessAdding] = createOptimistic<Item[]>(() => []);
  const rows = createMemo(() => [
    ...list().map(it => ({ id: it.id, text: it.text })),
    ...adding().map(a => ({ id: a.id, text: a.text + " (adding…)" }))
  ]);
  const items: any = createProjection(() => rows() as any, [] as any, { key: "id" } as any);
  const count = createMemo(() => `${items.length} items`);

  const add = action(function* (key: number, text: string) {
    guessAdding(xs => [...xs, { id: key, text }]);
    const it: Item = yield ask(`add:${text}`);
    setList(xs => [...xs, it]);
  });

  render(
    () => (
      <Loading fallback={<p>loading</p>}>
        <ul>
          <For each={items}>{(it: any) => <li>{it.text}</li>}</For>
        </ul>
        <p>{count()}</p>
      </Loading>
    ),
    c
  );
  const screen = () =>
    [...c.querySelectorAll("li")].map(l => l.textContent).join(", ") +
    " | " +
    c.querySelector("p")!.textContent;

  take("list").res([
    { id: 21, text: "repro" },
    { id: 22, text: "patch" }
  ]);
  await tick();
  add(-1, "ship");
  await tick();
  expect(screen()).toBe("repro, patch, ship (adding…) | 3 items");
  take("add:ship").res({ id: 24, text: "ship" });
  await tick();
  expect(screen()).toBe("repro, patch, ship | 3 items"); // got "repro, patch, ship | 4 items"
});
