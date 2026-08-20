import { describe, expect, it } from "vitest";
import {
  action,
  createRoot,
  createStore,
  flush,
  reconcile,
  registerPatch
} from "../../src/index.js";

describe("patch channel (PR-A)", () => {
  it("setter write applies the patch at flush, not at write time", () => {
    const [state, setState] = createStore({ user: { name: "a", title: "x" } });
    const log: string[] = [];
    registerPatch(state.user, (next: any, prev: any, force?: boolean) => {
      log.push((force ? "F:" : "") + prev?.name + "->" + next.name);
    });
    setState(s => {
      s.user.name = "b";
    });
    // Effect-phase timing: nothing applied inside the batch window.
    expect(log).toEqual([]);
    flush();
    expect(log.length).toBe(1);
    expect(log[0].endsWith("->b")).toBe(true);
  });

  it("reconcile applies the patch with (incoming, pre-adopt prev)", () => {
    const [state, setState] = createStore({ rows: [{ id: 1, count: 5 }] });
    const log: string[] = [];
    registerPatch(state.rows[0], (next: any, prev: any) => {
      log.push(prev.count + "->" + next.count);
    });
    setState(s => {
      reconcile([{ id: 1, count: 9 }], "id")(s.rows);
    });
    flush();
    expect(log).toEqual(["5->9"]);
  });

  it("targeted nested write bubbles to the ancestor patch as a forced re-apply", () => {
    const [state, setState] = createStore({
      rows: [{ id: 1, count: 1, queries: [{ elapsed: "1" }] }]
    });
    const log: Array<[boolean | undefined, string]> = [];
    registerPatch(state.rows[0], (next: any, prev: any, force?: boolean) => {
      log.push([force, next.queries[0].elapsed]);
    });
    // Touch the nested record through the draft so it has its own target,
    // then write it directly — the row patch must still hear about it.
    setState(s => {
      s.rows[0].queries[0].elapsed = "2";
    });
    flush();
    expect(log.length).toBe(1);
    expect(log[0][0]).toBe(true); // forced (ancestor bubble)
    expect(log[0][1]).toBe("2");
  });

  it("unbind stops dispatch; multi-consumer keeps the other", () => {
    const [state, setState] = createStore({ user: { name: "a" } });
    const a: string[] = [];
    const b: string[] = [];
    const unbindA = registerPatch(state.user, (n: any) => a.push(n.name));
    registerPatch(state.user, (n: any) => b.push(n.name));
    unbindA();
    setState(s => {
      s.user.name = "z";
    });
    flush();
    expect(a).toEqual([]);
    expect(b).toEqual(["z"]);
  });

  it("transition-held write does NOT apply until the transition commits", async () => {
    const [state, setState] = createStore({ user: { name: "a" } });
    const log: string[] = [];
    registerPatch(state.user, (next: any) => log.push(next.name));
    let resolve!: () => void;
    let save!: () => Promise<void> | void;
    createRoot(() => {
      save = action(function* () {
        setState(s => {
          s.user.name = "held";
        });
        yield new Promise<void>(r => {
          resolve = r;
        });
      }) as any;
    });
    const p = save();
    flush();
    // The write rides the action's transition: not visible, not patched.
    expect(log).toEqual([]);
    resolve();
    await p;
    flush();
    // Transition committed: the patch applies with the landed value.
    expect(log).toEqual(["held"]);
  });

  it("optimistic write patches the view in flight, revert force-reapplies committed", async () => {
    const { createOptimisticStore, action: act } = await import("../../src/index.js");
    const [state, setState] = (createOptimisticStore as any)({ user: { name: "saved" } });
    const log: Array<[string, boolean | undefined]> = [];
    registerPatch(state.user, (next: any, _prev: any, force?: boolean) =>
      log.push([next.name, force])
    );
    let reject!: (e: any) => void;
    let save!: () => Promise<void> | void;
    createRoot(() => {
      save = act(function* () {
        setState((s: any) => {
          s.user.name = "optimistic";
        });
        yield new Promise<void>((_, rej) => {
          reject = rej;
        });
      }) as any;
    });
    const p = (save() as Promise<void>).catch(() => {});
    flush();
    // Override applied THIS flush — in-flight visibility.
    expect(log.length).toBe(1);
    expect(log[0][0]).toBe("optimistic");
    reject(new Error("fail"));
    await p;
    flush();
    // Revert: forced re-apply lands with committed truth visible.
    const last = log[log.length - 1];
    expect(last[1]).toBe(true);
    expect(state.user.name).toBe("saved");
  });

  it("async projection refetch patches at landing, never mid-flight", async () => {
    const { refresh } = await import("../../src/index.js");
    let resolve!: (v: any) => void;
    let state: any;
    createRoot(() => {
      [state] = createStore(async () => {
        const user = await new Promise<any>(r => {
          resolve = r;
        });
        return { user };
      }, {} as any);
    });
    flush();
    resolve({ name: "first" });
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(state.user.name).toBe("first");

    const log: string[] = [];
    registerPatch(state.user, (next: any) => log.push(next.name));

    refresh(state);
    flush();
    // Mid-refetch: no patch fired, DOM state untouched.
    expect(log).toEqual([]);
    resolve({ name: "second" });
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(state.user.name).toBe("second");
    expect(log).toEqual(["second"]);
  });

  it("row ops: aligned ticks emit nothing; reorder/insert/remove emit exact ops", async () => {
    const { registerRowOps } = await import("../../src/index.js");
    const [state, setState] = createStore({
      rows: [
        { id: "a", v: 1 },
        { id: "b", v: 2 },
        { id: "c", v: 3 }
      ]
    });
    const ops: any[] = [];
    registerRowOps(state.rows, (next: any[], o: any) =>
      ops.push({
        prefix: o.prefix,
        sources: o.sources,
        removed: o.removed.map((r: any) => r.id),
        ids: next.map(r => r.id)
      })
    );
    // Aligned value tick: same keys, same order — NO structural emission.
    setState(s => {
      reconcile(
        [
          { id: "a", v: 9 },
          { id: "b", v: 9 },
          { id: "c", v: 9 }
        ],
        "id"
      )(s.rows);
    });
    flush();
    expect(ops).toEqual([]);
    // Reorder + insert + remove: c moves front, b removed, d added.
    setState(s => {
      reconcile(
        [
          { id: "c", v: 3 },
          { id: "d", v: 4 },
          { id: "a", v: 1 }
        ],
        "id"
      )(s.rows);
    });
    flush();
    expect(ops.length).toBe(1);
    const o = ops[0];
    expect(o.prefix).toBe(0);
    // c came from old index 2, d is new, a came from old index 0.
    expect(o.sources).toEqual([2, -1, 0]);
    expect(o.removed).toEqual(["b"]);
    expect(o.ids).toEqual(["c", "d", "a"]);
  });

  it("disposed owner drops its patches mid-flight", () => {
    const [state, setState] = createStore({ user: { name: "a" } });
    const log: string[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      registerPatch(state.user, (n: any) => log.push(n.name));
    });
    setState(s => {
      s.user.name = "b";
    });
    dispose();
    flush();
    expect(log).toEqual([]);
  });
});
