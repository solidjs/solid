# Mined rules: projections

Source suites: `sync` = `tests/store/createProjection.test.ts`, `async` = `tests/store/createProjection.async.test.ts`, `jsdom` = `tests/store/createProjection.jsdom.test.ts`.

## Recompute semantics

**R1 — The derive receives the projection's current state as a mutable draft that persists across runs**; prior runs' writes are visible and editable later.
- Evidence: sync "should observe key changes", "should not self track", "preserves inline object property writes when splicing draft arrays".

**R2 — Draft reads inside the derive never register dependencies (no self-tracking)**, including `has`/index probes from array methods (`findIndex`, `splice`) and inspection traps from `console.log`.
- Evidence: sync "should not self track"; async "does not self-track through array splice has checks"; jsdom "does not loop when a draft is logged".

**R3 — The derive runs eagerly at creation (before any read/subscriber) and re-runs on flush when tracked sources change, even with zero subscribers.**
- Evidence: jsdom "does not loop…" (runs===1 after createRoot, runs===2 after unobserved set+flush); async "isPending is false during initial async load".
- CONFLICT (note): eager-with-zero-subscribers must survive node laziness — derive scheduling can't be gated on node existence (R1-unobservability cuts both ways).

**R4 — A returned value merges reconcile-style**: changed paths notify, absent keys delete, unchanged paths keep value and identity.
- Evidence: sync "should fork a signals values", "swaps in place when the derive returns a different entity"; async "yielding a value replaces the entire snapshot (no merge)".

**R5 — The projection's root proxy identity is stable for its lifetime**: across entity swaps, shape changes, and root key mismatches (root key change merges in place, no throw).
- Evidence: sync "swaps in place…"; async "shape changes DO NOT cause proxy identity changes", "async projection preserves identity only for unchanged paths".

**R6 — Keyed diff (default key `"id"`)**: key-matched subtrees merge in place preserving child proxy identity, skipping notification for unchanged slots; key mismatch replaces the subtree with a fresh proxy.
- Evidence: sync "keeps merging when identity is unchanged"; async "keyed identity mismatch replaces subtree identity".

**R7 — Key matching is hierarchically scoped**: when the root entity's key changes, children are NOT merged across the entity change even if their own keys match.
- Evidence: sync "does not merge children across an entity change".
- CONFLICT (mild): §4 lacks the entity-scoping qualifier — the ported diff must carry it or the rewrite over-merges.

**R8 — `{ key: null }` merges positionally** (proxy identity preserved regardless of key-field changes).

**R9 — A proxy detached by an entity swap remains a coherent read view of its own (old) data** — never dead, never reflecting the new entity.
- Evidence: sync "does not merge children across an entity change" (`beforeSwap.title` still "one/a").

**R10 — After a root swap, the outgoing raw stops resolving to the projection root**; re-handed as nested data it wraps as a distinct proxy with its own values.
- Evidence: sync "the outgoing raw stops resolving to the projection root".
- CONFLICT: pins raw→proxy lookup lifecycle; doc states adoption *registers* `next` but not the unregister rule for the displaced raw. Needs explicit asymmetric rule: proxy keeps its backing; the lookup entry for the displaced raw is dropped/superseded.

**R11 — `reconcile()` on a plain store still throws on root key mismatch**; the projection root's merge-in-place (R5) is a projection-specific relaxation.
- CONFLICT (mild): the single adoption channel must be policy-parameterized (two root-identity policies, one diff engine).

## Firewall / isolation

**R12 — Only subscribers of actually-changed properties rerun**; equal-value rewrites and writes to unobserved keys notify nobody.
- Evidence: sync "should observe key changes", "should fork a signals values", selection tests; async "async projection notifies only changed paths".

**R13 — Deleting a key notifies its subscribers; subscribers of absent keys track and are notified on later creation.**
- Evidence: sync "simple selection", "double selection" (100 effects on mostly-absent keys; exactly the touched keys fire).
- CONFLICT (mild): requires nodes on nonexistent properties + delete notification — intersects O2.

**R14 — Every subscriber of a changed property is notified exactly once per change.**

**R15 — Projections compose** (projection reading another projection; downstream effects run once per upstream change with correct previous values).

**R16 — `Object.keys` of a projection is tracked and notifies on key-set changes, including through a chained store backing.**
- CONFLICT (mild): the key-set node must bridge chained backings.

## Chained backing (store-in-projection, #2941)

**R17 — A derive returning a live store proxy adopts it live**: subsequent source-store writes flow through the projection without re-running the derive.
- Evidence: sync "derive returning a store adopts it live" (derive called once; seen = [1, 5555]).
- CONFLICT (MAJOR): §7's "recompute merges output into raw" cannot express live chaining — updates bypass recompute entirely. Needs a third adoption variant: cross-store backing adoption with subscription bridging (projection's proxies/nodes read through to and are notified by the source store's live graph).

**R18 — Fine-grained isolation preserved through the chain**: a nested source-store write notifies only the projection subscribers of that nested path.

**R19 — When the derive's return switches (store → plain → other store), subscribers see each new value and the previous chain is fully severed.**

**R20 — Chained backing works for array roots** (structural + row-level edits flow).

**R21 — `createStore(fn, seed)` is the same projection mechanism and chains identically.**

**R22 — `snapshot()` of a chained projection returns plain data equal to the current view and detached from future source writes.**
- Evidence: sync "snapshot() of a chained projection returns plain detached data" (snap.a stays 1 after s.a = 99).
- CONFLICT (MAJOR): §2's settled snapshot = raw identity, zero copy; with in-place owned-raw mutation, a raw-identity snapshot would observe later writes. Either snapshot copies owned subtrees (identity preservation only for still-shared source subtrees — arguably the documented contract read strictly) or this expectation needs a ruling. Extends O1 (O1 covers pending lanes, not owned-raw aliasing).

## Async

**R23 — The seed is a draft for the derive, never observable (#2897)**: until first settle/yield, every read — tracked, untracked, enumeration/spread — throws NotReadyError.
- CONFLICT: store-wide status (gates every property read incl. untracked), not per-property lane value. Needs a store-level status home after layer deletion.

**R24 — Draft writes during an in-flight async run are invisible until that run settles** (per-run atomic visibility).

**R25 — Async generators publish one snapshot per yield**: bare `yield` publishes accumulated draft mutations; `yield value` replaces the entire state (no merge); each yield transforms again.

**R26 — Latest-run-wins supersession**: superseded runs' later yields and pending draft writes are discarded entirely; if no run ever landed, stays NotReady.

**R27 — Async recompute does not coarsen granularity**: after settle, only changed-path subscribers rerun.

**R28 — `refresh(proj)` forces a new derive run; bare refresh is quiet** (no pending published; silent reveal).

**R29 — `affects(proj)` + `refresh(proj)` is a declared reload**: subscribed effects see isPending true + stale value for the window, then settle.

**R30 — With no effect subscribed, async work creates no transition** (isPending false throughout initial load).

**R31 — With a subscribed effect, source-triggered async reruns are transitions** (pending true + stale during window); initial no-stale-data load is never pending.

**R32 — Reading a pending async source inside the derive propagates NotReady to consumers** (Loading boundaries fall back); settle fires downstream effects exactly once with the settled value, never the seed (#2938).

**R33 — Settlement is a status change, not a value diff**: boundaries and blocked effects release even when the settled value equals the seed.

**R34 — Errored derives follow async memo rules**: after rejection ALL readers (settle-time, late tracked, untracked) throw the error (StatusError-wrapped; boundaries unwrap). Seed never served uninitialized; last-good never served after failed refetch.
- CONFLICT: same store-wide-status problem as R23.

**R35 — A genuine tracked read on a later cycle retries an errored derive** (memo parity: never untracked, never inside isPending probe, at most once per cycle); successful retry serves fresh value.

## Lifecycle

**R36 — Disposing the owning root stops the projection** (no recomputes, no notifications afterward).

## Tests pinning internals — need a ruling

1. **Unkeyed nested-object identity replacement** — async yields replace an unkeyed nested object's proxy identity whenever content changes (tension with R6/R12 fine-grained merge). Rule on whether unkeyed objects must replace rather than merge — may encode an accident of the yield path.
2. **Microtask-count choreography** — exact `await Promise.resolve()` counts and `runs === 2` pins throughout. Rule: "seed unobservable until settle" is contract; "exactly two microtasks" is not.
3. **Family-map cleanup timing** (R10's test) — the when of unregistration is an internals decision.
4. **#2938 test comment** describes the current firewall mechanism; only the effect log is contract.
5. **"proj.a; // realize the projection"** in the chained-snapshot test — if snapshot works without a realizing read in the rewrite, noise; if not, an accidental laziness observable violating R1-unobservability. Ruling either way.

## Major conflicts summary

- **R17 (live chained backing)** — biggest gap: needs cross-store backing adoption with subscription bridging.
- **R22 (snapshot detachment)** — collides with zero-copy raw-identity snapshot under in-place owned-raw mutation. Extends O1.
- **R23/R34 (store-wide NotReady/error status)** — needs a status home per store, not per property.
- **R7/R11 — root-identity policy split + entity-scoped key matching** must parameterize the single diff engine.
