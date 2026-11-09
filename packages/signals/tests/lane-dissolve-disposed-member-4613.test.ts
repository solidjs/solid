/**
 * #4613: a lane member disposed before the lane dissolves never runs again.
 *
 * A filter keys a region (a keyed map over `[filter()]`); in it a list is
 * mapped from an optimistic store under Loading > Errored. An action removes
 * a row (a guess) and `refresh`es the store; the filter changes while the
 * action is out, so that frame is held with it (D-34 ¶3). The action's
 * commit disposes the "open" region, inner list memo included — but that
 * memo was still a member of the action's lane. Dissolving the lane re-queued
 * it, and its pass dropped REACTIVE_DISPOSED at the head wipe: a dead node
 * came back to life in the torn-down region, mapped rows there and stayed
 * subscribed (dev: `RUN_WITH_DISPOSED_OWNER`).
 *
 * Ruled (F-3, D-11): a disposed reader is no reader; it holds nothing, and
 * nothing re-derives it (a dead node freezes, #3024).
 */
import { afterEach, expect, it, vi } from "vitest";
import {
  action,
  createErrorBoundary,
  createLoadingBoundary,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  refresh
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

afterEach(() => vi.restoreAllMocks());

it("#4613: a region disposed while its list is lane work does not run again (F-3, D-11)", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const settle = async (key: string, v: any) => {
    const i = asks.findIndex(a => a.key === key);
    expect(i).not.toBe(-1);
    asks.splice(i, 1)[0].res(v);
    await tick();
  };
  let shown = "";
  const rows: string[] = [];
  let setFilter!: (f: string) => void;
  let close!: (id: number) => any;
  const dispose = createRoot(d => {
    const [filter, sf] = createSignal("open");
    setFilter = sf;
    const [store, setStore] = createOptimisticStore(
      () => ask(`issues:${filter()}`),
      [] as { id: number }[],
      { key: "id" }
    );
    close = action(function* (id: number) {
      setStore(list => {
        const i = list.findIndex(t => t.id === id);
        if (i >= 0) list.splice(i, 1);
      });
      yield ask(`close:${id}`);
      refresh(store);
    });
    const regions = mapArray(
      () => [filter()],
      (f: string) =>
        createLoadingBoundary(
          () =>
            createErrorBoundary(
              () => {
                const list = mapArray(
                  () => store,
                  (it: { id: number }) => {
                    rows.push(`${f}:${it.id}`);
                    return `[#${it.id}]`;
                  }
                );
                return () => list().join("");
              },
              e => () => `error ${(e() as Error).message}`
            ),
          () => () => "loading"
        )
    );
    createRenderEffect(
      () =>
        regions()
          .map(r => {
            // Boundaries resolve function children; unwrap whatever is left.
            let v: any = r();
            while (typeof v === "function") v = v();
            return v;
          })
          .join(""),
      v => void (shown = v)
    );
    return d;
  });
  await tick();
  await settle("issues:open", [{ id: 1 }, { id: 3 }, { id: 4 }]);
  expect(shown).toBe("[#1][#3][#4]");
  close(3);
  await tick();
  expect(shown).toBe("[#1][#4]");
  setFilter("closed");
  await tick();
  expect(shown).toBe("[#1][#4]");
  await settle("issues:closed", [{ id: 2 }]);
  await settle("close:3", {});
  rows.length = 0;
  await settle("issues:closed", [{ id: 2 }, { id: 3 }]);
  expect(shown).toBe("[#2][#3]");
  setFilter("open");
  await tick();
  await settle("issues:open", [{ id: 1 }, { id: 4 }]);
  expect(shown).toBe("[#1][#4]");
  // Only live regions mapped rows: none for the disposed "open" region.
  expect(rows).toEqual(["closed:2", "closed:3", "open:1", "open:4"]);
  expect(warn.mock.calls.map(c => String(c[0])).filter(m => m.includes("DISPOSED"))).toEqual([]);
  dispose();
});
