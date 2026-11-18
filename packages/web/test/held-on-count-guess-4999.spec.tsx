/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { test, expect } from "vitest";
import { For, Loading, action, createSignal, createOptimisticStore, flush } from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test("#4999 under a held Loading on, a count over the list shows a later guess, as the list does", async () => {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const take = (key: string) =>
    asks.splice(
      asks.findIndex(a => a.key === key),
      1
    )[0];
  const c = document.body.appendChild(document.createElement("div"));
  let api: any;
  function App() {
    const [selected, setSelected] = createSignal(3);
    const [items, setItems] = createOptimisticStore(
      async () => await ask(`items${selected()}`),
      [] as any[],
      { key: "id" } as any
    );
    const firstGuess = action(function* () {
      setItems((rs: any[]) => [...rs, { id: -1, done: false }]);
      yield ask("first");
    });
    const toggle = action(function* (i: number) {
      setItems((d: any) => {
        d[i].done = !d[i].done;
      });
      yield ask("toggle");
    });
    api = { firstGuess, toggle, select: setSelected };
    return (
      <Loading on={selected()} fallback="loading">
        <For each={items}>{(it: any) => <i>{it.done ? "x" : "o"}</i>}</For>{" "}
        {items.filter((x: any) => x.done).length} done
      </Loading>
    );
  }
  render(() => <App />, c);
  const screen = () => c.textContent!.replace(/\s+/g, " ").trim();
  await tick();
  take("items3").res([
    { id: 31, done: true },
    { id: 32, done: false }
  ]);
  await tick();
  expect(screen()).toBe("xo 1 done");
  api.firstGuess();
  await tick();
  api.select(1);
  await tick();
  expect(screen()).toBe("xoo 1 done");
  api.toggle(1);
  await tick();
  expect(screen()).toBe("xxo 2 done");
  c.remove();
});
