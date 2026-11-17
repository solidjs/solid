/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { test, expect } from "vitest";
import {
  Loading,
  For,
  action,
  createSignal,
  createOptimisticStore,
  refresh,
  flush
} from "solid-js";
import { render } from "../src/index.js";
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
for (const withOn of [false, true])
  test(`a second guess on a held previous answer shows (Loading ${withOn ? "on={selected()}" : "without on"}) (#4987)`, async () => {
    const asks: { key: string; res: (v: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
    const take = (key: string) => {
      const i = asks.findIndex(a => a.key === key);
      return asks.splice(i, 1)[0];
    };
    const c = document.body.appendChild(document.createElement("div"));
    const [selected, setSelected] = createSignal(2);
    const [list, setList] = createOptimisticStore(
      async () => await ask(`checklist:${selected()}`),
      [] as any[],
      { key: "id" } as any
    );
    const toggle = action(function* (j: number, next: boolean) {
      setList((d: any) => {
        d[j].done = next;
      });
      yield ask(`toggle:${j}`);
      refresh(list);
    });
    const outside = () => list.filter((x: any) => x.done).length;
    const body = () => (
      <p>
        <For each={list}>
          {(it: any) => (
            <span>
              {it.done ? "[x]" : "[ ]"}
              {it.text}{" "}
            </span>
          )}
        </For>
      </p>
    );
    render(
      () => (
        <div>
          <b>{outside()} done · </b>
          {withOn ? (
            <Loading on={selected()} fallback={<p>loading</p>}>
              {body()}
            </Loading>
          ) : (
            <Loading fallback={<p>loading</p>}>{body()}</Loading>
          )}
        </div>
      ),
      c
    );
    const screen = () => c.textContent!.replace(/\s+/g, " ").trim();
    take("checklist:2").res([
      { id: 21, text: "repro", done: true },
      { id: 22, text: "patch", done: false },
      { id: 23, text: "test", done: false }
    ]);
    await tick();
    toggle(2, true);
    await tick();
    setSelected(4);
    await tick();
    expect(screen()).toBe("2 done · [x]repro [ ]patch [x]test");
    toggle(0, false);
    await tick();
    expect(screen()).toBe("1 done · [ ]repro [ ]patch [x]test");
    c.remove();
  });
