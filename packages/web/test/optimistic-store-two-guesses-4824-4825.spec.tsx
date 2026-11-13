/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Two guesses on one optimistic store around another action's `refresh()`:
 *
 *  - #4824: a close guessed during another close's refresh, after a third
 *    close on the same store was declined. The count an effect reports and
 *    the rows `<Show>` (or a ternary) hides agree in every frame (F-1), with
 *    or without a `<Loading>` around the list.
 *  - #4825: a second rename guess on one slot stays when the first rename's
 *    refresh answers and its action ends (F-11, D-33).
 */
import { describe, expect, test } from "vitest";
import {
  For,
  Show,
  Loading,
  action,
  createEffect,
  createMemo,
  createOptimisticStore,
  createProjection,
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

function asker() {
  const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
  const take = (key: string) => {
    const i = asks.findIndex(a => a.key === key);
    if (i < 0) throw new Error(`no ask ${key}`);
    return asks.splice(i, 1)[0];
  };
  return { asks, ask, take };
}

describe("#4824: count and rows agree on a close guessed during another close's refresh", () => {
  for (const row of ["show", "ternary"] as const)
    for (const boundary of [true, false])
      test(`${row}, ${boundary ? "under <Loading>" : "no boundary"}`, async () => {
        const { asks, ask, take } = asker();
        const c = document.body.appendChild(document.createElement("div"));
        let close!: (id: number) => any;
        const dispose = render(() => {
          const [count, setCount] = createSignal(-1);
          const server = createMemo(() => ask("list"));
          const [closing, setClosing] = createOptimisticStore<Record<number, boolean>>(d => {
            for (const k of Object.keys(d)) delete d[k as any];
          }, {});
          const rows = createProjection<{ id: number }[]>(() => server() as any, [], { key: "id" });
          const openCount = createMemo(() => rows.filter(i => closing[i.id] !== true).length);
          close = action(function* (id: number) {
            setClosing(d => {
              d[id] = true;
            });
            try {
              yield ask(`close:${id}`);
              refresh(server);
            } catch {}
          });
          const list = () => (
            <>
              {
                (createEffect(
                  () => openCount(),
                  n => {
                    setCount(n);
                  }
                ),
                null)
              }
              <For each={rows}>
                {r =>
                  row === "show" ? (
                    <Show when={closing[r.id] !== true}>
                      <b>#{r.id} </b>
                    </Show>
                  ) : (
                    // The row memo re-creates its condition memo every run.
                    <>{closing[r.id] !== true ? <b>#{r.id} </b> : undefined}</>
                  )
                }
              </For>
            </>
          );
          return (
            <>
              <i>[{count()}] </i>
              {boundary ? <Loading fallback="loading">{list()}</Loading> : list()}
            </>
          );
        }, c);
        const frames: string[] = [];
        const snap = () => {
          const text = c.textContent!.trim();
          frames.push(text);
          expect(Number(text.match(/\[(-?\d+)\]/)![1]), text).toBe(
            (text.match(/#\d+/g) ?? []).length
          );
        };
        try {
          await tick();
          take("list").res([{ id: 1 }, { id: 3 }, { id: 4 }]);
          await tick();
          snap();
          close(3);
          await tick();
          snap();
          close(1);
          await tick();
          snap();
          take("close:1").res({});
          await tick();
          snap();
          take("close:3").rej(new Error("declined"));
          await tick();
          snap();
          close(4);
          await tick();
          snap();
          take("close:4").res({});
          await tick();
          snap();
          while (asks.some(a => a.key === "list")) {
            take("list").res([{ id: 3 }]);
            await tick();
          }
          snap();
          expect(frames.at(-3)).toBe("[0]");
          expect(frames.at(-1)).toBe("[1] #3");
        } finally {
          dispose();
          c.remove();
        }
      });
});

test("#4825: a second rename guess on one slot stays when the first rename's refresh answers", async () => {
  const { ask, take } = asker();
  const c = document.body.appendChild(document.createElement("div"));
  let rename!: (t: string) => any;
  const dispose = render(() => {
    const detail = createMemo(() => ask("detail"));
    const [renaming, setRenaming] = createOptimisticStore<Record<number, string>>(d => {
      for (const k of Object.keys(d)) delete d[k as any];
    }, {});
    const list = createMemo(() => ask("list"));
    rename = action(function* (t: string) {
      setRenaming(d => {
        d[2] = t;
      });
      yield ask(`rename:${t}`);
      refresh(list);
      refresh(detail);
    });
    return (
      <Loading fallback="loading">
        <i>{(list() as number[]).length} </i>
        <h2>
          {(renaming[2] ?? "") !== "" ? (
            <span>{renaming[2]}</span>
          ) : (
            <span>{(detail() as { title: string }).title}</span>
          )}
        </h2>
      </Loading>
    );
  }, c);
  try {
    await tick();
    take("detail").res({ title: "Old" });
    take("list").res([1]);
    await tick();
    expect(c.textContent).toBe("1 Old");
    rename("Bravo");
    await tick();
    take("rename:Bravo").res({});
    await tick();
    take("detail").res({ title: "Bravo" });
    await tick();
    expect(c.textContent).toBe("1 Bravo");
    rename("Delta");
    await tick();
    expect(c.textContent).toBe("1 Delta");
    take("list").res([1]);
    await tick();
    expect(c.textContent).toBe("1 Delta");
    take("rename:Delta").res({});
    await tick();
    take("list").res([1]);
    take("detail").res({ title: "Delta" });
    await tick();
    expect(c.textContent).toBe("1 Delta");
  } finally {
    dispose();
    c.remove();
  }
});
