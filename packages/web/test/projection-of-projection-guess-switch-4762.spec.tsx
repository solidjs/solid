/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { test, expect } from "vitest";
import {
  For,
  Loading,
  action,
  createOptimistic,
  createMemo,
  createSignal,
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
for (const copy of [false, true])
  test(`a keyed projection of a keyed projection, a guess out, switch the question (copy=${copy})`, async () => {
    const asks: { key: string; res: (v: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
    const pick = (key: string) =>
      asks.splice(
        asks.findIndex(a => a.key === key),
        1
      )[0];
    const c = document.body.appendChild(document.createElement("div"));
    let close!: (id: number) => any, setFilter!: (f: string) => void;
    render(() => {
      const [filter, sf] = createSignal("open");
      setFilter = sf;
      const server = createMemo(() => ask(`fetch:${filter()}`));
      const issues = createProjection(() => server(), [] as any[], { key: "id" });
      const [closingTruth] = createSignal<number[]>(() => []);
      const [closing, guessClose] = createOptimistic(() => closingTruth());
      const view = createMemo(() =>
        filter() === "open"
          ? issues.filter((r: any) => !closing().includes(r.id))
          : copy
            ? [...issues]
            : issues
      );
      const shown = createProjection(() => view(), [] as any[], { key: "id" });
      close = action(function* (id: number) {
        guessClose(xs => [...xs, id]);
        yield ask(`close:${id}`);
      });
      return (
        <Loading on={filter()} fallback={<i>loading</i>}>
          <For each={shown}>
            {r => (
              <i>
                [#{r.id} {r.title}]
              </i>
            )}
          </For>
        </Loading>
      );
    }, c);
    await tick();
    pick("fetch:open").res([
      { id: 1, title: "Login" },
      { id: 3, title: "Crash" },
      { id: 4, title: "Typo" }
    ]);
    await tick();
    expect(c.textContent).toBe("[#1 Login][#3 Crash][#4 Typo]");
    close(4);
    await tick();
    expect(c.textContent).toBe("[#1 Login][#3 Crash]");
    setFilter("closed");
    await tick();
    expect(c.textContent).toBe("loading");
    pick("fetch:closed").res([{ id: 2, title: "Old bug" }]);
    await tick();
    expect(c.textContent).toBe("[#2 Old bug]");
    c.remove();
  });
