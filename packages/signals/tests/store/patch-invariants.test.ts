/**
 * Invariant harness (re-audit 7). These tests are written from the CHANNEL'S
 * CONTRACT, not from reported failure instances — each describe block states
 * an invariant and drives it across the axis products where past audits
 * found holes (registration mode × backing shape × lane × timing ×
 * consumer-list lifecycle). New emission paths and fixes must keep this file
 * green; a new audit finding here means the invariant statement itself was
 * wrong or missing, and the fix must extend the harness FIRST.
 */
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import {
  action,
  createRoot,
  createSignal,
  createStore,
  flush,
  reconcile,
  registerPatch,
  patchableRaw,
  untrack as untrackRead
} from "../../src/index.js";

// Getter demotions warn by design (dev notice); the assertions here are the
// demotion SEMANTICS — mute the expected console noise so reused workers
// don't leak counts into unrelated suites' global-console assertions.
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterAll(() => {
  warnSpy.mockRestore();
});

describe("INVARIANT: a patch body never reads an accessor raw", () => {
  // Admission scans, adoption gates, and demotion must together guarantee
  // that any getter — own or inherited, present at registration or arriving
  // later through ANY adoption seam — is only ever evaluated tracked.

  it("adoption rescans even when a prior admission scan marked the record plain (sticky sc)", async () => {
    const { patchCountForTests } = await import("../../src/store/next/patch.js");
    const base = patchCountForTests();
    const [dep, setDep] = createRoot(() => createSignal(1));
    const [state, setState] = createStore<any>({ user: { id: 1, name: "a", score: 0 } });
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
          id: 1,
          name: "b",
          get score() {
            return dep();
          }
        },
        "id"
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

describe("INVARIANT: patch applications mirror effect runs (parity oracle), regardless of lane interleaving", () => {
  it("normal → optimistic → normal emissions on ONE record apply like an equivalent effect", async () => {
    const { createOptimisticStore, action: act, createEffect } = await import("../../src/index.js");
    const [state, setState] = (createOptimisticStore as any)({ user: { name: "n0", title: "t0" } });
    const applies: string[] = [];
    const effectLog: string[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      // THE ORACLE: patch semantics are DEFINED as effect semantics with a
      // different dispatcher — whatever sequence of states this effect
      // observes is what the patch channel must apply, exactly once each.
      createEffect(
        () => state.user.name + "/" + state.user.title,
        (v: string) => {
          effectLog.push(v);
        }
      );
      registerPatch(state.user, (next: any) => applies.push(next.name + "/" + next.title));
    });
    flush();
    effectLog.length = 0;
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
    // the two normal emissions must not corrupt the normal channel's
    // coalescing stamp (shared-stamp regression: a duplicate normal
    // application queued behind the clobber).
    setState((s: any) => {
      s.user.name = "n1";
    });
    const p = save() as Promise<void>;
    setState((s: any) => {
      s.user.name = "n2";
    });
    flush();
    const inFlight = applies.slice();
    // SETTLE BEFORE ASSERTING: an abandoned in-flight action holds every
    // later write in this FILE hostage (transition state is global).
    resolve();
    await p;
    flush();
    // In-flight window: patch applies mirror the effect's observations
    // (same states, same count — no duplicates from stamp corruption).
    expect(inFlight).toEqual(effectLog.slice(0, inFlight.length));
    // Settled: identical sequences (count AND values). What the final
    // state IS — reverts, write attribution to in-flight lanes — is store
    // semantics owned by other suites; the channel's whole contract is
    // "apply exactly what an effect would observe, exactly as often".
    expect(applies).toEqual(effectLog);
    expect(applies[applies.length - 1]).toBe(state.user.name + "/" + state.user.title);
    dispose();
  });
});

describe("INVARIANT: optimistic applies honor accessor safety and late mounts (round 9)", () => {
  it("an optimistic replacement carrying a nested getter demotes instead of reading it raw", async () => {
    const { createOptimisticStore, action: act } = await import("../../src/index.js");
    const [dep, setDep] = createRoot(() => createSignal("g0"));
    const [state, setState] = (createOptimisticStore as any)({
      row: { id: 1, meta: { label: "m0" } }
    });
    const log: string[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      registerPatch(state.row, (n: any) => log.push(String(n.meta?.label)), ["meta.label"]);
    });
    let resolve!: () => void;
    let save!: () => Promise<void> | void;
    createRoot(() => {
      save = act(function* () {
        setState((s: any) => {
          reconcile(
            {
              id: 1,
              meta: {
                get label() {
                  return dep();
                }
              }
            },
            "id"
          )(s.row);
        });
        yield new Promise<void>(r => {
          resolve = r;
        });
      }) as any;
    });
    const p = save() as Promise<void>;
    flush();
    const inFlight = log[log.length - 1];
    setDep("g1");
    flush();
    const afterDep = log[log.length - 1];
    // SETTLE BEFORE ASSERTING (abandoned transactions strand the file).
    resolve();
    await p;
    flush();
    // The getter's outside dependency must keep applying while the
    // tentative view was live — an untracked raw read renders once and
    // goes silently stale.
    expect(inFlight).toBe("g0");
    expect(afterDep).toBe("g1");
    dispose();
  });
});

describe("INVARIANT: optimistic visibility covers the whole read envelope, ancestors included", () => {
  it("a targeted child reconcile inside an action re-applies ANCESTOR patches in flight", async () => {
    const { createOptimisticStore, action: act } = await import("../../src/index.js");
    const [state, setState] = (createOptimisticStore as any)({
      row: { id: 1, meta: { label: "m0" } }
    });
    const log: string[] = [];
    registerPatch(state.row, (next: any) => log.push(next.meta?.label ?? "?"), ["meta.label"]);
    let resolve!: () => void;
    let save!: () => Promise<void> | void;
    createRoot(() => {
      save = act(function* () {
        setState((s: any) => {
          reconcile({ label: "opt" }, "id")(s.row.meta);
        });
        yield new Promise<void>(r => {
          resolve = r;
        });
      }) as any;
    });
    const p = save() as Promise<void>;
    flush();
    const inFlight = log[log.length - 1];
    resolve();
    await p;
    flush();
    // In-flight visibility is what optimism MEANS: the ancestor's compiled
    // body reads through the child — it must re-apply at the lane drain,
    // not at settle; the settle then re-applies committed truth (revert).
    expect(inFlight).toBe("opt");
    expect(log[log.length - 1]).toBe("m0");
  });
});

describe("INVARIANT: a consumer is never left stale by the skip rule (round 9)", () => {
  it("a consumer mounting mid-transaction reads the HELD view and receives the commit", async () => {
    const { patchableRaw } = await import("../../src/index.js");
    const [state, setState] = createStore<any>({ user: { id: 1, name: "a" } });
    const log: string[] = [];
    registerPatch(state.user, () => {});
    let resolve!: () => void;
    let save!: () => Promise<void> | void;
    createRoot(() => {
      save = action(function* () {
        setState(s => {
          reconcile({ id: 1, name: "b" }, "id")(s.user);
        });
        yield new Promise<void>(r => {
          resolve = r;
        });
      }) as any;
    });
    const p = save() as Promise<void>;
    flush();
    // Driver-style mount MID-TRANSACTION: whatever visibility rule the
    // store applies (held masks for family adoptions, speculative swaps
    // for eager ones), the mount's initial read must MATCH what an
    // untracked proxy reader sees at the same moment — and the commit must
    // reach it if it read the pre-commit view.
    const visible = untrackRead(() => state.user.name);
    const raw = patchableRaw(state.user) as any;
    log.push("init:" + raw.name);
    registerPatch(state.user, (n: any) => log.push("apply:" + n.name));
    expect(log[0]).toBe("init:" + visible);
    resolve();
    await p;
    flush();
    expect(state.user.name).toBe("b");
    const last = log[log.length - 1];
    // Either the mount read "b" already (skip fine) or the commit applied.
    expect(log[0] === "init:b" || last === "apply:b").toBe(true);
  });

  it("an ambient eager reconcile self-corrects: pre-flush mounts read the adopted state", async () => {
    const { patchableRaw } = await import("../../src/index.js");
    const [state, setState] = createStore<any>({ user: { id: 1, name: "a" } });
    registerPatch(state.user, () => {});
    setState(s => {
      reconcile({ id: 1, name: "b" }, "id")(s.user);
    });
    // Eager adoption swapped the committed backing at walk time — a mount
    // here reads "b" already; the queued entry may skip it safely.
    const raw = patchableRaw(state.user) as any;
    expect(raw.name).toBe("b");
    const log: string[] = [];
    registerPatch(state.user, (n: any) => log.push(n.name));
    flush();
    // Functional next event regardless of whether this flush skipped it.
    setState(s => {
      s.user.name = "c";
    });
    flush();
    expect(log[log.length - 1]).toBe("c");
  });

  it("admission rejects manifested paths crossing FUNCTION intermediates (accessor carriers)", async () => {
    const { patchableRaw } = await import("../../src/index.js");
    const [dep] = createRoot(() => createSignal("f0"));
    const format: any = () => {};
    Object.defineProperty(format, "label", {
      get() {
        return dep();
      },
      enumerable: true,
      configurable: true
    });
    const [state] = createStore<any>({ row: { id: 1, format } });
    expect(patchableRaw(state.row, ["format.label"])).toBeUndefined();
  });
});

describe("INVARIANT: one forced ancestor application per flush (effect parity)", () => {
  it("multiple nested writes in one batch coalesce their ancestor bubbles", () => {
    const [state, setState] = createStore<any>({
      row: { id: 1, q0: { elapsed: "a0" }, q1: { elapsed: "b0" } }
    });
    let applies = 0;
    registerPatch(
      state.row,
      () => {
        applies++;
      },
      ["q0.elapsed", "q1.elapsed"]
    );
    setState(s => {
      s.row.q0.elapsed = "a1";
      s.row.q1.elapsed = "b1";
    });
    flush();
    // An effect reading both chains runs ONCE for the batch; so does the
    // forced ancestor re-apply.
    expect(applies).toBe(1);
    // Next batch applies again (stamp cleared at drain).
    setState(s => {
      s.row.q0.elapsed = "a2";
    });
    flush();
    expect(applies).toBe(2);
  });

  it("an UNCHANGED reconcile (same reference, no divergence) forces nothing", () => {
    const [state, setState] = createStore<any>({
      row: { id: 1, meta: { label: "m" } }
    });
    let applies = 0;
    registerPatch(
      state.row,
      () => {
        applies++;
      },
      ["meta.label"]
    );
    const sameMeta = { label: "m" };
    setState(s => {
      reconcile(sameMeta, "id")(s.row.meta);
    });
    flush();
    const after = applies;
    // Reconciling the CHILD with its identical adopted reference again: an
    // effect reading through the ancestor would not re-run; neither may
    // the ancestor bubble force a re-apply.
    setState(s => {
      reconcile(sameMeta, "id")(s.row.meta);
    });
    flush();
    expect(applies).toBe(after);
  });

  it("forced settle twins survive lane drains, applying once at settle (effect parity)", async () => {
    const { createOptimisticStore, action: act, createEffect } = await import("../../src/index.js");
    const [state, setState] = (createOptimisticStore as any)({
      row: { id: 1, meta: { label: "m0" } }
    });
    const effectLog: string[] = [];
    const applies: string[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      createEffect(
        () => state.row.meta.label,
        (v: string) => {
          effectLog.push(v);
        }
      );
      registerPatch(state.row, (n: any) => applies.push(n.meta?.label ?? "?"), ["meta.label"]);
    });
    flush();
    effectLog.length = 0;
    applies.length = 0;
    let r1!: () => void;
    let r2!: () => void;
    let save!: () => Promise<void> | void;
    createRoot(() => {
      save = act(function* () {
        setState((s: any) => {
          reconcile({ label: "opt1" }, "id")(s.row.meta);
        });
        yield new Promise<void>(r => {
          r1 = r;
        });
        // Second tentative walk with its own lane window: the first lane
        // drain cleared the LANE stamp only — a cleared SETTLE stamp here
        // would stage a duplicate settle twin.
        setState((s: any) => {
          reconcile({ label: "opt2" }, "id")(s.row.meta);
        });
        yield new Promise<void>(r => {
          r2 = r;
        });
      }) as any;
    });
    const p = save() as Promise<void>;
    flush(); // lane window 1: opt1 visible
    r1();
    await Promise.resolve();
    flush(); // lane window 2: opt2 visible
    r2();
    await p;
    flush(); // settle: revert to committed truth, ONCE
    expect(applies).toEqual(effectLog);
    dispose();
  });
});

describe("INVARIANT: queued applications reach exactly the consumers registered at emission (values resolve live, structure never admits late registrants)", () => {
  it("structural ops never reach a consumer registered between emission and dispatch", async () => {
    const { registerRowOps } = await import("../../src/index.js");
    const [state, setState] = createStore<any>({ rows: [{ id: 1 }, { id: 2 }] });
    const early: any[] = [];
    const late: any[] = [];
    // Pre-flush registrations share the emission's baseline (committed
    // state) and DO receive ops; the unsound window is registration DURING
    // the flush, after the fold emitted — a real driver registering there
    // (a row build inside another consumer's dispatch, a boundary remount)
    // initialized from the post-write state, and replaying baseline-
    // relative ops against it corrupts retention.
    let registeredLate = false;
    registerRowOps(state.rows, (_next: any[], ops: any) => {
      early.push(ops);
      if (!registeredLate) {
        registeredLate = true;
        registerRowOps(state.rows, (_n: any[], o: any) => late.push(o));
      }
    });
    setState(s => {
      s.rows.splice(0, 1);
    });
    flush();
    expect(early.length).toBe(1);
    expect(late.length).toBe(0);
    // The late consumer participates in the NEXT event normally.
    setState(s => {
      s.rows.splice(0, 1);
    });
    flush();
    expect(early.length).toBe(2);
    expect(late.length).toBe(1);
  });

  it("a value entry never re-applies to a consumer that initialized FROM its state (mid-flush mount)", async () => {
    const { registerRowOps } = await import("../../src/index.js");
    const [state, setState] = createStore<any>({ rows: [{ id: 1, label: "L1" }] });
    const spy: string[] = [];
    let mounted = false;
    // A pre-existing consumer keeps the record's channel live so the value
    // write actually queues an entry.
    registerPatch(state.rows[0], () => {});
    // A structural consumer that MOUNTS a value consumer during its own
    // dispatch — the driver's row build, exactly: the new consumer's initial
    // force-apply reads current (post-write) state.
    registerRowOps(state.rows, () => {
      if (!mounted) {
        mounted = true;
        registerPatch(state.rows[0], (n: any) => spy.push(n.label));
      }
    });
    // ONE flush: structural change queues row ops FIRST, then the value
    // write queues the record's entry — the drain mounts the consumer, then
    // must NOT hand it the value entry (it initialized from that state; a
    // re-apply is an observable duplicate setter call).
    setState(s => {
      s.rows.push({ id: 2, label: "L2" });
      s.rows[0].label = "X1";
    });
    flush();
    expect(spy).toEqual([]);
    // Functional from the NEXT event on.
    setState(s => {
      s.rows[0].label = "Y1";
    });
    flush();
    expect(spy).toEqual(["Y1"]);
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
    const { createEffect } = await import("../../src/index.js");
    const [state, setState] = createStore({ user: { name: "a" } });
    const log: string[] = [];
    const effectLog: string[] = [];
    let resolveA!: () => void;
    let resolveB!: () => void;
    let saveA!: () => Promise<void> | void;
    let saveB!: () => Promise<void> | void;
    let unbindOld!: () => void;
    createRoot(() => {
      // ORACLE: the patch channel applies exactly when (and with what) an
      // effect on the same record runs — including across the queue passes
      // two independently-settling transitions produce.
      createEffect(
        () => state.user.name,
        (v: string) => {
          effectLog.push(v);
        }
      );
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
    flush();
    effectLog.length = 0;
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
    // The recreated consumer received the merged commit — with exactly the
    // application sequence the effect observed (missed commit = [], stamp
    // corruption / uncoalesced releases = more applies than effect runs).
    expect(log).toEqual(effectLog);
    expect(log[log.length - 1]).toBe("b1");
    dispose();
  });
});
