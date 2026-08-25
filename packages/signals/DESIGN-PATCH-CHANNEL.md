
## 17. Family channel complete + equivalence matrix (2026-08-25, stage-2 pickup on the absorbed monorepo)

Stage 2 resumed on `stage2-channel` (folded repo; the pre-fold history
archive remains on `store-edit-script`). The compiler is in-tree and
dormant — activation is a `patchDriver` default flip.

### §17a. The equivalence matrix is the merge gate (built, first catches)

`packages/web/test/for.equivalence.spec.tsx`: every identity mode ×
operation sequence runs twice — a hand-compiled patch-mode row (driver
engaged) vs the same DOM under a grouped render effect, unstamped
(classic mapArray) — asserting per-step CONTENT and RETENTION TOPOLOGY
equality (each position: new, or moved from position j; normalized so
creation order cannot fake equivalence; payload graphs cloned per run —
stores adopt/own incoming data).

Catches on day one:
1. Shallow slot emission raced row creation: appended positions past a
   fully-aligned prefix (vacuously aligned from an empty prev) emitted
   value-ticks for rows the row ops had not created yet — driver crash
   on clear-then-refill and pure appends. Slots now require a previous
   slot (i < dlen).
2. Chained-backing registration hole: a projection wrapper's backing IS
   the source proxy; patches registered on the wrapper never fired
   (value transitions fold on the source). registerPatch/patchableRaw
   resolve the chain to the ultimate owner.

### §17b. Family channel — every store kind is now drivable

- PROJECTION families: the audit-era blanket decline was broader than
  the bug — the reconcile walk's emissions were never family-gated and
  ride the transition-stamped apply queue. Decline narrowed to
  optimistic (`storeHasOptimisticFamily`); chained registration fixed
  (§17a.2).
- OPTIMISTIC families: structural writes ride node overrides (never
  walk), so the override-application site emits identity-diffed row ops
  at LANE timing (emitRowOpsOptimistic beside emitPatchOptimistic;
  buildIdentityRowOps factored from the setter channel). Reverts emit
  the RESYNC form (ops === null): the driver rebuilds retention by row
  identity against the live post-revert view (drain-time resolution —
  overrides are gone by then). The driver binds optimistic lists from
  the OPTIMISTIC VIEW through the proxy (committed lags in flight;
  classic reads the same view). identityOps shared between swaps and
  resyncs.

Matrix: 47 scenarios green (deep, shallow, projection sync sequences +
retention pins; optimistic async scripts push/splice/reorder+value/
whole-list-replace × revert+land, snapshotting mounted → in-flight →
settled). This closes the "benchmark-shaped" critique: engagement now
spans plain deep, shallow (reference semantics), projection, and
optimistic arrays.

### §17c. Remaining before ship

1. Quiet-machine margins vs current next (which now includes the classic
   text-node reuse — expect the driver's update margins to compress).
2. Coverage posture (13% of corpus For lists stamp — report:
   scripts/row-coverage.mjs, now folded-repo-aware): grammar growth vs
   documented manual rowProof vs accept-narrow. Product call.
3. Ship shape: one default flip (both tiers) vs Tier-2 first. Current
   recommendation: one flip, full gates.
