/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4801: a row guess is out on an optimistic store whose sync derive reads a
// memo. Switching the filter away and back re-asks both (`refresh(aOpen);
// refresh(open)`). The memo's refresh dirties the derive first, so the
// derive's own flag did not say "re-ask", and its flight was taken for a new
// question: the frame parked with the guess's action. When the first filter
// write was still loading, that frame was the merged transition, and the
// list held on its fallback until the action's own refresh answered. Every
// source the derive waits on re-asked is a re-ask (D-34 ¶3, #4724): the
// guess stands in for the flight (A17) and the frame is its own.
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
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
const draft = (d: any, v: any[]) => {
  d.length = v.length;
  v.forEach((x, i) => {
    d[i] = { ...x };
  });
};
const OPEN = [
  { id: 1, assignee: "-" },
  { id: 3, assignee: "-" }
];
for (const reask of [true, false])
  for (const order of ["after", "before"] as const)
    test(`#4801 split lists: closed lands ${order} switching back, reask ${reask}`, async () => {
      const asks: { key: string; res: (v: any) => void }[] = [];
      const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
      const land = (key: string, v: any) => {
        const i = asks.findIndex(a => a.key === key);
        if (i < 0) throw new Error("no ask " + key);
        asks.splice(i, 1)[0].res(v);
      };
      const c = document.body.appendChild(document.createElement("div"));
      let toClosed!: () => void, toOpen!: () => void, assign!: () => any;
      render(() => {
        const [filter, setFilter] = createSignal("open");
        const aOpen = createMemo(() => ask("open"));
        const aClosed = createMemo(() => ask("closed"));
        const [open, setOpen] = createOptimisticStore(
          (d: any) => {
            draft(d, aOpen());
          },
          [] as any[],
          { key: "id" } as any
        );
        const [closed] = createOptimisticStore(
          (d: any) => {
            draft(d, aClosed());
          },
          [] as any[],
          { key: "id" } as any
        );
        const issues = createMemo(() => (filter() === "open" ? open : closed));
        toClosed = () => setFilter("closed");
        toOpen = () => {
          setFilter("open");
          if (reask) {
            refresh(aOpen);
            refresh(open);
          }
        };
        assign = action(function* () {
          setOpen((d: any) => {
            d[d.findIndex((r: any) => r.id === 3)].assignee = "ann";
          });
          yield ask("assign");
          refresh(aOpen);
          refresh(open);
        });
        return (
          <Loading on={filter()} fallback={<i>loading</i>}>
            <For each={issues()}>
              {(r: any) => (
                <b>
                  #{r.id}({r.assignee}){" "}
                </b>
              )}
            </For>
          </Loading>
        );
      }, c);
      await tick();
      land("open", OPEN);
      await tick();
      assign();
      await tick();
      toClosed();
      await tick();
      if (order === "before") {
        land("closed", []);
        await tick();
      }
      toOpen();
      await tick();
      if (order === "after") {
        land("closed", []);
        await tick();
      }
      if (reask) land("open", OPEN);
      await tick();
      expect(c.textContent).toBe("#1(-) #3(ann) ");
    });
