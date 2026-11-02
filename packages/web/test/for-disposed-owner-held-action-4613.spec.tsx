/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4613: a filter keys a region (`<For each={[filter()]}>`) and an action
 * removes a row from the list store, then `refresh`es it. The filter change
 * made while the action is out is held with it (D-34 ¶3). When the action
 * commits, the "open" region is disposed — and its inner `<For>`'s list
 * memo with it — but that memo was still a member of the action's lane. The
 * lane's dissolution re-queued it, and the re-run brought a disposed node
 * back to life in the torn-down region (`RUN_WITH_DISPOSED_OWNER`, twice).
 * A disposed reader is no reader (F-3, D-11): it never runs again.
 */
import { render } from "@solidjs/web";
import {
  action,
  createOptimisticStore,
  createSignal,
  Errored,
  flush,
  For,
  Loading,
  refresh
} from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

afterEach(() => vi.restoreAllMocks());

it("a region disposed under an action's lane does not run again (#4613)", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const settle = async (key: string, v: any) => {
    const i = asks.findIndex(a => a.key === key);
    expect(i).not.toBe(-1);
    asks.splice(i, 1)[0].res(v);
    await tick();
  };
  const container = document.createElement("div");
  let setFilter!: (f: string) => void;
  let closeOne!: (id: number) => any;
  const rows: string[] = [];
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
    return (
      <For each={[filter()]}>
        {(f: string) => (
          <Loading fallback={<p>loading {f}</p>}>
            <Errored fallback={(e: any) => <p>error {e().message}</p>}>
              <For each={issues}>
                {(it: any) => {
                  rows.push(`${f}:${it.id}`);
                  return <i>[#{it.id}]</i>;
                }}
              </For>
            </Errored>
          </Loading>
        )}
      </For>
    );
  }, container);
  await tick();
  await settle("issues:open", [{ id: 1 }, { id: 3 }, { id: 4 }]);
  expect(container.textContent).toBe("[#1][#3][#4]");
  closeOne(3);
  await tick();
  expect(container.textContent).toBe("[#1][#4]");
  setFilter("closed");
  await tick();
  // Held with the action (D-34 ¶3).
  expect(container.textContent).toBe("[#1][#4]");
  await settle("issues:closed", [{ id: 2 }]);
  expect(container.textContent).toBe("[#1][#4]");
  await settle("close:3", {});
  rows.length = 0;
  await settle("issues:closed", [{ id: 2 }, { id: 3 }]);
  expect(container.textContent).toBe("[#2][#3]");
  setFilter("open");
  await tick();
  await settle("issues:open", [{ id: 1 }, { id: 4 }]);
  expect(container.textContent).toBe("[#1][#4]");
  // No row was built for a disposed "open" region: only the live regions'.
  expect(rows).toEqual(["closed:2", "closed:3", "open:1", "open:4"]);
  expect(warn.mock.calls.map(c => String(c[0])).filter(m => m.includes("DISPOSED"))).toEqual([]);
  dispose();
});
