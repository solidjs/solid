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
    const { createOptimisticStore, action: act, createEffect } = await import("../../src/index.js");
    const [dep, setDep] = createRoot(() => createSignal("g0"));
    const [state, setState] = (createOptimisticStore as any)({
      row: { id: 1, meta: { label: "m0" } }
    });
    const log: string[] = [];
    const effectLog: string[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      // ORACLE: an equivalent effect on the same read.
      createEffect(
        () => String((state.row.meta as any)?.label),
        (v: string) => {
          effectLog.push(v);
        }
      );
      registerPatch(state.row, (n: any) => log.push(String(n.meta?.label)), ["meta.label"]);
    });
    flush();
    effectLog.length = 0;
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
    // The getter evaluated TRACKED (demotion engaged): the tentative view
    // rendered its live value in flight — an untracked raw read would
    // never even show g0 through the demoted body. EFFECT PARITY bounds
    // everything else (stash timing, settle ordering): the demoted body IS
    // an effect now, so it must land wherever the oracle lands.
    expect(inFlight).toBe("g0");
    expect(afterDep).toBe("g0");
    expect(log[log.length - 1]).toBe(effectLog[effectLog.length - 1]);
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
    //
    // Round 10.13 refinement: late consumers still never see the
    // baseline-relative OPS — pre-drain registrants receive the RESYNC
    // form (ops null, live rows). Structural-audit refinement: the window
    // is FIXED — a consumer registered DURING the drain (from another
    // consumer's dispatch, like a driver row build) initialized from
    // current state and receives nothing until the next event.
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
    expect(late.length).toBe(0); // mid-drain registrant: outside the window
    // The late consumer participates in the NEXT event normally (real ops).
    setState(s => {
      s.rows.splice(0, 1);
    });
    flush();
    expect(early.length).toBe(2);
    expect(late.length).toBe(1);
    expect(late[0]).not.toBe(null);
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
    // COMPILED-SHAPE spy (compare-gated writes + initial force apply, like
    // real driver mounts): the invariant is OBSERVABLE — no stale value
    // ever writes, and no value writes twice. Node delivery may dispatch
    // the fresh consumer with CURRENT state; the compares make that a
    // no-op, exactly like an effect's initial run.
    let sp: string | undefined;
    const applyRow = (n: any, p: any, f?: boolean) => {
      if (f || n.label !== (p?.label ?? sp)) {
        sp = n.label;
        spy.push(n.label);
      }
    };
    registerRowOps(state.rows, () => {
      if (!mounted) {
        mounted = true;
        applyRow(state.rows[0], undefined, true); // driver initial apply
        registerPatch(state.rows[0], applyRow, ["label"]);
      }
    });
    setState(s => {
      s.rows.push({ id: 2, label: "L2" });
      s.rows[0].label = "X1";
    });
    flush();
    // Exactly ONE observable write of X1 (the mount's initial apply) — a
    // stale or duplicate delivery would push a second entry.
    expect(spy).toEqual(["X1"]);
    setState(s => {
      s.rows[0].label = "Y1";
    });
    flush();
    expect(spy).toEqual(["X1", "Y1"]);
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

describe("INVARIANT: every visibility transition reaches every registered ancestor (round 10)", () => {
  // The proxy and the patch channel are two readers of ONE visibility
  // stream. Any seam that changes what the proxy answers for a nested path
  // must deliver to ancestor channels whose compiled bodies read into it —
  // regardless of whether the WRITTEN target has consumers of its own.

  it("post-await projection landing on a channel-less child delivers to the patched ancestor", async () => {
    const { createProjection } = await import("../../src/index.js");
    const tick = (ms: number) => new Promise(r => setTimeout(r, ms));
    let proj!: any;
    let disposeRoot!: () => void;
    const log: string[] = [];
    createRoot(d => {
      disposeRoot = d;
      proj = createProjection<any>(
        async function* (state: any) {
          yield; // settle pass 1 — the projection is readable at seed
          await tick(5);
          // Post-await authoritative write: write-override, immediate landing.
          state.row.meta.label = "landed";
          yield;
        },
        { row: { meta: { label: "seed" } } }
      );
    });
    flush();
    const { createEffect } = await import("../../src/index.js");
    const effectSeen: string[] = [];
    createRoot(() => {
      // A tracked subscriber pulls the generator (real templates always
      // have one); the patch consumer must observe the same landings.
      createEffect(
        () => proj.row.meta.label,
        (v: string) => {
          effectSeen.push(v);
        }
      );
      // The ancestor is patched; the written child (meta) never gets a channel.
      const row = untrackRead(() => proj.row);
      registerPatch(row, (next: any) => log.push(next.meta.label));
    });
    flush();
    await tick(20);
    flush();
    await tick(5);
    flush();
    expect(effectSeen[effectSeen.length - 1]).toBe("landed");
    // Proxy sees landed truth…
    expect(untrackRead(() => proj.row.meta.label)).toBe("landed");
    // …and so must the ancestor's patch consumer.
    expect(log[log.length - 1]).toBe("landed");
    disposeRoot();
  });

  it("ordinary nested optimistic write delivers in-flight to the patched ancestor", async () => {
    const { createOptimisticStore, action: act } = await import("../../src/index.js");
    const [state, setState] = (createOptimisticStore as any)({ row: { meta: { label: "saved" } } });
    const log: string[] = [];
    createRoot(() => {
      registerPatch(state.row, (next: any) => log.push(next.meta.label));
    });
    let resolve!: () => void;
    let save!: () => Promise<void> | void;
    createRoot(() => {
      save = act(function* () {
        setState((s: any) => {
          s.row.meta.label = "optimistic";
        });
        yield new Promise<void>(r => {
          resolve = r;
        });
      }) as any;
    });
    const p = save() as Promise<void>;
    flush();
    // The lane view answers "optimistic" for row.meta.label — the row's
    // patch consumer must see the same in-flight state.
    expect(untrackRead(() => state.row.meta.label)).toBe("optimistic");
    expect(log[log.length - 1]).toBe("optimistic");
    resolve();
    await p;
    flush();
  });
});

describe("INVARIANT: an ancestor's deep manifest is honored on bubbled deliveries (round 10.5)", () => {
  it("a child-subject adoption carrying a getter into an ancestor's read path demotes the ancestor", async () => {
    const [dep, setDep] = createRoot(() => createSignal("d1"));
    const [state, setState] = createStore<any>({ row: { meta: { id: 1, label: "x" } } });
    const log: string[] = [];
    createRoot(() => {
      // Ancestor consumer with a DEEP manifest — its body reads INTO meta.
      registerPatch(state.row, (next: any) => log.push(next.meta.label), ["meta.label"]);
    });
    // Child-subject reconcile adopts a getter-bearing object at meta. The
    // child's own seam probes the CHILD's keys; only the ancestor's
    // manifest knows meta.label is read — the bubbled delivery must probe
    // it and DEMOTE, so the getter evaluates tracked.
    setState((s: any) => {
      reconcile(
        {
          id: 1,
          get label() {
            return dep();
          }
        },
        "id"
      )(s.row.meta);
    });
    flush();
    expect(log[log.length - 1]).toBe("d1");
    // The demoted body is a live tracked effect: dependency changes flow.
    setDep("d2");
    flush();
    expect(log[log.length - 1]).toBe("d2");
  });
});

describe("INVARIANT: demotion fanout is per-entry isolated (round 10)", () => {
  it("a throwing demoted body neither blocks siblings nor loses them", async () => {
    const { resetErrorHalt } = await import("../../src/core/scheduler.js");
    const [state, setState] = createStore<any>({ user: { id: 1, name: "a" } });
    const log: string[] = [];
    let phase = "mount";
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      // Entry A: throws once demotion re-drives it post-accessor.
      registerPatch(state.user, (next: any) => {
        if (phase === "demoted") throw new Error("body A blew up");
        log.push("A:" + next.name);
      });
      // Entry B: healthy sibling.
      registerPatch(state.user, (next: any) => log.push("B:" + next.name));
    });
    phase = "demoted";
    // Accessor arrives through the trap — the whole channel demotes and
    // every entry re-drives as a tracked effect.
    setState((s: any) => {
      Object.defineProperty(s.user, "flair", {
        get() {
          return s.user.name + "!";
        },
        configurable: true,
        enumerable: true
      });
    });
    try {
      flush();
    } catch {
      /* A's unboundaried throw surfaces at flush — expected */
    }
    resetErrorHalt();
    const bCount = log.filter(l => l.startsWith("B:")).length;
    // B was re-driven despite A's throw…
    expect(bCount).toBeGreaterThan(0);
    // …and stays LIVE: a later write still updates it.
    setState((s: any) => {
      s.user.name = "later";
    });
    try {
      flush();
    } catch {
      /* A throws again as a live effect — isolation, not silence */
    }
    resetErrorHalt();
    expect(log).toContain("B:later");
    dispose();
  });
});

describe("INVARIANT: structure honors holds and reaches held-window registrants (round 10.13)", () => {
  it("a structural consumer under a held queue defers and resyncs at release", async () => {
    const { registerRowOps, reconcile, runWithOwner } = await import("../../src/index.js");
    const { createOwner } = await import("../../src/core/owner.js");
    const { GlobalQueue } = await import("../../src/core/scheduler.js");
    // Boundary machinery installs the held probe.
    await import("../../src/boundaries.js");
    expect(GlobalQueue._queueHeld).not.toBe(null);
    const heldQueue: any = {
      _disabled: { _value: true },
      _collapsed: { _value: true },
      _parent: null,
      pending: [] as Array<(type: number) => void>,
      enqueue(type: number, fn: (type: number) => void) {
        this.pending.push(fn);
      },
      run() {
        const fns = this.pending.splice(0);
        for (const fn of fns) fn(1);
      },
      addChild() {},
      removeChild() {},
      notify() {
        return true;
      }
    };
    const owner = createOwner() as any;
    owner._queue = heldQueue;
    const [state, setState] = createStore<any>({
      rows: [
        { id: "a", v: 1 },
        { id: "b", v: 2 }
      ]
    });
    const calls: any[] = [];
    runWithOwner(owner, () => {
      (registerRowOps as any)(state.rows, (rows: any[], ops: any) =>
        calls.push([rows.map((r: any) => r.id), ops === null])
      );
    });
    setState((s: any) => {
      (reconcile as any)(
        [
          { id: "b", v: 2 },
          { id: "a", v: 1 }
        ],
        "id"
      )(s.rows);
    });
    flush();
    // Held: nothing dispatched before the queue releases.
    expect(calls.length).toBe(0);
    heldQueue.run();
    // Released: the LIVE resync form (row ops are baseline-relative — the
    // original ops would be stale by release).
    expect(calls.length).toBe(1);
    expect(calls[0][1]).toBe(true);
    expect(calls[0][0]).toEqual(["b", "a"]);
  });

  it("a consumer registered during a held structural commit receives the settle resync", async () => {
    const { registerRowOps, reconcile, action: act } = await import("../../src/index.js");
    const [state, setState] = createStore<any>({
      rows: [
        { id: "a", v: 1 },
        { id: "b", v: 2 }
      ]
    });
    const early: any[] = [];
    createRoot(() => {
      (registerRowOps as any)(state.rows, (_r: any[], ops: any) => early.push(ops));
    });
    let resolve!: () => void;
    let save!: () => Promise<void> | void;
    createRoot(() => {
      save = act(function* () {
        setState((s: any) => {
          (reconcile as any)(
            [
              { id: "b", v: 2 },
              { id: "a", v: 1 }
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
    // The structural emission is HELD by the transaction; a consumer
    // registers during the hold (a list mounting mid-transition).
    const late: any[] = [];
    createRoot(() => {
      (registerRowOps as any)(state.rows, (rows: any[], ops: any) =>
        late.push([rows.map((r: any) => r.id), ops === null])
      );
    });
    resolve();
    await p;
    flush();
    // Fold audit 4 refinement: adoption commits EAGERLY — the held-window
    // registrant's init read already contained the reordered view, so it
    // is owed NOTHING at release (a delivery would replay ops over state
    // it already rendered — the parked-window corruption). It participates
    // in the NEXT event normally.
    expect(late.length).toBe(0);
    setState((s: any) => {
      reconcile([{ id: "a", v: 1 }], "id")(s.rows);
    });
    flush();
    expect(late.length).toBe(1);
    expect(late[late.length - 1][0]).toEqual(["a"]);
  });
});

describe("INVARIANT: demotion never silences ancestors (round 10.11)", () => {
  it("a fold on a previously-demoted child still bubbles to patched ancestors", async () => {
    const [state, setState] = createStore<any>({ row: { meta: { id: 1, label: "x" } } });
    const metaLog: string[] = [];
    createRoot(() => {
      registerPatch(state.row.meta, (n: any) => metaLog.push(n.label), ["label"]);
    });
    // Build the child's delivery machinery with a plain delivered write…
    setState((s: any) => {
      s.row.meta.label = "y";
    });
    flush();
    expect(metaLog[metaLog.length - 1]).toBe("y");
    // …then demote it with an accessor ON A DECLARED KEY (the manifest-
    // -scoped probe only sees declared keys — an off-envelope getter is
    // correctly ignored): consumers pulled, machinery persists (dn
    // survives churn by design), and every later fold probe fails.
    const [dep] = createRoot(() => createSignal("d1"));
    setState((s: any) => {
      Object.defineProperty(s.row.meta, "label", {
        get() {
          return dep();
        },
        configurable: true,
        enumerable: true
      });
    });
    flush();
    // An ancestor registers with a deep manifest INTO the child.
    const rowLog: string[] = [];
    createRoot(() => {
      registerPatch(state.row, (n: any) => rowLog.push(String(n.meta.id)), ["meta.id"]);
    });
    // A leaf fold on the accessor-bearing child hits the demote branch
    // with an ALREADY-EMPTY channel — it must still bubble, or the
    // ancestor freezes at its baseline forever.
    setState((s: any) => {
      s.row.meta.id = 2;
    });
    flush();
    expect(rowLog[rowLog.length - 1]).toBe("2");
  });
});

describe("INVARIANT: demotion envelopes read each step once and probe true keys (round 10.10)", () => {
  it("an unstable root getter is invoked once per tracked pass, not twice", async () => {
    const [dep, setDep] = createRoot(() => createSignal("d1"));
    const [state, setState] = createStore<any>({ row: { meta: { id: 1, label: "x" } } });
    const log: string[] = [];
    createRoot(() => {
      registerPatch(state.row, (n: any) => log.push(n.meta.label), ["meta.label"]);
    });
    let reads = 0;
    setState((s: any) => {
      Object.defineProperty(s.row, "meta", {
        get() {
          reads++;
          return { id: 1, label: dep() }; // unstable: fresh object per read
        },
        configurable: true,
        enumerable: true
      });
    });
    flush();
    const base = reads;
    setDep("d2");
    flush();
    expect(log[log.length - 1]).toBe("d2");
    // One envelope read (tracked pass) + one body read (commit) — the
    // double root read made unstable getters track one value and commit
    // another.
    expect(reads - base).toBe(2);
  });

  it("symbol keys in iterable manifests probe the symbol property, not its string form", async () => {
    const sym = Symbol("flag");
    const [dep, setDep] = createRoot(() => createSignal("d1"));
    const [state, setState] = createStore<any>({ box: { [sym]: "s1", other: 0 } });
    const log: string[] = [];
    createRoot(() => {
      registerPatch(state.box, (n: any) => log.push(n[sym]), new Set<PropertyKey>([sym]));
    });
    // A getter arriving ON THE SYMBOL KEY demotes; the re-driven envelope
    // must track the symbol itself — the stringified form read a
    // nonexistent "Symbol(flag)" property, so the getter's dependency
    // never subscribed and later changes went stale.
    setState((s: any) => {
      Object.defineProperty(s.box, sym, {
        get() {
          return dep();
        },
        configurable: true,
        enumerable: true
      });
    });
    flush();
    expect(log[log.length - 1]).toBe("d1");
    setDep("d2");
    flush();
    expect(log[log.length - 1]).toBe("d2");
  });
});

describe("INVARIANT: the full-scan poison lives exactly as long as its consumers (round 10.9)", () => {
  it("akAll releases with the last manifest-less consumer", async () => {
    const { $TARGET } = await import("../../src/store/store.js");
    const [state] = createStore<any>({ user: { name: "a" } });
    let u1!: () => void;
    let u2!: () => void;
    createRoot(() => {
      u1 = registerPatch(state.user, () => {}) as () => void; // manifest-less
      u2 = registerPatch(state.user, () => {}, ["name"]) as () => void; // compiled
    });
    const pc = (state.user as any)[$TARGET].pc;
    expect(pc.akAll).toBe(true);
    u1();
    // The compiled consumer gets manifest-narrow probes back.
    expect(pc.akAll).toBe(false);
    u2();
  });
});

describe("INVARIANT: channel fan-out stays diagnosable (attribution parity)", () => {
  it("mass registration and wide dispatch fire the graph-size diagnostics", async () => {
    const [state, setState] = createStore<any>({ cfg: { theme: "a" } });
    warnSpy.mockClear();
    const unbinds: (() => void)[] = [];
    createRoot(() => {
      for (let i = 0; i < 2000; i++) {
        unbinds.push(registerPatch(state.cfg, () => {}) as () => void);
      }
    });
    // Registration-side HUGE_FAN_OUT twin (patch consumers are invisible
    // to the graph's _subCount — the channel must witness its own shape).
    expect(warnSpy.mock.calls.some(c => String(c[0]).includes("[HUGE_FAN_OUT]"))).toBe(true);
    // Dispatch-side WIDE_WRITE twin: ENGINE policy (round 10.10) — the
    // same threshold option, memo field, and metadata as graph
    // wide-writes, so it only fires with attribution enabled.
    const { DEV } = await import("../../src/index.js");
    DEV!.attribution.enable({ log: false, hotRuns: false, hotTime: false, wideWrites: 250 });
    setState((s: any) => {
      s.cfg.theme = "b";
    });
    flush();
    expect(warnSpy.mock.calls.some(c => String(c[0]).includes("[WIDE_WRITE]"))).toBe(true);
    DEV!.attribution.disable();
    for (const u of unbinds) u();
  });
});

describe("INVARIANT: the demoted fallback effect lives and dies with its consumer (round 10.8)", () => {
  it("unbind after demotion disposes the live fallback effect", async () => {
    const [dep, setDep] = createRoot(() => createSignal("d1"));
    const [state, setState] = createStore<any>({ user: { name: "a" } });
    const log: string[] = [];
    let unbind!: () => void;
    createRoot(() => {
      unbind = registerPatch(state.user, (n: any) => log.push(n.flair ?? n.name)) as () => void;
    });
    setState((s: any) => {
      Object.defineProperty(s.user, "flair", {
        get() {
          return dep();
        },
        configurable: true,
        enumerable: true
      });
    });
    flush();
    const before = log.length;
    setDep("d2");
    flush();
    // The fallback is a LIVE tracked effect…
    expect(log.length).toBeGreaterThan(before);
    expect(log[log.length - 1]).toBe("d2");
    unbind();
    const after = log.length;
    setDep("d3");
    flush();
    // …and unbind DISPOSES it: no application, no surviving subscription.
    expect(log.length).toBe(after);
  });

  it("a compute-phase throw routes per-entry — sibling installation is never halted", async () => {
    const { resetErrorHalt } = await import("../../src/core/scheduler.js");
    const [state, setState] = createStore<any>({ user: { id: 1, name: "a" } });
    const log: string[] = [];
    let phase = "mount";
    createRoot(() => {
      // A throws ONLY in the tracked compute pass (force !== true) — the
      // path that previously escaped per-entry capture and halted through
      // the effect's own error machinery during creation/scheduling.
      registerPatch(state.user, (next: any, _p: any, force?: boolean) => {
        if (phase === "demoted" && force !== true) throw new Error("compute boom");
        log.push("A:" + next.name);
      });
      registerPatch(state.user, (next: any) => log.push("B:" + next.name));
    });
    phase = "demoted";
    setState((s: any) => {
      Object.defineProperty(s.user, "extra", {
        get() {
          return 1;
        },
        configurable: true,
        enumerable: true
      });
    });
    try {
      flush();
    } catch {
      /* deferred unboundaried halt — expected */
    }
    resetErrorHalt();
    expect(log.filter(l => l.startsWith("B:")).length).toBeGreaterThan(0);
    setState((s: any) => {
      s.user.name = "later";
    });
    try {
      flush();
    } catch {
      /* A's compute throws again — isolation, not silence */
    }
    resetErrorHalt();
    expect(log).toContain("B:later");
  });
});

describe("INVARIANT: the deferred-demotion latch cannot outlive its consumers (round 10)", () => {
  it("unbinding the last consumer clears the latch; a stale latch never demotes a later plain consumer", async () => {
    const { $TARGET } = await import("../../src/store/store.js");
    const [state, setState] = createStore<any>({ user: { name: "a" } });
    let unbind!: () => void;
    createRoot(() => {
      unbind = registerPatch(state.user, () => {}) as () => void;
    });
    const pc = (state.user as any)[$TARGET].pc;
    // Simulate the tentative gate marking the channel for its CURRENT
    // consumers (the getter-bearing optimistic view path).
    pc.dmq = true;
    // (1) The latch leaves WITH the consumers.
    unbind();
    expect(pc.dmq).toBe(false);
    // (2) A latch re-armed during the consumer-less window (any residue
    // path) cannot be inherited: a registration that STARTS a consumer
    // list opens a fresh generation.
    pc.dmq = true;
    const log: Array<[string, boolean | undefined]> = [];
    createRoot(() => {
      registerPatch(state.user, (next: any, _p: any, force?: boolean) =>
        log.push([next.name, force])
      );
    });
    expect(pc.dmq).toBe(false);
    setState((s: any) => {
      s.user.name = "updated";
    });
    flush();
    // A demoted channel would null pc.p and re-drive through effects; a
    // live patch delivers the plain update to a populated consumer list.
    expect(log.some(([v]) => v === "updated")).toBe(true);
    expect(pc.p).not.toBe(null);
    const { patchCountForTests } = await import("../../src/store/next/patch.js");
    expect(patchCountForTests()).toBeGreaterThan(0);
  });
});

describe("INVARIANT: structural resyncs honor holds, fix their window, and serve the VISIBLE view", () => {
  // The 10.13 late-registrant rule, refined by the structural audit: a
  // resync is owed ONLY to consumers whose initialization predates the
  // item's visibility commit — i.e. registrants inside a TRANSITION-HELD
  // window (ambient same-flush registrants initialized from post-commit
  // state and are owed nothing). The resync defers into held owner queues
  // like every other application, never admits mid-drain registrants, and
  // always serves the view an untracked reader sees at that moment.

  it("the window is FIXED at both edges: pre-flush registrants ride the fold's snapshot, mid-drain registrants get nothing", async () => {
    const { registerRowOps } = await import("../../src/index.js");
    const [state, setState] = createStore<any>({ rows: [{ id: 1 }, { id: 2 }] });
    const early: any[] = [];
    const late: any[] = [];
    const midDrain: any[] = [];
    createRoot(() => {
      registerRowOps(state.rows, (_n: any[], ops: any) => early.push(ops));
    });
    setState((s: any) => {
      s.rows.splice(0, 1);
    });
    // Between setState and flush: the plain-store emission happens at the
    // FOLD (flush time), so this consumer is IN the snapshot — it gets the
    // real ops, and they are baseline-correct for it (its init read
    // pre-dates the commit exactly like the early consumer's).
    createRoot(() => {
      registerRowOps(state.rows, (_n: any[], ops: any) => {
        late.push(ops);
        if (midDrain.length === 0 && late.length === 1) {
          // Registered FROM a dispatch callback: initialized from current
          // state mid-drain — the fixed window excludes it entirely.
          registerRowOps(state.rows, (_nn: any[], o: any) => midDrain.push(o));
        }
      });
    });
    flush();
    expect(early.length).toBe(1);
    expect(late.length).toBe(1);
    expect(late[0]).not.toBe(null); // in the fold snapshot: real, sound ops
    expect(midDrain.length).toBe(0); // outside the window
    // All participate in the next event normally.
    setState((s: any) => {
      s.rows.splice(0, 1);
    });
    flush();
    expect(early.length).toBe(2);
    expect(late.length).toBe(2);
    expect(midDrain.length).toBe(1);
  });

  it("a late registrant under a HELD owner queue defers into it instead of resyncing through the hold", async () => {
    const { registerRowOps, getOwner, action: act } = await import("../../src/index.js");
    const { GlobalQueue } = await import("../../src/core/scheduler.js");
    const [state, setState] = createStore<any>({ rows: [{ id: 1 }, { id: 2 }] });
    createRoot(() => {
      registerRowOps(state.rows, () => {});
    });
    const releases: Array<() => void> = [];
    const fakeQ: any = { enqueue: (_t: number, fn: () => void) => releases.push(fn) };
    const prevProbe = (GlobalQueue as any)._queueHeld;
    (GlobalQueue as any)._queueHeld = (q: any) => q === fakeQ || prevProbe?.(q) === true;
    try {
      let confirm!: () => void;
      const run = act(function* () {
        setState((s: any) => {
          s.rows.splice(0, 1);
        });
        yield new Promise<void>(resolve => {
          confirm = resolve;
        });
      })();
      flush();
      const held: any[] = [];
      // Held-window registrant whose OWNER QUEUE is itself collapsed.
      createRoot(() => {
        (getOwner() as any)._queue = fakeQ;
        registerRowOps(state.rows, (_n: any[], ops: any) => held.push(ops));
      });
      confirm();
      await run;
      flush();
      // The resync deferred INTO the collapsed queue — nothing ran through
      // the hold; the boundary's own release timing delivers it.
      expect(held.length).toBe(0);
      expect(releases.length).toBe(1);
      releases[0]!();
      expect(held).toEqual([null]);
    } finally {
      (GlobalQueue as any)._queueHeld = prevProbe;
    }
  });

  it("a held-release resync serves the visible optimistic view, not committed backing", async () => {
    const {
      createOptimisticStore,
      registerRowOps,
      getOwner,
      action: act
    } = await import("../../src/index.js");
    const { GlobalQueue } = await import("../../src/core/scheduler.js");
    const [items, setItems] = (createOptimisticStore as any)([{ id: 1 }] as any[]);
    const releases: Array<() => void> = [];
    const fakeQ: any = { enqueue: (_t: number, fn: () => void) => releases.push(fn) };
    const prevProbe = (GlobalQueue as any)._queueHeld;
    (GlobalQueue as any)._queueHeld = (q: any) => q === fakeQ || prevProbe?.(q) === true;
    try {
      const seen: any[][] = [];
      createRoot(() => {
        (getOwner() as any)._queue = fakeQ;
        registerRowOps(items, (rows: any[], _ops: any) =>
          seen.push(Array.from(rows, (r: any) => r.id))
        );
      });
      let confirm!: () => void;
      const run = act(function* () {
        setItems((draft: any[]) => {
          draft.push({ id: 2 });
        });
        yield new Promise<void>(resolve => {
          confirm = resolve;
        });
      })();
      flush();
      // The lane dispatch deferred into the held queue. Release it WHILE
      // the optimistic window is still open: the rebuild must read what an
      // untracked reader sees — the override view [1, 2] — never the
      // committed backing [1].
      expect(releases.length).toBe(1);
      releases[0]!();
      expect(seen.at(-1)).toEqual([1, 2]);
      confirm();
      await run;
      flush();
    } finally {
      (GlobalQueue as any)._queueHeld = prevProbe;
    }
  });

  it("a resync never emits a slot tick for a deleted slot", async () => {
    const { registerSlotPatchNext } = await import("../../src/store/next/patch.js");
    const { action: act } = await import("../../src/index.js");
    const [state, setState] = createStore<any>({ list: ["a", "b", "c"] });
    createRoot(() => {
      registerSlotPatchNext(state.list, () => {});
    });
    // EARLY consumer: registered before the write — its chain is behind the
    // stashed ticks and receives them at release, where the deleted-slot
    // gate must drop index 2.
    const ticks: Array<[number, any]> = [];
    createRoot(() => {
      registerSlotPatchNext(state.list, (i: number, v: any) => ticks.push([i, v]));
    });
    let confirm!: () => void;
    const run = act(function* () {
      setState((s: any) => {
        // Slot ticks emit from the RECONCILE walk (aligned value-replaced
        // slots): tick index 1 (survives) and index 2 (deleted right after
        // by the shrinking reconcile) — both stashed by the transition.
        reconcile(["a", "y", "x"], null)(s.list);
        reconcile(["a", "y"], null)(s.list);
      });
      yield new Promise<void>(resolve => {
        confirm = resolve;
      });
    })();
    flush();
    // Late-window registrant (fold audit 4): adoption is EAGER — its init
    // read already holds ["a","y"], so it is owed nothing at release.
    const late: Array<[number, any]> = [];
    createRoot(() => {
      registerSlotPatchNext(state.list, (i: number, v: any) => late.push([i, v]));
    });
    confirm();
    await run;
    flush();
    // NON-VACUOUS: the early consumer's surviving-slot tick MUST arrive.
    expect(ticks.some(([i, v]) => i === 1 && v === "y")).toBe(true);
    // The deleted slot's tick is invalid against the live 2-length list —
    // skipped, never delivered as (2, undefined). And the late registrant
    // received nothing (its read covered the stash).
    expect(ticks.every(([i]) => i < 2)).toBe(true);
    expect(late.length).toBe(0);
  });

  it("an aborted retainer's re-derivation keeps the survivor's rows in the driven list (fifth posture)", async () => {
    // Entangled retainers settle TOGETHER (fourth posture) — but an ABORTED
    // retainer dies alone: rederiveAtSettle wipes and replays the survivor.
    // Replay frames are suppressed (one-reckoning rule), so the settle
    // drain's resync is the LAST word — it must read the VISIBLE view
    // (survivor's re-armed overrides composed), never the bare committed
    // backing, or the survivor's row vanishes from the DOM until its own
    // settle. Classic-parity oracle rides alongside.
    const {
      createOptimisticStore,
      registerRowOps,
      createRenderEffect,
      action: act
    } = await import("../../src/index.js");
    const [items, setItems] = (createOptimisticStore as any)([{ id: 1 }] as any[]);
    const frames: number[][] = [];
    const classic: number[][] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      registerRowOps(items, (rows: any[], _ops: any) =>
        frames.push(Array.from(rows, (r: any) => r.id))
      );
      createRenderEffect(
        () => items.map((r: any) => r.id),
        (v: number[]) => {
          classic.push(v);
        }
      );
    });
    flush();
    let failA!: (e: Error) => void;
    let confirmB!: () => void;
    const runA = act(function* () {
      setItems((draft: any[]) => {
        draft.push({ id: 2 });
      });
      yield new Promise<void>((_r, reject) => {
        failA = reject;
      });
    })().catch(() => {});
    flush();
    const runB = act(function* () {
      setItems((draft: any[]) => {
        draft.push({ id: 3 });
      });
      yield new Promise<void>(resolve => {
        confirmB = resolve;
      });
    })();
    flush();
    expect(frames.at(-1)).toEqual([1, 2, 3]);

    // A ABORTS: it dies alone, B's edit survives the re-derivation — the
    // channel must land where classic lands, with B's row intact.
    failA(new Error("aborted"));
    await runA;
    flush();
    expect(frames.at(-1)).toEqual(classic.at(-1) as number[]);

    confirmB();
    await runB;
    flush();
    expect(frames.at(-1)).toEqual([1]);
    expect(classic.at(-1)).toEqual([1]);
    dispose();
  });

  it("back-to-back continuation landings keep the channel AT classic parity — never ahead of it", async () => {
    // Audit follow-up P1: with two landings arriving while the actions stay
    // open, the channel exposed the newest topology while classic effects
    // held the previous one until action settlement. Whatever the correct
    // visibility ruling is, the channel's contract is CLASSIC PARITY —
    // delivery for delivery, at every step.
    const {
      createOptimisticStore,
      registerRowOps,
      createRenderEffect,
      action: act
    } = await import("../../src/index.js");
    type Row = { id: number };
    let notify!: { promise: Promise<Row>; resolve: (row: Row) => void };
    const reset = () => {
      let resolve!: (row: Row) => void;
      const promise = new Promise<Row>(r => (resolve = r));
      notify = { promise, resolve };
    };
    reset();
    const confirm = (row: Row) => {
      const current = notify;
      reset();
      current.resolve(row);
    };
    const settle = async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      flush();
    };
    let items!: any;
    let setItems!: any;
    // Full-fidelity frames (id:pending pairs): the echo-mask ruling is about
    // VALUES (the replayed edit's value masks the landed echo until settle),
    // so topology-only frames hide the divergence.
    const view = (rows: any[]) => Array.from(rows, (r: any) => r.id + ":" + r.pending);
    const channel: string[][] = [];
    const classic: string[][] = [];
    const dispose = createRoot(dispose => {
      [items, setItems] = (createOptimisticStore as any)(async function* (store: Row[]) {
        yield [] as Row[];
        while (true) {
          const row = await notify.promise;
          yield;
          store.push(row);
        }
      }, [] as Row[]);
      registerRowOps(items, (rows: any[], _ops: any) => channel.push(view(rows)));
      createRenderEffect(
        () => view(items as any[]),
        (v: string[]) => {
          classic.push(v);
        }
      );
      return dispose;
    });
    flush();
    await settle();

    // Two retained adds on OPEN actions (blind — they outlive both landings).
    let doneA!: () => void;
    let doneB!: () => void;
    act(function* () {
      setItems((s: any[]) => {
        s.push({ id: 10, pending: true });
      });
      yield new Promise<void>(r => {
        doneA = r;
      });
    })();
    flush();
    act(function* () {
      setItems((s: any[]) => {
        s.push({ id: 11, pending: true });
      });
      yield new Promise<void>(r => {
        doneB = r;
      });
    })();
    flush();
    expect(classic.at(-1)).toEqual(["10:true", "11:true"]);
    expect(channel.at(-1)).toEqual(["10:true", "11:true"]);

    // TWO continuation landings BACK-TO-BACK, each ECHOING one retained add
    // (the d813a96f ruling: the echoed row takes the landed slot, the
    // replayed edit's VALUE masks it until settle). Actions stay open. The
    // channel must land WHERE CLASSIC LANDS at every observation point.
    confirm({ id: 10, pending: false } as any);
    await settle();
    await settle();
    expect(channel.at(-1)).toEqual(classic.at(-1) as string[]);

    confirm({ id: 11, pending: false } as any);
    await settle();
    await settle();
    expect(channel.at(-1)).toEqual(classic.at(-1) as string[]);

    doneA();
    doneB();
    await settle();
    await settle();
    expect(channel.at(-1)).toEqual(classic.at(-1) as string[]);
    expect(classic.at(-1)).toEqual(["10:false", "11:false"]);
    dispose();
  });

  it("a continuation landing delivers ONE coherent topology — never the landed base without replayed edits", async () => {
    const {
      createOptimisticStore,
      registerRowOps,
      until,
      action: act
    } = await import("../../src/index.js");
    type Row = { id: number };
    let notify!: { promise: Promise<Row>; resolve: (row: Row) => void };
    const reset = () => {
      let resolve!: (row: Row) => void;
      const promise = new Promise<Row>(r => (resolve = r));
      notify = { promise, resolve };
    };
    reset();
    const confirm = (row: Row) => {
      const current = notify;
      reset();
      current.resolve(row);
    };
    const settle = async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      flush();
    };
    let items!: any;
    let setItems!: any;
    const frames: number[][] = [];
    const dispose = createRoot(dispose => {
      [items, setItems] = (createOptimisticStore as any)(async function* (store: Row[]) {
        yield [] as Row[];
        while (true) {
          const row = await notify.promise;
          yield;
          store.push(row);
        }
      }, [] as Row[]);
      registerRowOps(items, (rows: any[], _ops: any) =>
        frames.push(Array.from(rows, (r: any) => r.id))
      );
      return dispose;
    });
    flush();
    await settle();

    const add = act(function* (row: Row) {
      setItems((store: Row[]) => {
        store.push(row);
      });
      yield until(() => items.some((x: any) => x.id === row.id));
    });
    const addA = add({ id: 0 });
    flush();
    const addB = add({ id: 1 });
    flush();
    expect(frames.at(-1)).toEqual([0, 1]);
    const watermark = frames.length;

    // A's confirmation: a CONTINUATION landing carrying A's row contradicts
    // the base — wipe, replay of B's still-open edit, resync. The driven
    // list must see ONE coherent [0, 1]: an intermediate [0] frame is the
    // DOM identity/focus loss (row B rebuilt for nothing).
    confirm({ id: 0 });
    await settle();
    await settle();
    for (const f of frames.slice(watermark)) expect(f).toEqual([0, 1]);

    confirm({ id: 1 });
    await settle();
    await Promise.all([addA, addB]);
    await settle();
    // …and NO stale pre-landing structural work replays at owner settle.
    for (const f of frames.slice(watermark)) expect(f).toEqual([0, 1]);
    dispose();
  });
});

describe("INVARIANT: structural channels under fold/holds — per-index slots, no double-applies, reveal coverage", () => {
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    flush();
  };

  it("held slot deliveries defer PER INDEX — later indexes are not collapsed away", async () => {
    const { getOwner } = await import("../../src/index.js");
    const { registerSlotPatchNext } = await import("../../src/store/next/patch.js");
    const { GlobalQueue } = await import("../../src/core/scheduler.js");
    const [state, setState] = createStore<any>({ list: ["a", "b", "c"] });
    const releases: Array<() => void> = [];
    const fakeQ: any = { enqueue: (_t: number, fn: () => void) => releases.push(fn) };
    const prevProbe = (GlobalQueue as any)._queueHeld;
    (GlobalQueue as any)._queueHeld = (q: any) => q === fakeQ || prevProbe?.(q) === true;
    try {
      const ticks: Array<[number, any]> = [];
      createRoot(() => {
        (getOwner() as any)._queue = fakeQ;
        registerSlotPatchNext(state.list, (i: number, v: any) => ticks.push([i, v]));
      });
      // Two aligned value-replaced slots in one batch: two slot items.
      setState((s: any) => {
        reconcile(["x", "y", "c"], null)(s.list);
      });
      flush();
      expect(ticks.length).toBe(0); // held
      // BOTH indexes must have deferred into the queue — a shared dedup
      // flag collapsing them leaves index 1 permanently stale.
      for (const r of releases.splice(0)) r();
      expect(ticks.some(([i, v]) => i === 0 && v === "x")).toBe(true);
      expect(ticks.some(([i, v]) => i === 1 && v === "y")).toBe(true);
    } finally {
      (GlobalQueue as any)._queueHeld = prevProbe;
    }
  });

  it("a late row consumer never receives a resync FOLLOWED by stale ops (no double-build)", async () => {
    const { registerRowOps } = await import("../../src/index.js");
    const [state, setState] = createStore<any>({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    createRoot(() => {
      registerRowOps(state.rows, () => {});
    });
    // Emission 1: reconcile walk emits its ops DURING the setter.
    setState((s: any) => {
      reconcile([{ id: 2 }, { id: 3 }], "id")(s.rows);
    });
    // Late consumer registers BETWEEN the two emissions.
    const events: Array<"resync" | "ops"> = [];
    createRoot(() => {
      registerRowOps(state.rows, (_n: any[], ops: any) =>
        events.push(ops === null ? "resync" : "ops")
      );
    });
    // Emission 2: setter fold emits at flush — the late consumer IS in this
    // snapshot (registered before the fold), with baseline-correct ops.
    setState((s: any) => {
      s.rows.splice(0, 1);
    });
    flush();
    // The consumer may get the resync (live view, includes emission 2's
    // effect) OR emission 2's ops — never resync THEN ops: the ops would
    // re-apply against the already-final rebuild, duplicating the row.
    const resyncAt = events.indexOf("resync");
    const opsAt = events.indexOf("ops");
    if (resyncAt !== -1 && opsAt !== -1) expect(opsAt).toBeLessThan(resyncAt);
    // And it participates normally afterwards.
    const mark = events.length;
    setState((s: any) => {
      s.rows.splice(0, 1);
    });
    flush();
    expect(events.length).toBe(mark + 1);
  });

  it("staged truth never mutates raw shallow rows before the reveal, and slots notify at it", async () => {
    const {
      createOptimisticStore,
      registerRowOps,
      action: act
    } = await import("../../src/index.js");
    const { registerSlotPatchNext } = await import("../../src/store/next/patch.js");
    // Shallow list: primitive rows — slot channel territory.
    const [items, setItems] = (createOptimisticStore as any)(["a", "b"] as any[]);
    const ticks: Array<[number, any]> = [];
    const rowsSeen: string[][] = [];
    createRoot(() => {
      registerSlotPatchNext(items, (i: number, v: any) => ticks.push([i, v]));
      registerRowOps(items, (rows: any[]) => rowsSeen.push(Array.from(rows, String)));
    });
    let confirm!: () => void;
    const run = act(function* () {
      setItems((draft: any[]) => {
        draft.push("c"); // retain optimism on the family
      });
      yield new Promise<void>(resolve => {
        confirm = resolve;
      });
    })();
    flush();
    // Landing while retained: STAGES. Slot 0's committed value must stay
    // "a" for every ordinary reader until the reveal.
    // Simulate the projection landing channel: authoritative write of fresh
    // truth (what a poll/refresh continuation does).
    const { storeSetterNext, runAuthoritative } = await import("../../src/store/next/store.js");
    runAuthoritative(() => {
      storeSetterNext(items, (draft: any[]) => {
        draft[0] = "A2";
      });
    });
    flush();
    const { snapshot } = await import("../../src/index.js");
    // Ordinary readers: still the optimistic view over OLD committed truth.
    expect((items as any)[0]).toBe("a");
    confirm();
    await run;
    await settle();
    // Reveal: slot 0 flips to A2 — the slot channel must be told.
    expect((items as any)[0]).toBe("A2");
    expect(ticks.some(([i, v]) => i === 0 && v === "A2")).toBe(true);
    void snapshot;
    void rowsSeen;
  });

  it("a consumer mounted INSIDE a writing transition never replays its stashed ops (bac stays bac)", async () => {
    // Fold audit 2, P1: the mid-transition mount reads the SPECULATIVE view
    // (boundary content renders from it) — its version baseline must cover
    // the stashed emissions, or the release replays ops it already saw:
    // store/classic end "bac", driven DOM ends "abc".
    const { registerRowOps, action: act } = await import("../../src/index.js");
    const [state, setState] = createStore<any>({
      rows: [{ id: "a" }, { id: "b" }, { id: "c" }]
    });
    createRoot(() => {
      registerRowOps(state.rows, () => {});
    });
    let confirm!: () => void;
    const run = act(function* () {
      setState((s: any) => {
        reconcile([{ id: "b" }, { id: "a" }, { id: "c" }], "id")(s.rows);
      });
      yield new Promise<void>(resolve => {
        confirm = resolve;
      });
    })();
    flush();
    // Mount DURING the transition window, reading the speculative view.
    const frames: string[][] = [];
    let lastOps: any = "none";
    createRoot(() => {
      registerRowOps(state.rows, (rows: any[], ops: any) => {
        frames.push(Array.from(rows, (r: any) => r.id));
        lastOps = ops;
      });
    });
    flush();
    confirm();
    await run;
    flush();
    // The release must NOT deliver the stashed reorder ops to this entry —
    // its baseline already contained "bac". Applying them re-reorders a
    // list that is already reordered.
    for (const f of frames) expect(f).toEqual(["b", "a", "c"]);
    void lastOps;
  });

  it("av init keys off the HOLDING QUEUE, not the execution-time transition flag (parked windows)", async () => {
    // Fold audit 3, P1: `activeTransition` is null in a PARKED action's
    // window while speculative state is still what held-boundary content
    // reads — the flag-based init handed those registrants a committed
    // baseline and replayed stashed ops over speculative DOM. The
    // discriminator is the registrant's owner queue HOLDING.
    const { registerRowOps, getOwner, action: act } = await import("../../src/index.js");
    const { $TARGET } = await import("../../src/store/store.js");
    const { GlobalQueue } = await import("../../src/core/scheduler.js");
    const [state, setState] = createStore<any>({ rows: [{ id: "a" }, { id: "b" }] });
    createRoot(() => {
      registerRowOps(state.rows, () => {});
    });
    let confirm!: () => void;
    const run = act(function* () {
      setState((s: any) => {
        reconcile([{ id: "b" }, { id: "a" }], "id")(s.rows);
      });
      yield new Promise<void>(resolve => {
        confirm = resolve;
      });
    })();
    flush(); // action is now PARKED: activeTransition is null here
    const pc = (state.rows as any)[$TARGET].pc;
    const fakeQ: any = { enqueue: () => {} };
    const prevProbe = (GlobalQueue as any)._queueHeld;
    (GlobalQueue as any)._queueHeld = (q: any) => q === fakeQ || prevProbe?.(q) === true;
    try {
      // Fold audit 4: adoption commits EAGERLY, so EVERY parked-window
      // mount — held boundary or ambient — has the walk's state in its
      // init read; both initialize at the full emitted version and neither
      // may replay the stash at release.
      createRoot(() => {
        (getOwner() as any)._queue = fakeQ;
        registerRowOps(state.rows, () => {});
      });
      const held = pc.ro[pc.ro.length - 1];
      expect(held.av).toBe(pc.sv);
      createRoot(() => {
        registerRowOps(state.rows, () => {});
      });
      const ambient = pc.ro[pc.ro.length - 1];
      expect(ambient.av).toBe(pc.sv);
      expect(pc.svv).toBe(pc.sv); // walk visibility IS emission visibility
    } finally {
      (GlobalQueue as any)._queueHeld = prevProbe;
    }
    confirm();
    await run;
    flush();
  });

  it("a NO-OP fold never suppresses the revert resync (rf only on proven emission)", async () => {
    // Fold audit 4, P1: rf was set before proving the reveal emitted —
    // an identity-aligned (no-op) staged fold marked the channel and the
    // settle loop skipped the ONLY resync the revert needed.
    const {
      createOptimisticStore,
      registerRowOps,
      action: act
    } = await import("../../src/index.js");
    const { storeSetterNext, runAuthoritative } = await import("../../src/store/next/store.js");
    const a = { id: 1 };
    const [items, setItems] = (createOptimisticStore as any)([a] as any[]);
    const frames: number[][] = [];
    createRoot(() => {
      registerRowOps(items, (rows: any[]) => frames.push(Array.from(rows, (r: any) => r.id)));
    });
    let confirm!: () => void;
    const run = act(function* () {
      setItems((d: any[]) => {
        d.push({ id: 2 });
      });
      yield new Promise<void>(r => {
        confirm = r;
      });
    })();
    flush();
    expect(frames.at(-1)).toEqual([1, 2]);
    // A staged landing that restates the SAME truth: identity-aligned,
    // emits nothing — and must not mark the reveal as delivered.
    runAuthoritative(() => {
      storeSetterNext(items, (d: any[]) => {
        void d.length; // open the draft; write nothing new
      });
    });
    flush();
    confirm();
    await run;
    await Promise.resolve();
    flush();
    // The revert's resync is the only notification that removes row 2 —
    // a lingering rf would leave the driven list on [1, 2] forever.
    expect(frames.at(-1)).toEqual([1]);
  });

  it("an equal-length PRIMITIVE reorder is structure (classic value-identity), not slot rewrites", async () => {
    const {
      createOptimisticStore,
      registerRowOps,
      action: act
    } = await import("../../src/index.js");
    const { registerSlotPatchNext } = await import("../../src/store/next/patch.js");
    const { storeSetterNext, runAuthoritative } = await import("../../src/store/next/store.js");
    const [items, setItems] = (createOptimisticStore as any)(["a", "b", "c"] as any[]);
    const rowEvents: any[] = [];
    const ticks: any[] = [];
    createRoot(() => {
      registerRowOps(items, (_r: any[], ops: any) => rowEvents.push(ops));
      registerSlotPatchNext(items, (i: number, v: any) => ticks.push([i, v]));
    });
    let confirm!: () => void;
    const run = act(function* () {
      setItems((d: any[]) => {
        d.push("z");
      });
      yield new Promise<void>(r => {
        confirm = r;
      });
    })();
    flush();
    const rowMark = rowEvents.length;
    const tickMark = ticks.length;
    // Staged PERMUTATION of primitives: classic keys primitive rows by
    // VALUE — rows must MOVE (row ops), not have contents rewritten.
    runAuthoritative(() => {
      storeSetterNext(items, (d: any[]) => {
        const t0 = d[0];
        d[0] = d[2];
        d[2] = t0;
      });
    });
    flush();
    confirm();
    await run;
    await Promise.resolve();
    flush();
    expect(ticks.slice(tickMark)).toEqual([]);
    const permOps = rowEvents.slice(rowMark).filter(o => o !== undefined && o !== null) as Array<{
      sources: number[];
    }>;
    expect(permOps.length).toBeGreaterThan(0);
    // RETENTION (fold audit 5): a pure permutation must MATCH every moved
    // value to its old index — sources:[-1,…] rebuilt every row and lost
    // the retained DOM nodes primitives key by value.
    for (const o of permOps) expect(o.sources.every(sc => sc >= 0)).toBe(true);
  });

  it("mixed primitive/object identities never collide across key spaces", async () => {
    const { buildIdentityRowOps } = await import("../../src/store/next/reconcile.js");
    const byId = (r: any) => r?.id;
    // ONE key map collided `{ id: 1 }` (keyed to 1) with the primitive row
    // `1` (valued 1) — a moved primitive was handed the OBJECT row's source
    // (fold audit 6, P1): stale DOM wearing the wrong identity.
    const obj = { id: 1 };
    const ops = buildIdentityRowOps([obj, 1, 2], [2, obj, 1], byId)!;
    expect(ops.prefix).toBe(0);
    expect(ops.sources).toEqual([2, 0, 1]);
    expect(ops.removed).toEqual([]);
    // PREFIX SCAN, same disease: `keyFn` probing a primitive yields
    // undefined on both sides — two DIFFERENT primitives falsely aligned
    // and the real change at index 0 escaped the ops window entirely.
    const rep = buildIdentityRowOps([5, 6], [7, 6], byId)!;
    expect(rep.prefix).toBe(0);
    expect(rep.sources).toEqual([-1, 1]);
    // An object keyed to a primitive id never aligns with that primitive.
    const cross = buildIdentityRowOps([{ id: 5 }, "x"], [5, "x"], byId)!;
    expect(cross.prefix).toBe(0);
    expect(cross.sources[0]).toBe(-1);
  });

  it("a plain move of `undefined` (and a sparse hole) retains its row", async () => {
    const { buildIdentityRowOps } = await import("../../src/store/next/reconcile.js");
    // `undefined` rows were skipped by both map build and lookup — a pure
    // move rebuilt the row (fold audit 6, P2). The sentinel makes them
    // first-class match participants; sparse holes read as the same value.
    const ops = buildIdentityRowOps(["a", undefined, "b"], [undefined, "a", "b"])!;
    expect(ops.prefix).toBe(0);
    expect(ops.sources).toEqual([1, 0, 2]);
    expect(ops.removed).toEqual([]);
    const sparse = new Array(3);
    sparse[0] = "a";
    sparse[2] = "b";
    const holes = buildIdentityRowOps(sparse, [undefined, "a", "b"])!;
    expect(holes.sources).toEqual([1, 0, 2]);
  });

  it("a shallow staged reveal rides ONE channel — slot ticks for aligned replacement, never row ops too", async () => {
    const {
      createOptimisticStore,
      registerRowOps,
      action: act
    } = await import("../../src/index.js");
    const { registerSlotPatchNext } = await import("../../src/store/next/patch.js");
    const { storeSetterNext, runAuthoritative } = await import("../../src/store/next/store.js");
    const [items, setItems] = (createOptimisticStore as any)(["a", "b"] as any[]);
    const rowEvents: any[] = [];
    const ticks: Array<[number, any]> = [];
    createRoot(() => {
      registerRowOps(items, (_r: any[], ops: any) => rowEvents.push(ops));
      registerSlotPatchNext(items, (i: number, v: any) => ticks.push([i, v]));
    });
    let confirm!: () => void;
    const run = act(function* () {
      setItems((d: any[]) => {
        d.push("c");
      });
      yield new Promise<void>(r => {
        confirm = r;
      });
    })();
    flush();
    const rowMark = rowEvents.length;
    // ALIGNED staged replacement (same length): slot territory.
    runAuthoritative(() => {
      storeSetterNext(items, (d: any[]) => {
        d[0] = "A2";
      });
    });
    flush();
    confirm();
    await run;
    await Promise.resolve();
    flush();
    // The reveal delivers the replacement ONCE: a slot tick — ANY row
    // event (ops OR the null resync the old filtered assertion hid) would
    // rebuild the row a second time (lifecycle/focus).
    expect(ticks.some(([i, v]) => i === 0 && v === "A2")).toBe(true);
    expect(rowEvents.slice(rowMark)).toEqual([]);
  });

  it("an equal-length staged REORDER is structure: one row-ops event, zero slot ticks", async () => {
    // Fold audit 3, P1: classifying aligned windows by LENGTH alone called
    // reorders value replacements — moved rows rebuilt via slot ticks and
    // lost identity/focus. Moved wrappable references are STRUCTURE.
    const {
      createOptimisticStore,
      registerRowOps,
      action: act
    } = await import("../../src/index.js");
    const { registerSlotPatchNext } = await import("../../src/store/next/patch.js");
    const { storeSetterNext, runAuthoritative } = await import("../../src/store/next/store.js");
    const a = { id: "a" };
    const b = { id: "b" };
    const [items, setItems] = (createOptimisticStore as any)([a, b] as any[]);
    const rowEvents: any[] = [];
    const ticks: any[] = [];
    createRoot(() => {
      registerRowOps(items, (_r: any[], ops: any) => rowEvents.push(ops));
      registerSlotPatchNext(items, (i: number, v: any) => ticks.push([i, v]));
    });
    let confirm!: () => void;
    const run = act(function* () {
      setItems((d: any[]) => {
        d.push({ id: "c" }); // retain optimism
      });
      yield new Promise<void>(r => {
        confirm = r;
      });
    })();
    flush();
    const rowMark = rowEvents.length;
    const tickMark = ticks.length;
    // Staged equal-length REORDER: same refs, swapped slots.
    runAuthoritative(() => {
      storeSetterNext(items, (d: any[]) => {
        const t0 = d[0];
        d[0] = d[1];
        d[1] = t0;
      });
    });
    flush();
    confirm();
    await run;
    await Promise.resolve();
    flush();
    // Structure rode row ops; the slot channel stayed silent.
    expect(ticks.slice(tickMark)).toEqual([]);
    const revealOps = rowEvents.slice(rowMark).filter(o => o !== null && o !== undefined);
    expect(revealOps.length).toBeGreaterThan(0);
  });

  it("a staged ROOT structural change reveals WITH row ops when only a descendant holds the override", async () => {
    const {
      createOptimisticStore,
      registerRowOps,
      action: act
    } = await import("../../src/index.js");
    const harnessFetches: Array<() => void> = [];
    let serverData: any[] = [{ id: 1, label: "a" }];
    let items!: any;
    let setItems!: any;
    let setVersion!: (v: (p: number) => number) => number;
    createRoot(() => {
      const [version, setV] = createSignal(0);
      setVersion = setV;
      [items, setItems] = (createOptimisticStore as any)(
        () =>
          new Promise<any[]>(resolve => {
            version();
            harnessFetches.push(() => resolve(serverData.map(r => ({ ...r }))));
          }),
        [] as any[]
      );
    });
    flush();
    harnessFetches.shift()!();
    await settle();
    const frames: number[][] = [];
    createRoot(() => {
      registerRowOps(items, (rows: any[]) => frames.push(Array.from(rows, (r: any) => r.id)));
    });
    // DESCENDANT-only override: a value edit on row 0 — the ROOT ARRAY
    // itself carries no override.
    let confirm!: () => void;
    const run = act(function* () {
      setItems((draft: any[]) => {
        draft[0].label = "opt";
      });
      yield new Promise<void>(resolve => {
        confirm = resolve;
      });
    })();
    flush();
    // STRUCTURAL landing while retained: stages into the transaction.
    serverData = [
      { id: 1, label: "a" },
      { id: 2, label: "b" }
    ];
    setVersion(v => v + 1);
    flush();
    harnessFetches.shift()!();
    await settle();
    // Reveal at settle: the root array's staged structural change commits —
    // the driven list MUST receive ops/resync for the new row.
    const revealMark = frames.length;
    confirm();
    await run;
    await settle();
    await settle();
    expect((items as any[]).length).toBe(2);
    expect(frames.at(-1)).toEqual([1, 2]);
    // ONE coherent notification per reveal (fold audit P1): overlapping
    // resync + row-op + slot work rebuilt the same rows repeatedly and
    // lost DOM identity/focus. At most one [1] frame may precede the
    // final [1,2] (the revert half), never repeated [1,2] rebuilds.
    const since = frames.slice(revealMark);
    const finals = since.filter(f => f.length === 2 && f[0] === 1 && f[1] === 2);
    expect(finals.length).toBe(1);
  });
});

describe("INVARIANT: landings integrate with the patch channel at classic-effect parity (#3123)", () => {
  // RUL-2 as re-ruled: an EQUAL landing (membership/arrangement unchanged)
  // holds live overrides — classic effects keep showing the optimistic view.
  // A CONTRADICTING landing consumes them authoritatively — classic
  // reversion effects ride the regular queues of the landing's commit.
  // The patch channel must match both, delivery for delivery.
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    flush();
  };

  function landingHarness(initialRows: any[]) {
    let serverData = initialRows.map(r => ({ ...r }));
    const fetches: Array<() => void> = [];
    let items: any;
    let setItems: any;
    let setVersion!: (v: (p: number) => number) => number;
    let dispose!: () => void;
    let store: { createOptimisticStore: any; action: any };
    const build = async () => {
      const mod = await import("../../src/index.js");
      store = { createOptimisticStore: mod.createOptimisticStore, action: mod.action };
      createRoot(d => {
        dispose = d;
        const [version, setV] = createSignal(0);
        setVersion = setV;
        [items, setItems] = (store.createOptimisticStore as any)(
          () =>
            new Promise<any[]>(resolve => {
              version();
              fetches.push(() => resolve(serverData.map(r => ({ ...r }))));
            }),
          [] as any[]
        );
      });
      flush();
      fetches.shift()!(); // initial landing
      await settle();
    };
    return {
      build,
      get items() {
        return items;
      },
      get setItems() {
        return setItems;
      },
      get action() {
        return store.action;
      },
      get dispose() {
        return dispose;
      },
      setServer(data: any[]) {
        serverData = data.map(r => ({ ...r }));
      },
      poll() {
        setVersion(v => v + 1);
        flush();
        fetches.shift()!();
      }
    };
  }

  it("an equal landing never flashes committed state through value patches", async () => {
    const h = landingHarness([{ id: 1, label: "a", count: 1 }]);
    await h.build();
    expect(h.items[0].label).toBe("a");

    const { createRenderEffect } = await import("../../src/index.js");
    const patched: string[] = [];
    const classic: string[] = [];
    let disposeConsumers!: () => void;
    createRoot(d => {
      disposeConsumers = d;
      registerPatch(h.items[0], (next: any) => patched.push(next.label + ":" + next.count), [
        "label",
        "count"
      ]);
      createRenderEffect(
        () => h.items[0].label + ":" + h.items[0].count,
        (v: string) => {
          classic.push(v);
        }
      );
    });
    flush();

    // Optimistic edit on `label`, held in flight.
    let confirm!: () => void;
    const run = h.action(function* (this: any) {
      h.setItems((draft: any[]) => {
        draft[0].label = "x";
      });
      yield new Promise<void>(resolve => {
        confirm = resolve;
      });
    })();
    flush();
    expect(classic.at(-1)).toBe("x:1");
    const watermark = patched.length;

    // Interim landing under FOLD semantics (#3164 re-ruling): the family
    // retains optimism (the action is open), so fresh truth STAGES into the
    // retaining transaction — classic readers keep the optimistic view
    // exactly as it was (count still 1: staged truth is invisible until the
    // reveal). The channel must deliver NOTHING newer than classic sees —
    // no "a:" flash, no early count.
    h.setServer([{ id: 1, label: "a", count: 2 }]);
    h.poll();
    await settle();
    expect(classic.at(-1)).toBe("x:1");
    const sinceLanding = patched.slice(watermark);
    expect(sinceLanding.some(v => v.startsWith("a:"))).toBe(false);
    expect(sinceLanding.some(v => v.endsWith(":2"))).toBe(false);

    // ATOMIC REVEAL at settle: override dies, staged truth lands — both
    // channels flip together to committed "a:2".
    confirm();
    await run;
    await settle();
    await settle();
    expect(classic.at(-1)).toBe("a:2");
    expect(patched.at(-1)).toBe("a:2");
    disposeConsumers();
    h.dispose();
  });

  it("a contradicting landing is one authoritative delivery with a structural resync", async () => {
    const h = landingHarness([{ id: 1, label: "a" }]);
    await h.build();
    const { registerRowOps } = await import("../../src/index.js");

    const patched: string[] = [];
    const rowEvents: Array<{ ids: any[]; resync: boolean }> = [];
    let disposeConsumers!: () => void;
    createRoot(d => {
      disposeConsumers = d;
      registerPatch(h.items[0], (next: any) => patched.push(next.label), ["label"]);
      registerRowOps(h.items, (next: any[], ops: any) =>
        rowEvents.push({ ids: next.map((r: any) => r.id), resync: ops === null })
      );
    });
    flush();

    // Optimistic structural add, held in flight.
    let confirm!: () => void;
    const run = h.action(function* (this: any) {
      h.setItems((draft: any[]) => {
        draft.push({ id: 2, label: "b" });
      });
      yield new Promise<void>(resolve => {
        confirm = resolve;
      });
    })();
    flush();
    expect(rowEvents.at(-1)?.ids).toEqual([1, 2]);
    const patchMark = patched.length;
    const rowMark = rowEvents.length;

    // CONTRADICTING landing under FOLD semantics (#3164 re-ruling): the
    // family retains optimism (the action is open), so the landing STAGES —
    // classic readers keep the optimistic arrangement [1, 2], and the
    // channel must stay exactly there with them: no early flip, no early
    // value.
    h.setServer([
      { id: 1, label: "a2" },
      { id: 3, label: "c" }
    ]);
    h.poll();
    await settle();
    expect(rowEvents.slice(rowMark)).toEqual([]);
    expect(patched.slice(patchMark)).toEqual([]);

    // ATOMIC REVEAL at settle: override dies, staged truth lands — the
    // driven list flips to [1, 3] and the value channel delivers the
    // authoritative "a2", both on the settle drain.
    confirm();
    await run;
    await settle();
    await settle();
    expect(rowEvents.at(-1)!.ids).toEqual([1, 3]);
    expect(patched.at(-1)).toBe("a2");
    disposeConsumers();
    h.dispose();
  });

  it("a continuation echo replay keeps channel/classic parity (no flash, no duplicate, value masks until settle)", async () => {
    // The third landing posture (d813a96f): a CONTINUATION landing that
    // echoes an open transaction's keyed add. Wipe + replay re-derives the
    // optimistic view — the echoed row keeps the landed slot, the replayed
    // edit's value masks it until its transaction settles, the other open
    // add re-bases without a flash. The channel must tell the driven list
    // the same story classic effects see, frame for frame.
    const mod: any = await import("../../src/index.js");
    const { createOptimisticStore, createRenderEffect, registerRowOps, until } = mod;
    type Row = { id: number; pending: boolean };
    let notify!: { promise: Promise<Row>; resolve: (row: Row) => void };
    const reset = () => {
      let resolve!: (row: Row) => void;
      const promise = new Promise<Row>(r => (resolve = r));
      notify = { promise, resolve };
    };
    reset();
    const confirm = (row: Row) => {
      const current = notify;
      reset();
      current.resolve(row);
    };
    let items!: any;
    let setItems!: (fn: (rows: Row[]) => void) => void;
    const classic: string[][] = [];
    const dispose = createRoot((d: () => void) => {
      [items, setItems] = createOptimisticStore(async function* (store: Row[]) {
        yield [] as Row[];
        while (true) {
          const row = await notify.promise;
          yield;
          store.push({ ...row, pending: false });
        }
      }, [] as Row[]);
      createRenderEffect(
        () => items.map((r: Row) => r.id + (r.pending ? "p" : "")),
        (v: string[]) => {
          classic.push(v);
        }
      );
      return d;
    });
    flush();
    await settle();

    const rowFrames: string[][] = [];
    let disposeConsumers!: () => void;
    createRoot(d => {
      disposeConsumers = d;
      registerRowOps(items, (next: Row[]) => {
        rowFrames.push(next.map((r: Row) => r.id + (r.pending ? "p" : "")));
      });
    });
    flush();

    // Two blind keyed adds; both actions hold past their own confirmations.
    const holds: (() => void)[] = [];
    const add = action(function* (row: Row) {
      setItems(store => {
        store.push({ ...row, pending: true });
      });
      yield until(() => items.some((x: Row) => x.id === row.id));
      yield new Promise<void>(resolve => holds.push(resolve));
    });
    const addA = add({ id: 0, pending: true });
    flush();
    const addB = add({ id: 1, pending: true });
    flush();
    expect(classic.at(-1)).toEqual(["0p", "1p"]);
    expect(rowFrames.at(-1)).toEqual(["0p", "1p"]);
    const classicMark = classic.length;
    const rowMark = rowFrames.length;

    // A's confirmation: continuation landing echoing row 0 (pending:false).
    confirm({ id: 0, pending: false });
    await settle();
    await settle();
    expect(classic.at(-1)).toEqual(["0p", "1p"]);
    expect(rowFrames.at(-1)).toEqual(["0p", "1p"]);

    confirm({ id: 1, pending: false });
    await settle();
    await settle();
    expect(rowFrames.at(-1)).toEqual(["0p", "1p"]);

    // Settle is the only reckoning: edits die with their transactions and
    // the landed truth (pending:false) stands, in BOTH consumers.
    for (const release of holds) release();
    await Promise.all([addA, addB]);
    await settle();
    expect(classic.at(-1)).toEqual(["0", "1"]);
    expect(rowFrames.at(-1)).toEqual(["0", "1"]);

    // After both rows were visible, no channel frame ever lost a row
    // (flash) or carried a duplicate key (echo double-count) — and classic
    // held the same line.
    for (const frame of rowFrames.slice(rowMark)) {
      expect(frame).toHaveLength(2);
      expect(new Set(frame.map(s => s[0])).size).toBe(2);
    }
    for (const frame of classic.slice(classicMark)) expect(frame).toHaveLength(2);

    disposeConsumers();
    dispose();
  });

  it("the settle-drain reckoning (entangled retainers die together) keeps channel/classic parity", async () => {
    // The fourth posture: settle-time re-derivation. Actions writing one
    // optimistic store ENTANGLE through the shared writes and settle
    // together — one action completing early does not strip its mask
    // (edits live exactly as long as their transaction, and the entangled
    // transaction is still open). At the joint settle the reckoning wipes
    // and replays (nothing survives here) — the channel must land on the
    // committed truth without serving the wipe's half-states.
    const mod: any = await import("../../src/index.js");
    const { createOptimisticStore, createRenderEffect, registerRowOps, until } = mod;
    type Row = { id: number; pending: boolean };
    let notify!: { promise: Promise<Row>; resolve: (row: Row) => void };
    const reset = () => {
      let resolve!: (row: Row) => void;
      const promise = new Promise<Row>(r => (resolve = r));
      notify = { promise, resolve };
    };
    reset();
    const confirm = (row: Row) => {
      const current = notify;
      reset();
      current.resolve(row);
    };
    let items!: any;
    let setItems!: (fn: (rows: Row[]) => void) => void;
    const classic: string[][] = [];
    const dispose = createRoot((d: () => void) => {
      [items, setItems] = createOptimisticStore(async function* (store: Row[]) {
        yield [] as Row[];
        while (true) {
          const row = await notify.promise;
          yield;
          store.push({ ...row, pending: false });
        }
      }, [] as Row[]);
      createRenderEffect(
        () => items.map((r: Row) => r.id + (r.pending ? "p" : "")),
        (v: string[]) => {
          classic.push(v);
        }
      );
      return d;
    });
    flush();
    await settle();

    const rowFrames: string[][] = [];
    let disposeConsumers!: () => void;
    createRoot(d => {
      disposeConsumers = d;
      registerRowOps(items, (next: Row[]) => {
        rowFrames.push(next.map((r: Row) => r.id + (r.pending ? "p" : "")));
      });
    });
    flush();

    // A completes at its own confirmation (dies at settle); B holds open.
    const add = action(function* (row: Row) {
      setItems(store => {
        store.push({ ...row, pending: true });
      });
      yield until(() => items.some((x: Row) => x.id === row.id));
    });
    let holdB!: () => void;
    const addHeld = action(function* (row: Row) {
      setItems(store => {
        store.push({ ...row, pending: true });
      });
      yield new Promise<void>(resolve => {
        holdB = resolve;
      });
    });
    const addA = add({ id: 0, pending: true });
    flush();
    const addB = addHeld({ id: 1, pending: true });
    flush();
    expect(classic.at(-1)).toEqual(["0p", "1p"]);
    expect(rowFrames.at(-1)).toEqual(["0p", "1p"]);

    // A's confirmation lands its row and completes A — but A's transaction
    // entangled with B's through the shared store, so BOTH masks hold (an
    // edit lives as long as its transaction; the joint transaction is open).
    confirm({ id: 0, pending: false });
    await addA;
    await settle();
    await settle();
    expect(classic.at(-1)).toEqual(["0p", "1p"]);
    expect(rowFrames.at(-1)).toEqual(["0p", "1p"]);

    // Joint settle: every retainer dies, landed truth stands — row 0 as the
    // server confirmed it, row 1 (never landed) reverted. Channel included.
    holdB();
    await addB;
    await settle();
    expect(classic.at(-1)).toEqual(["0"]);
    expect(rowFrames.at(-1)).toEqual(["0"]);

    disposeConsumers();
    dispose();
  });
});
