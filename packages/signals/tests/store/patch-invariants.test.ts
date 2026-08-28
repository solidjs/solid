/**
 * Invariant harness (re-audit 7). These tests are written from the CHANNEL'S
 * CONTRACT, not from reported failure instances — each describe block states
 * an invariant and drives it across the axis products where past audits
 * found holes (registration mode × backing shape × lane × timing ×
 * consumer-list lifecycle). New emission paths and fixes must keep this file
 * green; a new audit finding here means the invariant statement itself was
 * wrong or missing, and the fix must extend the harness FIRST.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createRoot,
  createSignal,
  createStore,
  flush,
  reconcile,
  registerPatch,
  patchableRaw
} from "../../src/index.js";

describe("INVARIANT: a patch body never reads an accessor raw", () => {
  // Admission scans, adoption gates, and demotion must together guarantee
  // that any getter — own or inherited, present at registration or arriving
  // later through ANY adoption seam — is only ever evaluated tracked.

  it("adoption rescans even when a prior admission scan marked the record plain (sticky sc)", async () => {
    const { patchCountForTests } = await import("../../src/store/next/patch.js");
    const base = patchCountForTests();
    const [dep, setDep] = createRoot(() => createSignal(1));
    const [state, setState] = createStore<any>({ user: { name: "a", score: 0 } });
    // A driver-style admission probe runs the one-time scan on the PLAIN
    // backing — the sticky flag this invariant must not trust after adoption.
    expect(patchableRaw(state.user)).toBeDefined();
    const log: string[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      // Hydration-style registration: no recorded key set (ak === null),
      // forcing the adoption gate onto its full-scan fallback.
      registerPatch(state.user, (next: any) => log.push(next.name + ":" + next.score));
    });
    setState(s => {
      reconcile(
        {
          name: "b",
          get score() {
            return dep();
          }
        },
        "name"
      )(s.user);
    });
    flush();
    // The getter-backed adoption must DEMOTE (count repaired), and the
    // getter's outside dependency must keep re-applying — the divergence
    // unsound admission silently drops.
    expect(patchCountForTests()).toBe(base);
    expect(log[log.length - 1]).toBe("b:1");
    setDep(2);
    flush();
    expect(log[log.length - 1]).toBe("b:2");
    dispose();
  });

  it("prototype accessors reject admission: class instances are wrappable but not patchable", () => {
    class Row {
      name = "a";
      get upper() {
        return this.name.toUpperCase();
      }
    }
    const [state] = createStore<any>({ row: new Row() });
    // Reading through the proxy works (wrappable); handing the raw backing
    // to a compiled body would evaluate `upper` untracked — admission must
    // refuse.
    expect(state.row.upper).toBe("A");
    expect(patchableRaw(state.row)).toBeUndefined();
  });
});

describe("INVARIANT: one application per channel per batch, regardless of lane interleaving", () => {
  it("normal → optimistic → normal emissions on ONE record: normal applies once, with final state", async () => {
    const { createOptimisticStore, action: act } = await import("../../src/index.js");
    const [state, setState] = (createOptimisticStore as any)({ user: { name: "n0", title: "t0" } });
    const applies: Array<[string, string]> = [];
    registerPatch(state.user, (next: any) => applies.push([next.name, next.title]));
    let resolve!: () => void;
    let save!: () => Promise<void> | void;
    createRoot(() => {
      save = act(function* () {
        setState((s: any) => {
          s.user.title = "opt";
        });
        yield new Promise<void>(r => {
          resolve = r;
        });
      }) as any;
    });
    // Interleave inside ONE flush window: the optimistic emission between
    // the two normal emissions must not destroy the normal channel's
    // coalescing stamp (shared-stamp regression: the second normal write
    // queued a DUPLICATE application).
    setState((s: any) => {
      s.user.name = "n1";
    });
    const p = save() as Promise<void>;
    setState((s: any) => {
      s.user.name = "n2";
    });
    flush();
    // Exactly two applications: the coalesced normal apply (final committed
    // name) and the optimistic apply (override visible). Not three.
    expect(applies.length).toBe(2);
    for (const [name] of applies) expect(name).toBe("n2");
    resolve();
    await p;
    flush();
    dispose: {
      // settle: title lands committed; no duplicate normal application
      // may have queued behind the stamp corruption.
      expect(state.user.title).toBe("opt");
    }
  });
});

describe("INVARIANT: queued applications reach exactly the consumers registered at emission (values resolve live, structure never admits late registrants)", () => {
  it("row ops emitted before a late registration never reach it (it initialized from current state)", async () => {
    const { registerRowOps } = await import("../../src/index.js");
    const [state, setState] = createStore<any>({ rows: [{ id: 1 }, { id: 2 }] });
    const early: any[] = [];
    const late: any[] = [];
    registerRowOps(state.rows, (_next: any[], ops: any) => early.push(ops));
    setState(s => {
      s.rows.splice(0, 1);
    });
    // Registered AFTER the structural emission, BEFORE the drain: a real
    // driver has already built rows from the post-splice state — replaying
    // the baseline-relative ops would corrupt its retention.
    registerRowOps(state.rows, (_next: any[], ops: any) => late.push(ops));
    flush();
    expect(early.length).toBe(1);
    expect(late.length).toBe(0);
  });

  it("a value patch held by a transition reaches a consumer registered AFTER emission (list resolves live at drain)", async () => {
    const [state, setState] = createStore({ user: { name: "a" } });
    const log: string[] = [];
    let resolve!: () => void;
    let save!: () => Promise<void> | void;
    let unbindOld!: () => void;
    createRoot(() => {
      unbindOld = registerPatch(state.user, () => {});
      save = action(function* () {
        setState(s => {
          s.user.name = "b";
        });
        yield new Promise<void>(r => {
          resolve = r;
        });
      }) as any;
    });
    const p = save() as Promise<void>;
    flush();
    // Consumer list recreated while the entry is held: the old consumer
    // unbinds (list drops to null) and a NEW one registers (fresh array).
    unbindOld();
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      registerPatch(state.user, (next: any) => log.push(next.name));
    });
    resolve();
    await p;
    flush();
    // The commit's application must reach the live consumer — a stale
    // list reference captured at emission misses it.
    expect(log).toEqual(["b"]);
    dispose();
  });

  it("the same holds across a transition MERGE collision (both stashes queued the same channel)", async () => {
    const [state, setState] = createStore({ user: { name: "a" } });
    const log: string[] = [];
    let resolveA!: () => void;
    let resolveB!: () => void;
    let saveA!: () => Promise<void> | void;
    let saveB!: () => Promise<void> | void;
    let unbindOld!: () => void;
    createRoot(() => {
      unbindOld = registerPatch(state.user, () => {});
      saveA = action(function* () {
        setState(s => {
          s.user.name = "a1";
        });
        yield new Promise<void>(r => {
          resolveA = r;
        });
      }) as any;
      saveB = action(function* () {
        setState(s => {
          s.user.name = "b1";
        });
        yield new Promise<void>(r => {
          resolveB = r;
        });
      }) as any;
    });
    const pa = saveA() as Promise<void>;
    flush();
    const pb = saveB() as Promise<void>;
    flush();
    // Same-channel entries now sit in BOTH transitions' stashes; the merge
    // coalesces them. Recreate the consumer list before commit.
    unbindOld();
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      registerPatch(state.user, (next: any) => log.push(next.name));
    });
    resolveA();
    resolveB();
    await pa;
    await pb;
    flush();
    expect(log).toEqual(["b1"]);
    dispose();
  });
});
