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
// Ruled, not built (2026-11-09). Today the rewrite is escalated to an
// arrangement guess on the container (`notifyOptimisticWrites`, a changed
// index of an array is structural), and the setter's write lands in two
// lanes: the container view and row 4's index are assign's lane nodes and go
// into that still-open lane, row 1's index opens a lane of its own; the
// list's readers re-run as assign's lane work before the new lane reveals and
// compose row 1 from the committed object, and the new lane's reveal
// re-derives none of them (they track the container, not the index). The
// close guess shows only with the next re-run — the refresh's failure — and
// there the container guess outranks the derive's error (`laneRead` tests
// the guess before its error arm), so the rows show every guess and
// `Errored` never flips. Dropping the escalation is not the fix: on a derived
// or chained store the container view is the only path by which an index
// write reaches `<For>`/`mapArray` (the store mutation matrix blanks). The
// shape that carries the ruling is one guess carrier per target per lane
// (the parked S2 design, `tembo/spike-store-s1-build`). The field setter is
// the control: one leaf write, every frame as ruled.
import { expect, test } from "vitest";
import {
  Loading,
  Errored,
  For,
  action,
  createOptimisticStore,
  createMemo,
  createEffect,
  createErrorBoundary,
  flush,
  refresh,
  untrack
} from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const form of ["field", "whole-array"] as const)
  (form === "field" ? test : test.fails)(
    `#4724 a guess made during another action's refresh, then the refresh fails (${form} setter${form === "field" ? "" : "; ruled, not built"})`,
    async () => {
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
      let count = -99;
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
        const shownOpen = createMemo(() => rows.filter((r: any) => !r.closed).length);
        const caught = untrack(() =>
          createErrorBoundary(
            () => shownOpen(),
            () => -1
          )
        );
        createEffect(
          () => caught(),
          (v: number) => {
            count = v;
          }
        );
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
      const screen = () => `${container.textContent} (${count})`;
      await tick();
      await settle("fetch", [{ id: 1 }, { id: 3 }, { id: 4 }]);
      expect(screen()).toBe("[#1 -][#3 -][#4 -] (3)");
      assign(4);
      await tick();
      expect(screen(), "assign #4 guessed").toBe("[#1 -][#3 -][#4 guest] (3)");
      await settle("assign:4", {});
      expect(screen(), "assign landed; its refresh is in flight").toBe(
        "[#1 -][#3 -][#4 guest] (3)"
      );
      close(1);
      await tick();
      // F-11: a guess is its slot's value from the flush that carries it; a
      // refresh re-asks the same question and holds nothing new (D-34).
      expect(screen(), "close #1 guessed during assign's refresh").toBe("[#3 -][#4 guest] (2)");
      await settle("fetch", "down", true);
      // D-41: the error is the answer; the guesses are on rows 1 and 4, the
      // list is the truth's, and the truth is an error.
      expect(screen(), "the refresh fails").toBe("list error: down (-1)");
      close(4);
      await tick();
      expect(screen(), "close #4 guessed under the error").toBe("list error: down (-1)");
      await settle("close:1", {});
      await settle("close:4", {});
      await settle("fetch", [
        { id: 3 },
        { id: 4, a: "guest", closed: true },
        { id: 1, closed: true }
      ]);
      expect(screen(), "the re-ask answers").toBe("[#3 -] (1)");
      dispose();
      container.remove();
    }
  );
