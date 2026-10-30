/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
/**
 * #4480: a derived optimistic store whose re-ask fails while a guess is
 * pending, read by an effect through `createErrorBoundary`, hung the flush.
 * The filter change is held with the guess's action (D-34); the rejection
 * is staged with that hold (D-41), and the boundary the effect's held pass
 * mounts waits on it. The flush ends; the screen keeps the guess while the
 * action is out (F-11), and the error shows with the hold's reveal (D-41).
 */
import { expect, test } from "vitest";
import {
  Loading,
  Errored,
  For,
  action,
  createOptimisticStore,
  createSignal,
  createMemo,
  createEffect,
  createErrorBoundary,
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

test("#4480: a re-ask failing under a pending guess, read through createErrorBoundary, settles", async () => {
  const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
  const settle = async (key: string, f: (a: (typeof asks)[number]) => void) => {
    const i = asks.findIndex(a => a.key === key);
    f(asks.splice(i, 1)[0]);
    await tick();
  };
  const container = document.body.appendChild(document.createElement("div"));
  let setFilter!: (f: string) => void;
  let rowAssign!: (id: number, who: string) => any;
  const dispose = render(() => {
    const [filter, sf] = createSignal("open");
    setFilter = sf;
    const list = createMemo(() => ask(`issues:${filter()}`));
    const [issues, set] = createOptimisticStore(
      async (d: any[]) => {
        const r = (list() as any[]).map(t => ({ ...t, open: filter() === "open" }));
        d.length = r.length;
        r.forEach((x, i) => {
          d[i] = x;
        });
      },
      [] as any[],
      { key: "id" }
    );
    rowAssign = action(function* (id: number, who: string) {
      const i = untrack(() => issues.findIndex((t: any) => t.id === id));
      set((d: any) => {
        d[i].assignee = who;
      });
      yield ask(`assign:${id}`);
    });
    createEffect(
      () => [
        filter(),
        untrack(() =>
          createErrorBoundary(
            () => issues,
            () => null
          )
        )()
      ],
      { effect: () => {}, error: () => {} }
    );
    return (
      <Loading fallback={<p>loading</p>}>
        <Errored fallback={() => <p>err</p>}>
          <For each={issues}>
            {(it: any) => (
              <i>
                [#{it.id} {it.assignee}]
              </i>
            )}
          </For>
        </Errored>
      </Loading>
    );
  }, container);
  try {
    await tick();
    await settle("issues:open", a =>
      a.res([
        { id: 1, assignee: null },
        { id: 3, assignee: null }
      ])
    );
    expect(container.textContent).toBe("[#1 ][#3 ]");
    rowAssign(1, "guest");
    await tick();
    expect(container.textContent).toBe("[#1 guest][#3 ]");
    setFilter("closed");
    await tick();
    expect(container.textContent).toBe("[#1 guest][#3 ]");
    // Hung here: Potential Infinite Loop Detected.
    await settle("issues:closed", a => a.rej(new Error("declined")));
    expect(container.textContent).toBe("[#1 guest][#3 ]");
    await settle("assign:1", a => a.res({}));
    expect(container.textContent).toBe("err");
  } finally {
    dispose();
    container.remove();
  }
});
