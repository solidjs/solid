/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4828: two optimistic stores, one per filter, and a memo that picks one.
// A row guess on the open store's action has landed and the action's
// `refresh` is out. The user switches to closed, the closed list answers,
// and the user switches back to open. The action's hold stays open for the
// guess's own refresh (A17), but everything else it held was pending only on
// that re-ask, and a re-ask holds nothing new (D-34 ¶3): the filter write,
// the closed list's landing and the `Loading` boundary's re-key are their
// own frames. Before, the filter write joined the action's hold, the
// handler's `filter() !== "open"` read the held screen ("open") and skipped
// the switch back, and the refresh's landing showed the closed rows under
// the open filter.
import { test, expect } from "vitest";
import {
  Loading,
  For,
  action,
  createMemo,
  createOptimisticStore,
  createSignal,
  refresh,
  flush
} from "solid-js";
import { render } from "../src/index.js";

const draft = (d: any, v: any[]) => {
  const rows = v.map(i => ({ id: i.id, title: i.title, assignee: i.assignee }));
  d.length = rows.length;
  rows.forEach((x, i) => {
    d[i] = x;
  });
};
const OPEN = [
  { id: 1, title: "a" },
  { id: 3, title: "b" },
  { id: 4, title: "c" }
];
const TRUTH = [
  { id: 1, title: "a" },
  { id: 3, title: "b", assignee: "guest" },
  { id: 4, title: "c" }
];
const CLOSED = [{ id: 2, title: "Old bug", assignee: "eve" }];
const ticks = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
const waits = { ticks, microtask: () => Promise.resolve() };

const rest = "#1 a (unassigned) #3 b (unassigned) #4 c (unassigned) ";
const guessed = "#1 a (unassigned) #3 b (guest) #4 c (unassigned) ";
const closedRows = "#2 Old bug (eve) ";

for (const guess of [true, false])
  for (const guard of [true, false])
    for (const [wait, afterClick] of Object.entries(waits))
      test(`#4828 guess ${guess}, guarded switch ${guard}, ${wait} after clicks`, async () => {
        const asks: { key: string; res: (v: any) => void }[] = [];
        const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
        const land = (key: string, v: any) => {
          const i = asks.findIndex(a => a.key === key);
          if (i < 0) throw new Error("no ask " + key);
          asks.splice(i, 1)[0].res(v);
        };
        const c = document.body.appendChild(document.createElement("div"));
        let setF!: (v: string) => void, assign!: (id: number) => any;
        render(() => {
          const [filter, setFilter] = createSignal("open");
          const aOpen = createMemo(() => ask("open"));
          const aClosed = createMemo(() => ask("closed"));
          const [open, setOpen] = createOptimisticStore(
            (d: any) => {
              draft(d, aOpen() as any);
            },
            [] as any[],
            { key: "id" } as any
          );
          const [closed] = createOptimisticStore(
            (d: any) => {
              draft(d, aClosed() as any);
            },
            [] as any[],
            { key: "id" } as any
          );
          const issues = createMemo(() => (filter() === "open" ? open : closed));
          // The issue's handlers: `if (filter() !== "open") setFilter("open")`.
          setF = v => {
            if (!guard || filter() !== v) setFilter(v);
          };
          assign = action(function* (id: number) {
            if (guess)
              setOpen((d: any) => {
                d[d.findIndex((r: any) => r.id === id)].assignee = "guest";
              });
            yield ask("assign");
            refresh(aOpen);
            refresh(open);
          });
          return (
            <Loading on={filter()} fallback={<p>loading</p>}>
              <ul>
                <For each={issues() as any}>
                  {(r: any) => (
                    <li>
                      #{r.id} {r.title} ({r.assignee ?? "unassigned"}){" "}
                    </li>
                  )}
                </For>
              </ul>
            </Loading>
          );
        }, c);
        const frames: string[] = [];
        const snap = () => frames.push(c.textContent!);
        await ticks();
        land("open", OPEN);
        await ticks();
        snap();
        assign(3);
        await ticks();
        land("assign", true);
        await ticks();
        snap();
        setF("closed");
        await afterClick();
        await ticks();
        snap();
        land("closed", CLOSED);
        await ticks();
        snap();
        setF("open");
        await afterClick();
        await ticks();
        snap();
        land("open", TRUTH);
        await ticks();
        snap();
        expect(asks.map(a => a.key)).toEqual([]);
        expect(frames).toEqual([
          rest,
          guess ? guessed : rest,
          "loading",
          closedRows,
          // The guess stands in for its own refresh (A17); without one the
          // re-keyed boundary waits for the open list.
          guess ? guessed : "loading",
          guessed
        ]);
        c.remove();
      });
