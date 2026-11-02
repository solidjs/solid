/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4605 (F-5, D-15; D-34/#4336): a keyed list store asked by `filter()`,
 * under `<Loading on={filter()}>`. An action guesses (removes a row), yields,
 * then `refresh()`es the list. A `filter` write while the action is out is
 * held with it (D-34); the action ends, the refresh lands, everything rests.
 * A second `filter` write with nothing in flight is an `on` change like any
 * other: it arms the boundary, which shows its fallback with that change's
 * frame (F-5, D-15), as it does without the earlier held change. Without
 * `on` the boundary has shown content and forwards (F-5): the change holds,
 * the old list stays, and the new one reveals with its answer.
 * The signals-only twin: `packages/signals/tests/loading-on-held-change-4605.test.ts`.
 */
import { expect, test } from "vitest";
import {
  For,
  Loading,
  Errored,
  action,
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

function run(useOn: boolean) {
  return async () => {
    const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
    const settle = async (key: string, f: (a: any) => void) => {
      const i = asks.findIndex(a => a.key === key);
      f(asks.splice(i, 1)[0]);
      await tick();
    };
    const container = document.body.appendChild(document.createElement("div"));
    const frames: string[] = [];
    const snap = (l: string) =>
      frames.push(`${l}: ${container.textContent}  air ${asks.map(a => a.key)}`.trimEnd());
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
      const body = () => (
        <Errored fallback={e => <p>error {(e() as Error).message}</p>}>
          <p>
            {filter()}: <For each={issues}>{(it: any) => <i>[#{it.id}]</i>}</For>
          </p>
        </Errored>
      );
      return useOn ? (
        <Loading on={filter()} fallback={<p>loading</p>}>
          {body()}
        </Loading>
      ) : (
        <Loading fallback={<p>loading</p>}>{body()}</Loading>
      );
    }, container);
    await tick();
    await settle("issues:open", a => a.res([{ id: 1 }, { id: 3 }, { id: 4 }]));
    snap("loaded");
    closeOne(3);
    await tick();
    snap("close #3");
    setFilter("closed");
    await tick();
    snap("filter closed");
    await settle("issues:closed", a => a.res([{ id: 2 }]));
    snap("closed answered");
    await settle("close:3", a => a.res({}));
    snap("close accepted");
    await settle("issues:closed", a => a.res([{ id: 2 }, { id: 3 }]));
    snap("refresh answered");
    setFilter("open");
    await tick();
    snap("filter open");
    await settle("issues:open", a => a.res([{ id: 1 }, { id: 4 }]));
    snap("open answered");
    dispose();
    container.remove();
    return frames;
  };
}

const before = [
  "loaded: open: [#1][#3][#4]  air",
  "close #3: open: [#1][#4]  air close:3",
  "filter closed: open: [#1][#4]  air close:3,issues:closed",
  "closed answered: open: [#1][#4]  air close:3",
  "close accepted: open: [#1][#4]  air issues:closed",
  "refresh answered: closed: [#2][#3]  air"
];

test("#4605 with `on`: the change after the held one shows the fallback", async () => {
  expect(await run(true)()).toEqual([
    ...before,
    "filter open: loading  air issues:open",
    "open answered: open: [#1][#4]  air"
  ]);
});

test("#4605 without `on`: the shown boundary forwards, the change holds", async () => {
  expect(await run(false)()).toEqual([
    ...before,
    "filter open: closed: [#2][#3]  air issues:open",
    "open answered: open: [#1][#4]  air"
  ]);
});
