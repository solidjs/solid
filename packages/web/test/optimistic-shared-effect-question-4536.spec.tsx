/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
/**
 * A shared render effect must not pair the held filter change with a guess
 * over the previous answer. Separate bindings are covered by #4525.
 */
import { expect, test } from "vitest";
import {
  Loading,
  action,
  createMemo,
  createOptimisticStore,
  createSignal,
  flush,
  refresh
} from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const on of [true, false])
  for (const order of ["question first", "list first"] as const)
    for (const mode of ["inline", "memo"] as const)
      test(`#4536: a single render effect keeps the question and optimistic rows in one world (on=${on}, ${order}, ${mode})`, async () => {
        const asks: { key: string; res: (v: any) => void }[] = [];
        const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
        const settle = async (key: string, v: any) => {
          const i = asks.findIndex(a => a.key === key);
          expect(i).toBeGreaterThanOrEqual(0);
          asks.splice(i, 1)[0].res(v);
          await tick();
        };
        const container = document.body.appendChild(document.createElement("div"));
        // Every DOM state the screen passes through.
        const seen: string[] = [];
        const observer = new MutationObserver(() => seen.push(container.textContent!));
        observer.observe(container, { childList: true, subtree: true, characterData: true });
        let setFilter!: (f: string) => void;
        let closeOne!: (id: number) => any;
        const dispose = render(() => {
          const [filter, sf] = createSignal("open");
          setFilter = sf;
          const [issues, set] = createOptimisticStore<any[]>(() => ask(`issues:${filter()}`), [], {
            key: "id"
          });
          closeOne = action(function* (id: number) {
            set(list => {
              const i = list.findIndex(t => t.id === id);
              if (i >= 0) list.splice(i, 1);
            });
            yield ask(`close:${id}`);
            refresh(issues);
          });
          const screen = () => {
            let question: string;
            let rows: string;
            if (order === "question first") {
              question = filter();
              rows = issues.map(it => `[#${it.id}]`).join("");
            } else {
              rows = issues.map(it => `[#${it.id}]`).join("");
              question = filter();
            }
            return `${question}: ${rows}`;
          };
          const body = () => {
            const value = mode === "memo" ? createMemo(screen) : screen;
            return <p>{value()}</p>;
          };
          return on ? (
            <Loading on={filter()} fallback={<p>loading</p>}>
              {body()}
            </Loading>
          ) : (
            <Loading fallback={<p>loading</p>}>{body()}</Loading>
          );
        }, container);
        try {
          await tick();
          await settle("issues:open", [{ id: 1 }, { id: 3 }, { id: 4 }]);
          expect(container.textContent).toBe("open: [#1][#3][#4]");
          setFilter("closed");
          await tick();
          expect(container.textContent).toBe(on ? "loading" : "open: [#1][#3][#4]");
          closeOne(1);
          await tick();
          // A reset boundary stays in fallback; otherwise the guess may wait
          // with the pending read or show over the held open answer.
          expect(on ? ["loading"] : ["open: [#3][#4]", "open: [#1][#3][#4]"]).toContain(
            container.textContent
          );
          await settle("issues:closed", [{ id: 1 }, { id: 2 }]);
          expect(container.textContent).toBe("closed: [#2]");
          await settle("close:1", {});
          expect(container.textContent).toBe("closed: [#2]");
          await settle("issues:closed", [{ id: 2 }]);
          expect(container.textContent).toBe("closed: [#2]");
          expect(asks).toEqual([]);
          // Never a row of the open list beside `closed` (F-1).
          expect(seen.filter(s => s.startsWith("closed") && /#3|#4/.test(s))).toEqual([]);
        } finally {
          observer.disconnect();
          dispose();
          container.remove();
        }
      });
