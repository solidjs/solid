/**
 * Regression tests for #2902: reconcile's object diff descends into
 * node-less records that shelter subscribers deeper down.
 *
 * The contract this pins (maintainer ruling 2026-07-17):
 * - reconcile's in-place/identity guarantee holds for OBSERVED subtrees: a
 *   captured proxy with live subscribers anywhere below it is diffed in
 *   place — even when no intermediate level was ever tracked (nodes bubble
 *   a sticky `STORE_DESC` flag up the wrap chain, and the diff follows it).
 * - never-subscribed branches keep the wholesale identity-swap prune: the
 *   diff does not walk them, and captured-but-unobserved proxies may detach
 *   (staleness there is the pruning contract, not a bug — subscribing is
 *   what buys liveness).
 */
import { describe, expect, it, vi } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createStore,
  flush,
  reconcile
} from "../../src/index.js";

describe("reconcile reaches captured proxies with live subscribers (#2902)", () => {
  it("captured row proxy with a live subscriber survives reconcile through untracked levels", () => {
    const [state, setState] = createStore({ rows: [{ id: 1, name: "a" }] });
    const row = state.rows[0]; // captured untracked — no nodes on root or array
    let rowName = "";
    createRoot(() => {
      createRenderEffect(
        () => row.name,
        v => void (rowName = v)
      );
    });
    flush();
    expect(rowName).toBe("a");

    setState(reconcile({ rows: [{ id: 1, name: "b" }] }, "id"));
    flush();
    expect(row.name).toBe("b"); // captured proxy re-pointed
    expect(rowName).toBe("b"); // subscriber reran
    expect(state.rows[0]).toBe(row); // keyed identity kept
  });

  it("plain nested object shape (no array in the path)", () => {
    const [state, setState] = createStore({ user: { id: 1, name: "a" } });
    const user = state.user;
    let name = "";
    createRoot(() => {
      createRenderEffect(
        () => user.name,
        v => void (name = v)
      );
    });
    flush();

    setState(reconcile({ user: { id: 1, name: "b" } }, "id"));
    flush();
    expect(name).toBe("b");
    expect(state.user).toBe(user);
  });

  it("subscriber several levels below the capture, all intermediate levels untracked", () => {
    const [state, setState] = createStore({ a: { b: { c: { id: 1, value: 1 } } } });
    const c = state.a.b.c;
    let seen = 0;
    createRoot(() => {
      createRenderEffect(
        () => c.value,
        v => void (seen = v)
      );
    });
    flush();

    setState(reconcile({ a: { b: { c: { id: 1, value: 2 } } } }, "id"));
    flush();
    expect(seen).toBe(2);
    expect(state.a.b.c).toBe(c);
  });

  it("slow path (live override layer): captured subscriber still reached", () => {
    const [state, setState] = createStore({ other: 0, rows: [{ id: 1, name: "a" }] });
    const row = state.rows[0];
    let rowName = "";
    createRoot(() => {
      createRenderEffect(
        () => row.name,
        v => void (rowName = v)
      );
    });
    flush();

    // No flush between: the write's override layer is still live, so the
    // reconcile routes through applyStateSlow.
    setState(s => void (s.other = 1));
    setState(reconcile({ other: 1, rows: [{ id: 1, name: "b" }] }, "id"));
    flush();
    expect(rowName).toBe("b");
  });

  it("optimistic store: captured subscriber matches tracked-path behavior (parity in an action window)", async () => {
    // Ambient optimistic-store writes revert at flush end (#2899 pin), so the
    // meaningful assertion is parity: a captured-proxy subscriber sees exactly
    // what a fully-tracked subscriber sees, during the action window and after
    // settle.
    const [state, setState] = createOptimisticStore({ rows: [{ id: 1, name: "a" }] });
    const row = state.rows[0]; // captured — no nodes on root or array
    let captured = "";
    let trackedName = "";
    createRoot(() => {
      createRenderEffect(
        () => row.name,
        v => void (captured = v)
      );
      createRenderEffect(
        () => state.rows[0].name, // tracked chain: nodes at every level
        v => void (trackedName = v)
      );
    });
    flush();
    expect(captured).toBe("a");

    let resolveIt!: () => void;
    const act = action(function* () {
      setState(reconcile({ rows: [{ id: 1, name: "b" }] }, "id"));
      yield new Promise<void>(r => (resolveIt = r));
    });
    const done = act();
    flush();
    expect(captured).toBe("b"); // tentative write visible through the capture…
    expect(captured).toBe(trackedName); // …and identical to the tracked path

    resolveIt();
    await done;
    flush();
    // What settle does to an in-action reconcile is optimistic-store policy
    // (tentative writes revert; see createOptimisticStore pins) — #2902 only
    // guarantees the captured proxy tracks it identically.
    expect(captured).toBe(trackedName);
  });

  it("symbol-keyed child record with a subscriber below is reached", () => {
    const meta = Symbol("meta");
    const [state, setState] = createStore({ [meta]: { id: 1, value: 1 } });
    const child = state[meta];
    let seen = 0;
    createRoot(() => {
      createRenderEffect(
        () => child.value,
        v => void (seen = v)
      );
    });
    flush();

    setState(reconcile({ [meta]: { id: 1, value: 2 } } as any, "id"));
    flush();
    expect(seen).toBe(2);
  });

  it("key mismatch detaches the captured proxy (keyed identity contract)", () => {
    const [state, setState] = createStore({ rows: [{ id: 1, name: "a" }] });
    const row = state.rows[0];
    let rowName = "";
    createRoot(() => {
      createRenderEffect(
        () => row.name,
        v => void (rowName = v)
      );
    });
    flush();

    setState(reconcile({ rows: [{ id: 2, name: "b" }] }, "id"));
    flush();
    expect(state.rows[0].name).toBe("b"); // new identity through the root path
    expect(state.rows[0]).not.toBe(row); // different key — no in-place update
  });
});

describe("pruning is preserved (#2902)", () => {
  it("never-subscribed branches are not walked by the diff", () => {
    const [state, setState] = createStore({
      hot: { id: 1, value: 1 },
      cold: { id: 1, deep: { id: 1, items: [{ id: 1, v: 1 }] } }
    });
    let hot = 0;
    createRoot(() => {
      createRenderEffect(
        () => state.hot.value,
        v => void (hot = v)
      );
    });
    flush();

    // keyFn runs once per wrappable pair the diff considers — a spy on it
    // observes exactly which branches the walk enters.
    const visited: any[] = [];
    const keyFn = vi.fn((item: any) => {
      visited.push(item);
      return item.id;
    });
    setState(
      reconcile(
        {
          hot: { id: 1, value: 2 },
          cold: { id: 1, deep: { id: 1, items: [{ id: 1, v: 2 }] } }
        },
        keyFn
      )
    );
    flush();
    expect(hot).toBe(2);
    // The cold subtree was identity-swapped wholesale: no keyed comparisons
    // below its top-level pair ever ran.
    expect(visited.some(i => "v" in i || "items" in i)).toBe(false);
    expect(state.cold.deep.items[0].v).toBe(2); // fresh reads see new data
  });

  it("captured-but-unobserved proxies may detach (staleness is the pruning contract)", () => {
    const [state, setState] = createStore({ rows: [{ id: 1, name: "a" }] });
    const row = state.rows[0]; // captured, never subscribed anywhere below
    expect(row.name).toBe("a");

    setState(reconcile({ rows: [{ id: 1, name: "b" }] }, "id"));
    flush();
    expect(state.rows[0].name).toBe("b"); // fresh path sees new data
    expect(row.name).toBe("a"); // unobserved capture detached — pinned as design
  });
});
