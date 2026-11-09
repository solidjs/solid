/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4724: a keyed `createOptimisticStore` over an async memo; two actions
// guess into it and refresh. The guess written as a field edit and the same
// guess written as a whole-array rewrite (what a reconcile-style setter or a
// `rows.map(...)` lowering produces) must read the same at every frame: the
// slot of a guess is the point of write (ruled 2026-11-08) — a rewritten
// top-level array with the same keys and length is one write per index that
// differs, never a guess on the list.
//
// Built 2026-11-09 on the guess carrier (one `$PATCH` carrier per target per
// lane, store/optimistic.ts): the rewrite records one changed key, row 1, so
// the close guess is its own carrier and lane — it shows from its flush, and
// the refresh's failure is the list's answer (D-41), not outranked by a guess
// on the list. Before, the rewrite was escalated to an arrangement guess on
// the one container node, which the two actions shared: the close write
// joined assign's lane (blocked on its refresh) and the hold merge swallowed
// the error.
import { expect, test } from "vitest";
import {
  Loading,
  Errored,
  For,
  action,
  createOptimisticStore,
  createMemo,
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

for (const form of ["field", "whole-array"] as const)
  test(`#4724 a guess made during another action's refresh, then the refresh fails (${form} setter)`, async () => {
    const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
    const settle = async (key: string, v: any, fail = false) => {
      for (const a of asks.filter(a => a.key === key)) {
        asks.splice(asks.indexOf(a), 1);
        fail ? a.rej(new Error(v)) : a.res(v);
      }
      await tick();
    };
    const container = document.body.appendChild(document.createElement("div"));
    let assign!: (id: number) => any;
    let close!: (id: number) => any;
    const guess = (set: any, id: number, patch: (r: any) => void) =>
      form === "field"
        ? set((d: any[]) => {
            patch(d.find(r => r.id === id));
          })
        : set((d: any[]) => {
            const v = d.map(r => {
              if (r.id !== id) return r;
              const c = { ...r };
              patch(c);
              return c;
            });
            d.length = v.length;
            v.forEach((x, i) => {
              d[i] = x;
            });
          });
    const dispose = render(() => {
      const list = createMemo(() => ask("fetch"));
      const [rows, set] = createOptimisticStore(
        (d: any[]) => {
          const r = list().map((x: any) => ({ ...x }));
          d.length = r.length;
          r.forEach((x: any, i: number) => {
            d[i] = x;
          });
        },
        [] as any[],
        { key: "id" }
      );
      assign = action(function* (id: number) {
        guess(set, id, r => {
          r.a = "guest";
        });
        yield ask(`assign:${id}`);
        refresh(list);
        refresh(rows);
      });
      close = action(function* (id: number) {
        guess(set, id, r => {
          r.closed = true;
        });
        yield ask(`close:${id}`);
        refresh(list);
        refresh(rows);
      });
      return (
        <Loading fallback="loading">
          <Errored fallback={(e: any) => <b>list error: {e().message}</b>}>
            <For each={rows.filter((r: any) => !r.closed)}>
              {(r: any) => (
                <i>
                  [#{r.id} {r.a ?? "-"}]
                </i>
              )}
            </For>
          </Errored>
        </Loading>
      );
    }, container);
    const screen = () => container.textContent;
    await tick();
    await settle("fetch", [{ id: 1 }, { id: 3 }, { id: 4 }]);
    expect(screen()).toBe("[#1 -][#3 -][#4 -]");
    assign(4);
    await tick();
    expect(screen(), "assign #4 guessed").toBe("[#1 -][#3 -][#4 guest]");
    await settle("assign:4", {});
    expect(screen(), "assign landed; its refresh is in flight").toBe("[#1 -][#3 -][#4 guest]");
    close(1);
    await tick();
    // F-11: a guess is its slot's value from the flush that carries it; a
    // refresh re-asks the same question and holds nothing new (D-34).
    expect(screen(), "close #1 guessed during assign's refresh").toBe("[#3 -][#4 guest]");
    await settle("fetch", "down", true);
    // D-41: the error is the answer; the guesses are on rows 1 and 4, the
    // list is the truth's, and the truth is an error.
    expect(screen(), "the refresh fails").toBe("list error: down");
    close(4);
    await tick();
    expect(screen(), "close #4 guessed under the error").toBe("list error: down");
    await settle("close:1", {});
    await settle("close:4", {});
    await settle("fetch", [
      { id: 3 },
      { id: 4, a: "guest", closed: true },
      { id: 1, closed: true }
    ]);
    expect(screen(), "the re-ask answers").toBe("[#3 -]");
    dispose();
    container.remove();
  });
