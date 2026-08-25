/**
 * Regression tests for #2864 — store-in-store $TRACK chaining.
 *
 * A derived store (projection / derived optimistic store) that returns another
 * store wraps it in its own proxy view (`STORE_WRAP`), giving the view a node
 * record separate from the wrapped source's. Structural notifications
 * (reconcile's `notifySelf`, added/removed keys) land on the SOURCE's $TRACK
 * self-node, so any consumer that subscribes structurally through the wrapper
 * view — `mapArray`/`<For>` via `$TRACK`, `Object.keys` via `ownKeys`,
 * `snapshot`/`deep` via `trackSelf` — never re-ran. In #2864 that surfaced as
 * an optimistic row (`id: 100`) surviving in `<For>` after the refresh landed,
 * while direct property reads showed fresh data. `trackSelf` now chains the
 * wrapper's $TRACK read through to the wrapped source.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush,
  mapArray,
  refresh,
  snapshot,
  type Refreshable,
  type Store
} from "../../src/index.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => (resolve = r));
  return { promise, resolve };
}

type Item = { id: number };

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  flush();
}

function setup() {
  let gate = deferred();
  let base = [{ id: 1 }, { id: 2 }, { id: 3 }];
  let items!: Refreshable<Store<Item[]>>;
  let setItems!: (fn: (s: Item[]) => Item[]) => void;
  let main!: Store<{ theItems: readonly Item[] }>;
  let setMain!: (fn: (s: { theItems: Item[] }) => void) => void;
  const disposers: (() => void)[] = [];

  createRoot(dispose => {
    disposers.push(dispose);
    [items, setItems] = createOptimisticStore<Item[]>(async () => {
      await gate.promise;
      base = [...base, { id: base.length + 1 }];
      return base;
    }, []);

    const [m, sm] = createOptimisticStore<{ theItems: readonly Item[] }>(
      () => ({ theItems: items }),
      { theItems: [] }
    );
    main = m;
    setMain = sm as typeof setMain;
  });

  return {
    items: () => items as Store<Item[]>,
    setItems: (fn: (s: Item[]) => Item[]) => setItems(fn),
    main: () => main,
    setMain: (fn: (s: { theItems: Item[] }) => void) => setMain(fn),
    refreshItems: () => refresh(items),
    resolveFetch: () => {
      const g = gate;
      gate = deferred();
      g.resolve();
    },
    dispose: () => disposers.forEach(d => d())
  };
}

describe("#2864: optimistic write mid-refetch is consumed when data lands", () => {
  it("direct read of the base store", async () => {
    const t = setup();
    const ids: number[][] = [];
    createRoot(() => {
      createRenderEffect(
        () => t.items().map(i => i.id),
        v => {
          ids.push(v);
        }
      );
    });
    flush();
    t.resolveFetch();
    await settle();
    expect(ids.at(-1)).toEqual([1, 2, 3, 4]);

    // refresh, then optimistic write mid-refetch
    t.refreshItems();
    t.setItems(s => [...s, { id: 100 }]);
    flush();
    expect(ids.at(-1)).toEqual([1, 2, 3, 4, 100]);

    // fetch lands: overlay must be consumed
    t.resolveFetch();
    await settle();
    expect(ids.at(-1)).toEqual([1, 2, 3, 4, 5]);
    t.dispose();
  });

  it("read through derived optimistic store + mapArray (the <For> path)", async () => {
    const t = setup();
    const ids: number[][] = [];
    let rows!: () => (() => number)[];
    createRoot(() => {
      rows = mapArray(
        () => t.main().theItems,
        item => () => item.id
      );
      createRenderEffect(
        () => rows().map(r => r()),
        v => {
          ids.push(v);
        }
      );
    });
    flush();
    t.resolveFetch();
    await settle();
    expect(ids.at(-1)).toEqual([1, 2, 3, 4]);

    t.refreshItems();
    t.setItems(s => [...s, { id: 100 }]);
    flush();
    expect(ids.at(-1)).toEqual([1, 2, 3, 4, 100]);

    t.resolveFetch();
    await settle();
    expect(rows().map(r => r())).toEqual([1, 2, 3, 4, 5]);
    expect(ids.at(-1)).toEqual([1, 2, 3, 4, 5]);
    t.dispose();
  });

  it("mapArray directly over the base store", async () => {
    const t = setup();
    const ids: number[][] = [];
    createRoot(() => {
      const rows = mapArray(
        () => t.items(),
        item => () => item.id
      );
      createRenderEffect(
        () => rows().map(r => r()),
        v => {
          ids.push(v);
        }
      );
    });
    flush();
    t.resolveFetch();
    await settle();
    expect(ids.at(-1)).toEqual([1, 2, 3, 4]);

    t.refreshItems();
    t.setItems(s => [...s, { id: 100 }]);
    flush();
    expect(ids.at(-1)).toEqual([1, 2, 3, 4, 100]);

    t.resolveFetch();
    await settle();
    expect(ids.at(-1)).toEqual([1, 2, 3, 4, 5]);
    t.dispose();
  });

  it("read through derived optimistic store without mapArray", async () => {
    const t = setup();
    const ids: number[][] = [];
    createRoot(() => {
      createRenderEffect(
        () => t.main().theItems.map(i => i.id),
        v => {
          ids.push(v);
        }
      );
    });
    flush();
    t.resolveFetch();
    await settle();
    expect(ids.at(-1)).toEqual([1, 2, 3, 4]);

    t.refreshItems();
    t.setItems(s => [...s, { id: 100 }]);
    flush();
    expect(ids.at(-1)).toEqual([1, 2, 3, 4, 100]);

    t.resolveFetch();
    await settle();
    expect(ids.at(-1)).toEqual([1, 2, 3, 4, 5]);
    t.dispose();
  });

  it("Object.keys enumeration through the derived store stays live", async () => {
    let gate = deferred();
    let main!: Store<{ obj: Record<string, number> }>;
    let inner!: Refreshable<Store<Record<string, number>>>;
    const keys: string[][] = [];
    const disposers: (() => void)[] = [];
    let phase = 0;

    createRoot(dispose => {
      disposers.push(dispose);
      [inner] = createOptimisticStore<Record<string, number>>(async () => {
        const p = phase;
        await gate.promise;
        return (p === 0 ? { a: 1 } : { a: 1, b: 2 }) as Record<string, number>;
      }, {});
      [main] = createOptimisticStore<{ obj: Record<string, number> }>(() => ({ obj: inner }), {
        obj: {}
      });
      createRenderEffect(
        () => Object.keys(main.obj),
        v => {
          keys.push(v);
        }
      );
    });
    flush();
    gate.resolve();
    await settle();
    expect(keys.at(-1)).toEqual(["a"]);

    phase = 1;
    gate = deferred();
    refresh(inner);
    gate.resolve();
    await settle();
    expect(keys.at(-1)).toEqual(["a", "b"]);
    disposers.forEach(d => d());
  });

  it("an active override on the wrapper view holds — inner changes don't leak mid-hold, the reveal shows them", async () => {
    const t = setup();
    const ids: number[][] = [];
    createRoot(() => {
      const rows = mapArray(
        () => t.main().theItems,
        item => () => item.id
      );
      createRenderEffect(
        () => rows().map(r => r()),
        v => {
          ids.push(v);
        }
      );
    });
    flush();
    t.resolveFetch();
    await settle();
    expect(ids.at(-1)).toEqual([1, 2, 3, 4]);

    // Optimistic write through the OUTER draft: lands on the wrapper view's
    // optimistic layer and holds while the action is open.
    let release!: () => void;
    const hold = new Promise<void>(r => (release = r));
    const act = action(function* () {
      t.setMain(m => {
        m.theItems.push({ id: 200 });
      });
      yield hold;
    });
    const actPromise = act();
    flush();
    expect(ids.at(-1)).toEqual([1, 2, 3, 4, 200]);
    const runsAtHold = ids.length;

    // Inner refresh lands MID-HOLD: the wrapper's subscribers must not churn.
    t.refreshItems();
    flush();
    t.resolveFetch();
    await settle();
    expect(ids.length).toBe(runsAtHold);
    expect(ids.at(-1)).toEqual([1, 2, 3, 4, 200]);

    // Action completes: override reverts, reveal notifies the view's self-node,
    // and the re-run re-chains — the mid-hold inner data (id: 5) is visible.
    release();
    await actPromise;
    await settle();
    expect(ids.at(-1)).toEqual([1, 2, 3, 4, 5]);
    t.dispose();
  });

  it("snapshot through the derived store after landing", async () => {
    const t = setup();
    createRoot(() => {
      createRenderEffect(
        () => t.main().theItems.length,
        () => {}
      );
    });
    flush();
    t.resolveFetch();
    await settle();

    t.refreshItems();
    t.setItems(s => [...s, { id: 100 }]);
    flush();

    t.resolveFetch();
    await settle();
    expect(snapshot(t.items()).map(i => i.id)).toEqual([1, 2, 3, 4, 5]);
    expect(snapshot(t.main().theItems).map(i => i.id)).toEqual([1, 2, 3, 4, 5]);
    t.dispose();
  });
});
