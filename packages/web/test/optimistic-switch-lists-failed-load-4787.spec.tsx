/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4787 (fuzzer): two keyed optimistic lists picked by a filter. The open
// list's load fails while the view shows the closed one; switching back
// refreshes it. The refetch's answer clears the error (Errored recovery), and
// a guess landed on the closed list never shows its rows under "open"
// (F-1). Passes on next since #4796 (a projection's reader pulls the derive
// it reads through); pinned here.
import { test, expect } from "vitest";
import {
  For,
  Loading,
  Errored,
  action,
  createOptimisticStore,
  createMemo,
  createSignal,
  refresh,
  flush,
  untrack
} from "solid-js";
import { render } from "../src/index.js";
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
for (const V of ["full", "noassign", "nofail"])
  test(`#4787 switching back to a list whose load failed shows its refetch (${V})`, async () => {
    const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
    const pick = (key: string) => {
      const i = asks.findIndex(a => a.key === key);
      if (i < 0) throw new Error("no ask " + key + " in " + asks.map(a => a.key));
      return asks.splice(i, 1)[0];
    };
    const c = document.body.appendChild(document.createElement("div"));
    const frames: string[] = [];
    const snap = (l: string) => frames.push(`${l.padEnd(22)} ${c.textContent}`);
    let assign!: (id: number) => any, toOpen!: () => void, toClosed!: () => void;
    render(() => {
      const [filter, setFilter] = createSignal("open");
      const openQ = createMemo(() => ask("fetch:open"));
      const closedQ = createMemo(() => ask("fetch:closed"));
      const fill = (q: () => any) => (d: any) => {
        const v = q();
        d.splice(0, d.length, ...v.map((x: any) => ({ ...x })));
      };
      const [open] = createOptimisticStore(fill(openQ), [] as any[], { key: "id" } as any);
      const [closed, setClosed] = createOptimisticStore(
        fill(closedQ),
        [] as any[],
        { key: "id" } as any
      );
      const issues = createMemo(() => (filter() === "open" ? open : closed));
      const visible = createMemo(() => issues().filter((r: any) => !r.closing));
      assign = action(function* (id: number) {
        const i = untrack(() => closed.findIndex((r: any) => r.id === id));
        setClosed((d: any) => {
          d[i].a = "guest";
        });
        yield ask(`assign:${id}`);
        refresh(closedQ);
        refresh(closed);
      });
      toOpen = () => {
        setFilter("open");
        refresh(openQ);
        refresh(open);
      };
      toClosed = () => {
        setFilter("closed");
      };
      return (
        <Loading on={filter()} fallback={<i>loading {filter()}</i>}>
          <Errored fallback={(e: any) => <i>error: {e.message}</i>}>
            <b>{filter()}:</b>
            <For each={visible()}>
              {(r: any) => (
                <i>
                  [#{r.id} {r.a}]
                </i>
              )}
            </For>
          </Errored>
        </Loading>
      );
    }, c);
    await tick();
    toClosed();
    await tick();
    snap("filter closed");
    if (V === "nofail") pick("fetch:open").res([{ id: 1, a: "" }]);
    else pick("fetch:open").rej(new Error("declined"));
    await tick();
    snap("open fetch fails");
    pick("fetch:closed").res([{ id: 2, a: "eve" }]);
    await tick();
    snap("closed lands");
    if (V !== "noassign") {
      assign(2);
      await tick();
      snap("assign #2");
    }
    toOpen();
    await tick();
    snap("filter open");
    if (V !== "noassign") {
      pick("assign:2").res({});
      await tick();
      snap("assign accepted");
      pick("fetch:closed").res([{ id: 2, a: "guest" }]);
      await tick();
      snap("closed refetch lands");
    }
    pick("fetch:open").res([{ id: 1, a: "" }]);
    await tick();
    snap("open refetch lands");
    frames.push("still out: " + asks.map(a => a.key).join(", "));
    console.log(frames.join("\n"));
    expect(c.textContent).toBe("open:[#1 ]");
  });
