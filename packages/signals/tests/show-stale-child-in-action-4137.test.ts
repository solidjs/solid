/**
 * #4137 — a child under a non-keyed `<Show>` re-ran after its condition went
 * falsy inside an open action, read the narrowed accessor and halted the
 * system ("Attempting to access a stale value from <Show>").
 *
 * The Show's branch is lane work: its row was added by an optimistic write,
 * so the For row, the Show's memos and the child memo are all passes of the
 * action's lane. When a later pass of the same lane turns the condition
 * falsy, the Show's value memo re-runs as lane work and parks the branch it
 * replaces as a lane frame (#3698): it stays the displayed frame until the
 * lane's apply retires it. The condition's re-staging dirtied the child as
 * the lane's own work (REACTIVE_LANE_DIRTY), and a lane-dirty zombie ran at
 * once (the #3463 arm, meant for a transaction's zombie a lane reveals
 * through) — so the child computed the hidden world on a frame the pass had
 * already withdrawn. A lane frame follows mainline writes only: the lane's
 * own dirty on one is cancelled.
 *
 * The report's shape (`reported`): the condition reads a derived keyed record
 * (a projection) that, mid-action, first serves the round's staging and then
 * — the flush parks on a plain write the action holds, and the lane's
 * readers of that staging re-derive on the committed world next round (A15
 * lanes corollary) — the committed record without the added row, while the
 * id list (the lane) still has it. The second variant needs no record: the
 * action's own second optimistic write hides a row it added and revealed.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createOptimisticStore,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  untrack
} from "../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 0));

/** solid-js's non-keyed `<Show>` (packages/solid/src/client/flow.ts): the
 * narrowed accessor is stale once the selecting read went falsy — counted
 * here instead of thrown. */
function show<T>(when: () => T, child: (row: () => T) => () => string, stale: string[]) {
  const value = createMemo(when);
  const condition = createMemo(value, { equals: (a: any, b: any) => !a === !b });
  let shown: any = false;
  return createMemo(() => {
    const c = condition();
    shown = c;
    if (!c) return undefined;
    return untrack(() =>
      child(() => {
        if (!shown) stale.push(String(untrack(value)));
        return value();
      })
    );
  });
}

describe("#4137: a Show branch hidden by its own lane does not re-run", () => {
  it("reported: a derived record drops the action's row while the list keeps it", async () => {
    const log: string[] = [];
    const stale: string[] = [];
    const [nodes, setNodes] = createOptimisticStore<{ id: string; selected?: boolean }[]>([
      { id: "a" }
    ]);
    // A plain write the action holds, of a row proxy its setter handed out.
    const [held, setHeld] = createSignal<{ selected?: boolean } | undefined>(undefined);
    createRoot(() => {
      createEffect(
        () => void held()?.selected,
        () => {}
      );
      const present = createProjection<Record<string, boolean>>(draft => {
        for (const n of nodes) draft[n.id] = true;
      }, {});
      const ids = createMemo(() => nodes.map(n => n.id));
      const view = mapArray(ids, id =>
        show(
          () => (present[id] ? id : undefined),
          row => createMemo(() => `${row()}`),
          stale
        )
      );
      createRenderEffect(
        () => view().map(v => v()?.()),
        v => void log.push(JSON.stringify(v))
      );
    });
    flush();

    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const go = action(function* () {
      let row: { selected?: boolean };
      setNodes(ns => {
        ns.push({ id: "b" });
        (row = ns[1]!).selected = true;
      });
      setHeld(row!);
      yield gate;
    });
    void go();
    await tick();
    flush();
    expect(stale).toEqual([]);
    // The lane lists `b`, and the record has it too: the derive's pass is the
    // lane's work (it reads the lane's rows), so its write of the new key is
    // the lane's derivation, as a memo building the same record would be —
    // for a leaf born after the write as for one that existed (#4478,
    // #4451; E3). (Before #4451 the leaf was born a staging the park held,
    // and the branch showed its fallback mid-action: `["a",null]`.)
    // Pin flipped with #4451 (accepted by the maintainer): the store now matches its memo twin.
    expect(log).toEqual(['["a"]', '["a","b"]']);
    release();
    await tick();
    flush();
    expect(stale).toEqual([]);
    expect(log.at(-1)).toBe('["a"]');
  });

  it("the action hides a row it added and revealed", async () => {
    const log: string[] = [];
    const stale: string[] = [];
    const [s, set] = createOptimisticStore<{ ids: string[]; rows: Record<string, string> }>({
      ids: ["a"],
      rows: { a: "a" }
    });
    createRoot(() => {
      const view = mapArray(
        () => s.ids,
        id =>
          show(
            () => s.rows[id],
            row => createMemo(() => `${row()}`),
            stale
          )
      );
      createRenderEffect(
        () => view().map(v => v()?.()),
        v => void log.push(JSON.stringify(v))
      );
    });
    flush();

    let next!: () => void, done!: () => void;
    const g1 = new Promise<void>(r => (next = r));
    const g2 = new Promise<void>(r => (done = r));
    const go = action(function* () {
      set(d => {
        d.ids.push("b");
        d.rows.b = "b";
      });
      yield g1;
      set(d => void delete d.rows.b);
      yield g2;
    });
    void go();
    await tick();
    flush();
    expect(log.at(-1)).toBe('["a","b"]');
    next();
    await tick();
    flush();
    expect(stale).toEqual([]);
    expect(log.at(-1)).toBe('["a",null]');
    done();
    await tick();
    flush();
    expect(stale).toEqual([]);
    expect(log.at(-1)).toBe('["a"]');
  });
});
