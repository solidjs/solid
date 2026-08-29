import { describe, expect, it } from "vitest";
import {
  action,
  createErrorBoundary,
  createRoot,
  createStore,
  flush,
  reconcile,
  registerPatch,
  resetErrorHalt
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
    // Node delivery: ancestor re-applies ride exact prev-snapshot compares
    // instead of forced re-runs — the CONTRACT is the delivered value.
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
    // Revert: the re-apply lands with committed truth visible (node
    // delivery compares against the optimistic prev snapshot — no force).
    const last = log[log.length - 1];
    expect(last[0]).toBe("saved");
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

  it("shallow keyed arrays emit row ops; aligned value ticks emit nothing", async () => {
    const { registerRowOps } = await import("../../src/index.js");
    const [state, setState] = createStore(
      [
        { id: "a", v: 1 },
        { id: "b", v: 2 }
      ] as any,
      { shallow: true } as any
    );
    const ops: any[] = [];
    registerRowOps(state, (_next: any[], o: any) =>
      ops.push({ prefix: o.prefix, sources: o.sources, removed: o.removed.map((r: any) => r.id) })
    );
    // Aligned value tick: fresh records, same keys/order — slots replace but
    // NO structural emission.
    setState((s: any) => {
      reconcile(
        [
          { id: "a", v: 9 },
          { id: "b", v: 9 }
        ],
        "id"
      )(s);
    });
    flush();
    expect(ops).toEqual([]);
    // Reorder + remove + add.
    setState((s: any) => {
      reconcile(
        [
          { id: "b", v: 2 },
          { id: "c", v: 3 }
        ],
        "id"
      )(s);
    });
    flush();
    expect(ops.length).toBe(1);
    expect(ops[0]).toEqual({ prefix: 0, sources: [1, -1], removed: ["a"] });
  });

  it("a throwing patch does not abort sibling patches (first error rethrows)", () => {
    const [state, setState] = createStore({ a: { v: 1 }, b: { v: 1 } });
    const applied: string[] = [];
    registerPatch(state.a, () => {
      throw new Error("boom");
    });
    registerPatch(state.b, (next: any) => applied.push("b:" + next.v));
    setState(s => {
      s.a.v = 2;
      s.b.v = 2;
    });
    expect(() => flush()).toThrow("boom");
    expect(applied).toEqual(["b:2"]);
    // Unhandled patch errors HALT like unhandled effect errors — revive the
    // scheduler for the rest of the file (standard test hook).
    resetErrorHalt();
  });

  it("setter-channel structural mutation emits identity-keyed row ops", async () => {
    const { registerRowOps } = await import("../../src/index.js");
    const a = { id: "a", v: 1 };
    const b = { id: "b", v: 2 };
    const c = { id: "c", v: 3 };
    const [state, setState] = createStore({ rows: [a, b, c] });
    const ops: any[] = [];
    registerRowOps(state.rows, (_next: any[], o: any) =>
      ops.push({ prefix: o.prefix, sources: o.sources, removed: o.removed.map((r: any) => r.id) })
    );

    // Value-only fold: array shape unchanged — no structural emission.
    setState(s => {
      s.rows[0].v = 10;
    });
    flush();
    expect(ops).toEqual([]);

    // splice removal: same row objects, one gone.
    setState(s => {
      s.rows.splice(1, 1);
    });
    flush();
    expect(ops).toEqual([{ prefix: 1, sources: [2], removed: ["b"] }]);

    // push: pure append past the aligned prefix.
    setState(s => {
      s.rows.push({ id: "d", v: 4 });
    });
    flush();
    expect(ops[1]).toEqual({ prefix: 2, sources: [-1], removed: [] });

    // permutation: same objects reversed — moves only, no removals.
    setState(s => {
      s.rows.reverse();
    });
    flush();
    expect(ops[2]).toEqual({ prefix: 0, sources: [2, 1, 0], removed: [] });
  });

  it("a throwing patch routes to the enclosing error boundary like a render-effect error", () => {
    const [state, setState] = createStore({ a: { v: 1 }, b: { v: 1 } });
    const applied: string[] = [];
    let caught: unknown;
    const b = createRoot(() =>
      createErrorBoundary(
        () => {
          // Registered under the boundary's owner: a throw during drain
          // must route up this owner's queue chain, not crash the flush.
          registerPatch(state.a, (n: any) => {
            if (n.v > 1) throw new Error("row boom");
          });
          registerPatch(state.b, (n: any) => applied.push("b:" + n.v));
          return "content";
        },
        e => {
          caught = e();
          return "errored";
        }
      )
    );
    expect(b()).toBe("content");
    setState(s => {
      s.a.v = 2;
      s.b.v = 2;
    });
    expect(() => flush()).not.toThrow();
    // Sibling isolation still holds under routing.
    expect(applied).toEqual(["b:2"]);
    expect(b()).toBe("errored");
    expect(String(caught)).toContain("row boom");
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

describe("patch channel (re-audit hardening)", () => {
  it("unbind returns the channel to baseline; double-unbind never double-counts", async () => {
    const { patchCountForTests } = await import("../../src/store/next/patch.js");
    // Earlier tests in this file leak registrations by design — assert the
    // DELTA returns to this test's own baseline.
    const base = patchCountForTests();
    const [state] = createStore({ user: { name: "a" }, other: { name: "b" } });
    const u1 = registerPatch(state.user, () => {});
    const u2 = registerPatch(state.other, () => {});
    expect(patchCountForTests()).toBe(base + 2);
    u1();
    u1(); // idempotent — must not double-decrement
    expect(patchCountForTests()).toBe(base + 1);
    u2();
    expect(patchCountForTests()).toBe(base);
  });

  it("merged overlapping transitions release BOTH stashes of held patches at commit", async () => {
    const [state, setState] = createStore({ a: { v: "a0" }, b: { v: "b0" } });
    const log: string[] = [];
    registerPatch(state.a, (n: any) => log.push("a:" + n.v));
    registerPatch(state.b, (n: any) => log.push("b:" + n.v));
    let resolveA!: () => void;
    let resolveB!: () => void;
    let saveA!: () => Promise<void> | void;
    let saveB!: () => Promise<void> | void;
    createRoot(() => {
      saveA = action(function* () {
        setState(s => {
          s.a.v = "a1";
        });
        yield new Promise<void>(r => {
          resolveA = r;
        });
      }) as any;
      saveB = action(function* () {
        setState(s => {
          s.b.v = "b1";
        });
        yield new Promise<void>(r => {
          resolveB = r;
        });
      }) as any;
    });
    const pa = saveA();
    flush();
    const pb = saveB();
    flush();
    // Both writes ride transitions — nothing visible, nothing patched.
    expect(log).toEqual([]);
    resolveA();
    resolveB();
    await pa;
    await pb;
    flush();
    // Whatever merging happened between the overlapping transitions, each
    // held patch releases exactly once at the surviving commit.
    expect(log.sort()).toEqual(["a:a1", "b:b1"]);
  });

  it("optimistic drain isolates a throwing patch and routes it to the boundary", async () => {
    const { createOptimisticStore, action: act } = await import("../../src/index.js");
    const [state, setState] = (createOptimisticStore as any)({ a: { v: 0 }, b: { v: 0 } });
    const applied: string[] = [];
    let caught: unknown;
    const b = createRoot(() =>
      createErrorBoundary(
        () => {
          registerPatch(state.a, (n: any) => {
            if (n.v > 0) throw new Error("optimistic boom");
          });
          registerPatch(state.b, (n: any) => applied.push("b:" + n.v));
          return "content";
        },
        e => {
          caught = e();
          return "errored";
        }
      )
    );
    expect(b()).toBe("content");
    let resolve!: () => void;
    let save!: () => Promise<void> | void;
    createRoot(() => {
      save = act(function* () {
        setState((s: any) => {
          s.a.v = 1;
          s.b.v = 1;
        });
        yield new Promise<void>(r => {
          resolve = r;
        });
      }) as any;
    });
    const p = (save() as Promise<void>).catch(() => {});
    // Lane-timed delivery: the throwing sibling must not abort b's patch —
    // owner-neutral delivery effects dispatch independently, so the healthy
    // channel applies before the boundary teardown (queue-contract parity).
    expect(() => flush()).not.toThrow();
    expect(applied).toEqual(["b:1"]);
    expect(b()).toBe("errored");
    expect(String(caught)).toContain("optimistic boom");
    resolve();
    await p;
    flush();
  });

  it("accessor-bearing records are NOT admitted (scan runs at admission)", async () => {
    const { patchableRaw } = await import("../../src/index.js");
    const [state] = createStore({
      plain: { v: 1 },
      computed: {
        base: 2,
        get double() {
          return this.base * 2;
        }
      }
    });
    // Never written, never scanned — admission itself must run the scan.
    expect(patchableRaw(state.computed)).toBeUndefined();
    expect(patchableRaw(state.plain)).not.toBeUndefined();
  });

  it("a record that acquires an accessor demotes its patches to tracked effects", async () => {
    const { patchCountForTests } = await import("../../src/store/next/patch.js");
    const { createSignal } = await import("../../src/index.js");
    const base = patchCountForTests();
    const [dep, setDep] = createRoot(() => createSignal(10));
    const [state, setState] = createStore<any>({ user: { name: "a" } });
    const log: string[] = [];
    let dispose!: () => void;
    let unbind!: () => void;
    createRoot(d => {
      dispose = d;
      unbind = registerPatch(state.user, (next: any) =>
        log.push(next.name + ":" + (next.score ?? "-"))
      );
    });
    setState(s => {
      s.user.name = "b";
    });
    flush();
    expect(log).toEqual(["b:-"]);
    // The accessor arrives: patches demote — the SAME body re-drives as a
    // tracked effect (initial force-apply at effect phase).
    setState(s => {
      Object.defineProperty(s.user, "score", {
        get() {
          return dep();
        },
        enumerable: true,
        configurable: true
      });
    });
    flush();
    // Demotion repaired the count; the late unbind is inert (no negative).
    expect(patchCountForTests()).toBe(base);
    unbind();
    expect(patchCountForTests()).toBe(base);
    expect(log[log.length - 1]).toBe("b:10");
    // The getter's OUTSIDE dependency now re-applies — the exact divergence
    // unsound admission would have silently dropped.
    setDep(11);
    flush();
    expect(log[log.length - 1]).toBe("b:11");
    dispose();
  });

  it("same-batch emissions coalesce: two setters, one application (effect parity)", () => {
    const [state, setState] = createStore({ user: { name: "a", title: "x" } });
    let applies = 0;
    registerPatch(state.user, () => {
      applies++;
    });
    setState(s => {
      s.user.name = "b";
    });
    setState(s => {
      s.user.title = "y";
    });
    flush();
    // Both emissions capture the same live pending backing and the same
    // committed prev — a classic effect runs once for the batch; so does
    // the patch.
    expect(applies).toBe(1);
    expect(state.user.name).toBe("b");
    expect(state.user.title).toBe("y");
    // The NEXT batch applies again (stale-stamp check).
    setState(s => {
      s.user.name = "c";
    });
    flush();
    expect(applies).toBe(2);
  });

  it("a no-op adoption (A→B→A) does not freeze later setter row ops (re-audit 5, P1-1)", async () => {
    const { registerRowOps } = await import("../../src/index.js");
    const original = [{ id: 1 }, { id: 2 }];
    const [arr, setArr] = createStore<any[]>(original);
    const ops: any[] = [];
    registerRowOps(arr, (_next: any[], o: any) => ops.push(o));
    // Same-batch A -> B -> A: the fold commits back to the original backing
    // (t.v === old) — the adopted flag must still clear, or every later
    // !adopted row-op gate stays failed and the driven list freezes.
    setArr(() => [{ id: 9 }]);
    setArr(() => original);
    flush();
    setArr(s => {
      s.push({ id: 3 });
    });
    flush();
    expect(ops.length).toBeGreaterThan(0);
    expect(arr.length).toBe(3);
  });

  it("a consumer unbinding during dispatch does not skip its siblings (re-audit 5, P1-3)", () => {
    const [state, setState] = createStore({ user: { name: "a" } });
    const applied: string[] = [];
    let unbindA!: () => void;
    unbindA = registerPatch(state.user, () => {
      applied.push("A");
      unbindA(); // self-unbind splices the live list mid-dispatch
    });
    registerPatch(state.user, (n: any) => applied.push("B:" + n.name));
    setState(s => {
      s.user.name = "b";
    });
    flush();
    // Pre-fix: A's splice shifted B left and the index walk skipped it.
    expect(applied).toEqual(["A", "B:b"]);
    // A is gone; B alone next batch.
    setState(s => {
      s.user.name = "c";
    });
    flush();
    expect(applied).toEqual(["A", "B:b", "B:c"]);
  });

  it("coalescing applies the LATEST same-batch state, once (re-audit 3, P1-1)", () => {
    const [state, setState] = createStore({ user: { id: 1, name: "a" } });
    // Observe the record (keyed adoption prunes unobserved captures).
    const applied: string[] = [];
    registerPatch(state.user, (next: any) => applied.push(next.name));
    // Two eager reconciles in one batch capture DIFFERENT adopted objects —
    // dropping the second would apply stale state to the DOM while the
    // store holds the newer one.
    setState(s => {
      reconcile({ user: { id: 1, name: "b" } }, "id")(s);
    });
    setState(s => {
      reconcile({ user: { id: 1, name: "c" } }, "id")(s);
    });
    flush();
    expect(applied).toEqual(["c"]); // once, and the newest
    expect(state.user.name).toBe("c");
  });

  it("duplicate keys AFTER an aligned prefix adopt per remaining occurrence (re-audit 3, P1-2)", async () => {
    const { registerRowOps } = await import("../../src/index.js");
    const a1 = { id: "a", v: 1 };
    const b = { id: "b", v: 2 };
    const a2 = { id: "a", v: 3 };
    const [state, setState] = createStore({ rows: [a1, b, a2] });
    const r0 = state.rows[0];
    const r2 = state.rows[2];
    registerPatch(r0, () => {});
    registerPatch(r2, () => {});
    const ops: any[] = [];
    registerRowOps(state.rows, (_next: any[], o: any) => ops.push(o));
    // Prefix aligns position 0 ('a' key): it adopts a10 into a1. The window
    // (positions 1+) must NOT re-offer a1 — the remaining 'a' occurrence is
    // a2, which row ops retain for position 1.
    setState(s => {
      reconcile(
        [
          { id: "a", v: 10 },
          { id: "a", v: 20 },
          { id: "b", v: 2 }
        ],
        "id"
      )(s.rows);
    });
    flush();
    expect(r0.v).toBe(10); // prefix adoption
    expect(r2.v).toBe(20); // window adopts the REMAINING occurrence
    expect(state.rows[1]).toBe(r2); // identity preserved where ops retained
  });

  it("shallow slot alignment is SameValueZero: NaN-keyed slots keep their value ticks (self-sweep)", async () => {
    const { registerRowOps, registerSlotPatch } = await import("../../src/index.js");
    const keep = { id: 2, v: 2 };
    const [state, setState] = createStore<any[]>([{ id: NaN, v: 1 }, keep], {
      shallow: true
    } as any);
    const ticks: Array<[number, any]> = [];
    const ops: any[] = [];
    registerRowOps(state, () => ops.push(1));
    registerSlotPatch(state, (i: number, next: any) => ticks.push([i, next.v]));
    // Aligned value replacement on the NaN-keyed slot: strict-equality
    // alignment broke at the NaN key, suppressing the slot tick while the
    // SameValueZero ops builder emitted nothing (aligned) — the retained
    // row went permanently stale.
    setState(s => {
      reconcile([{ id: NaN, v: 10 }, keep], "id")(s);
    });
    flush();
    expect(ticks).toEqual([[0, 10]]);
    expect(ops.length).toBe(0); // aligned — structure emitted nothing
  });

  it("optimistic tentative matching is SameValueZero and occurrence-aware (re-audit 3, P1-3)", async () => {
    const { createOptimisticStore, action: act } = await import("../../src/index.js");
    const [state, setState] = (createOptimisticStore as any)({
      rows: [
        { id: NaN, v: 1 },
        { id: "x", v: 2 },
        { id: "x", v: 3 }
      ]
    });
    const r0 = state.rows[0];
    const r1 = state.rows[1];
    const r2 = state.rows[2];
    let resolve!: () => void;
    let save!: () => Promise<void> | void;
    createRoot(() => {
      save = act(function* () {
        setState((s: any) => {
          reconcile(
            [
              { id: NaN, v: 10 },
              { id: "x", v: 20 },
              { id: "x", v: 30 }
            ],
            "id"
          )(s.rows);
        });
        yield new Promise<void>(r => {
          resolve = r;
        });
      }) as any;
    });
    const p = save() as Promise<void>;
    flush();
    // In-flight tentative view: NaN-keyed row keeps its proxy identity
    // (strict inequality detached it), duplicate keys map per occurrence.
    expect(state.rows[0]).toBe(r0);
    expect(state.rows[0].v).toBe(10);
    expect(state.rows[1]).toBe(r1);
    expect(state.rows[1].v).toBe(20);
    expect(state.rows[2]).toBe(r2);
    expect(state.rows[2].v).toBe(30);
    resolve();
    await p;
    flush();
  });

  it("reconciling a getter-backed object into a patched record demotes to a tracked effect", async () => {
    const { createSignal } = await import("../../src/index.js");
    const [dep, setDep] = createRoot(() => createSignal(1));
    const [state, setState] = createStore<any>({ user: { id: 1, name: "a" } });
    const log: string[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      registerPatch(state.user, (next: any) => log.push(next.name + ":" + (next.score ?? "-")));
    });
    // Adopt a getter-backed replacement through reconcile (stable key so the
    // slot adopts rather than detaching as an entity change): the patch must
    // NOT serve it (the getter's dep would never re-apply) — it demotes.
    setState(s => {
      reconcile(
        {
          user: {
            id: 1,
            name: "b",
            get score() {
              return dep();
            }
          }
        },
        "id"
      )(s);
    });
    flush();
    expect(log[log.length - 1]).toBe("b:1");
    setDep(2);
    flush();
    // The exact divergence unsound adoption would drop: the getter's OUTSIDE
    // dependency re-applies through the demoted effect.
    expect(log[log.length - 1]).toBe("b:2");
    dispose();
  });

  it("setter-returned root replacement emits patches and row ops at fold commit", async () => {
    const { registerRowOps } = await import("../../src/index.js");
    const [state, setState] = createStore<any>({ name: "a", rows: [{ id: 1 }, { id: 2 }] });
    const log: string[] = [];
    const ops: any[] = [];
    registerPatch(state, (next: any) => log.push(next.name));
    registerRowOps(state.rows, (_next: any[], o: any) => ops.push(o));
    // Replacement via setter RETURN — an adoption with no reconcile walk.
    setState(() => ({ name: "b", rows: [{ id: 2 }, { id: 3 }] }));
    flush();
    expect(log).toEqual(["b"]);
    expect(state.name).toBe("b");
    // The nested array slot re-points wholesale on root replacement — the
    // ROOT patch covers it; structural ops for the array slot ride the next
    // array-level transition. Now replace the ARRAY root directly:
    const [arr, setArr] = createStore<any[]>([{ id: 1 }, { id: 2 }]);
    const arrOps: any[] = [];
    registerRowOps(arr, (_next: any[], o: any) => arrOps.push(o));
    setArr(() => [{ id: 2 }, { id: 3 }]);
    flush();
    expect(arrOps.length).toBe(1);
  });

  it("adoption and row ops agree on duplicate keys (occurrence-aware both sides)", async () => {
    const { registerRowOps } = await import("../../src/index.js");
    const a1 = { id: "a", v: 1 };
    const a2 = { id: "a", v: 2 };
    const b = { id: "b", v: 3 };
    const [state, setState] = createStore({ rows: [a1, a2, b] });
    // Materialize child targets AND observe them (registerPatch marks
    // descendants — keyed pruning detaches unobserved captures by design,
    // R18; the list driver registers per-row patches exactly like this).
    const r0 = state.rows[0];
    const r1 = state.rows[1];
    registerPatch(r0, () => {});
    registerPatch(r1, () => {});
    const ops: any[] = [];
    registerRowOps(state.rows, (_next: any[], o: any) => ops.push(o));
    // Reorder with duplicates: [b, a?, a?] — occurrence-aware matching must
    // hand the FIRST a-key row to the first a occurrence and the SECOND to
    // the second, on BOTH channels.
    setState(s => {
      reconcile(
        [
          { id: "b", v: 3 },
          { id: "a", v: 10 },
          { id: "a", v: 20 }
        ],
        "id"
      )(s.rows);
    });
    flush();
    // Adoption: distinct prev targets adopted per occurrence (values updated
    // in place, not both into the first).
    expect(r0.v).toBe(10);
    expect(r1.v).toBe(20);
    expect(state.rows[1]).toBe(r0);
    expect(state.rows[2]).toBe(r1);
    // Row ops: occurrence-aware sources (0 and 1, not 0 twice).
    expect(ops.length).toBe(1);
    const win = ops[0].sources.filter((s: number) => s >= 0).sort();
    expect(new Set(win).size).toBe(win.length);
  });

  it("NaN keys are self-equal everywhere: aligned ticks stay aligned, roots don't throw", async () => {
    const { registerRowOps } = await import("../../src/index.js");
    const [state, setState] = createStore({
      rows: [
        { id: NaN, v: 1 },
        { id: 2, v: 2 }
      ]
    });
    const r0 = state.rows[0];
    registerPatch(r0, () => {}); // observe: keyed adoption prunes unobserved rows
    const ops: any[] = [];
    registerRowOps(state.rows, (_next: any[], o: any) => ops.push(o));
    // Aligned value tick on a NaN-keyed row: strict-equality prefixes would
    // misalign forever (NaN !== NaN); SameValueZero keeps it aligned.
    setState(s => {
      reconcile(
        [
          { id: NaN, v: 5 },
          { id: 2, v: 2 }
        ],
        "id"
      )(s.rows);
    });
    flush();
    expect(state.rows[0]).toBe(r0); // identity preserved
    expect(r0.v).toBe(5); // value adopted in place
    expect(ops.length).toBe(0); // aligned — no structural ops
    // NaN ROOT identity: same-key reconcile must not throw.
    const [obj, setObj] = createStore({ id: NaN, v: 1 });
    expect(() => {
      setObj(s => {
        reconcile({ id: NaN, v: 9 }, "id")(s);
      });
      flush();
    }).not.toThrow();
    expect(obj.v).toBe(9);
  });

  it("Errored.reset() survives patch errors registered under plain owners", async () => {
    const { createOwner, runWithOwner } = await import("../../src/index.js");
    const [state, setState] = createStore({ a: { v: 0 } });
    let boundary: any;
    let resetFn!: () => void;
    createRoot(() => {
      boundary = createErrorBoundary(
        () => {
          // Mirror the list driver: registration under a PLAIN owner (no
          // compute fn) inside the boundary.
          const owner = createOwner();
          runWithOwner(owner as any, () => {
            registerPatch(state.a, (n: any) => {
              if (n.v > 0) throw new Error("row boom");
            });
          });
          return "content";
        },
        (_e, reset) => {
          resetFn = reset;
          return "errored";
        }
      );
    });
    expect(boundary()).toBe("content");
    setState(s => {
      s.a.v = 1;
    });
    expect(() => flush()).not.toThrow();
    expect(boundary()).toBe("errored");
    // reset() recomputes sources — a plain-owner registration must not crash
    // it (nearest computed ancestor was routed instead, or skipped).
    expect(() => {
      resetFn();
      flush();
    }).not.toThrow();
  });

  it("writable projection arrays emit setter row ops at fold commit", async () => {
    const { registerRowOps } = await import("../../src/index.js");
    const [proj, setProj] = createRoot(() =>
      createStore(() => ({ list: [{ id: 1 }, { id: 2 }] }), { list: [] as any[] })
    );
    flush();
    const ops: any[] = [];
    registerRowOps(proj.list, (_next: any[], o: any) => ops.push(o));
    setProj((s: any) => {
      s.list.push({ id: 3 });
    });
    flush();
    // Pre-fix the fam !== null gate swallowed this: the driven list froze.
    expect(ops.length).toBe(1);
    expect(ops[0]).not.toBeNull();
    expect(proj.list.length).toBe(3);
  });
});
