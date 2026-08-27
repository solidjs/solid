
## 18. Impact sweep + A/B on the published pairing (2026-08-26)

Octane migrated to the real consumer chain: `@solidjs/vite-plugin@3.0.0-next.34`
→ `@solidjs/compiler@2.0.0-rc.3` (published napi binary). Two loader bugs
fixed on next in the process (whitelist rejection; boolean `true` collapsing
to `Wrapper::Default`, which `patch_driver` uniquely reads as disabled — the
loader now normalizes `true` → `"patchDriver"`, so the published binary works
without a native rebuild).

### §18a. Which benchmarks compile patch grammar (Babel sweep, patch on)

6 of 15 octane solid fixtures emit at least one patch body
(`scripts/patch-impact-sweep.mjs` in the octane workspace):

| suite | sites | notes |
|---|---|---|
| dbmon | 1 + rowProof | keyed deep-store list — flagship |
| svg-dashboard | 12 + 3 rowProof | store-driven charts |
| portal-swarm | 3 + rowProof | signal-only subjects — fallback path |
| news (runtime-stress, store-selector-fanout) | 3 | |
| async-waterfall | 1 | latency-dominated harness |
| weather-app | 3 | static-ish states |

Not impacted (no grammar): js-framework (signal rows), todomvc,
chat-stream (hybrid signal patterns), effectful-list, memo-wall,
recursive-context, signal-favoring, spa-navigation, streaming-ssr.

### §18b. A/B (same runtime, flag-only; busy machine, deltas well over noise)

- **dbmon (deep)**: mount 15.8→6.3, tick 8.3→1.8, partial 1.4→0.6,
  remount 10.1→5.0, unmount 2.5→0.3, sort flat.
- **svg-dashboard**: mount 9.1→7.0, charts_tick 3.9→3.1, drag 5.5→4.8,
  churn 4.1→3.7, series 2.9→2.6, style pulse 6.4→6.0; nothing regresses.
- **async-waterfall / weather-app**: flat (DOM censuses identical — a
  correctness signal).
- **portal-swarm**: open/close cycles +0.06–0.10 ms (~5%), reproduced at
  40 iters. All-signal fixture: its 3 patch bodies always miss
  `patchableRaw` and take the effect fallback, paying the probe + wrapper
  per portal mount. This is the audit's "permanent cost for optional
  modes," quantified on a worst-case mount-churn shape. Open item: shrink
  the fallback bind cost.

## 20. Re-audit hardening (2026-08-26 night)

External re-audit verdict: "materially improved, still not merge-ready" —
six blockers, all verified in code before fixing (every one was real):

1. **Registration lifecycle**: ordinary patchDriver binds discarded their
   unbind — entries and patchCount leaked past unmount (drains only skip
   disposed owners). Now owner-cleanup-tied; unbind decrements only on
   actual removal.
2. **Transition merges**: `_heldPatches` was an undeclared sidecar that
   mergeTransitionState never moved — merged-away transitions silently
   dropped their held patches. Now moved like every declared collection.
3. **Accessor contract**: patchableRaw trusted the lazily-discovered `a`
   flag (unsound admission — getter deps never re-applied); demotePatches
   had no caller. Now: scan-at-admission (sticky, one pass per record) and
   defineProperty-acquired accessors demote to tracked effect fallbacks
   (deferred to effect phase; getter deps track through the proxy).
4. **Family structure**: writable projection push/splice froze driven
   lists (setter row ops gated to fam === null; both the clone branch and
   the eager write-override fold now emit, gated off adoption folds and
   optimistic families). Row-ops/slot registrations resolve chained
   backings to the ultimate owner. A first attempt emitted at fold-commit
   WITHOUT the adoption gate and double-applied matrix reorders — the
   `t.adopted` flag is the discriminator.
5. **Optimistic errors**: drainOptimistic invoked callbacks bare; now
   shares the normal drain's applyEntries (isolation + boundary routing).
6. **Compiler contract**: `patchDriver` typed in TransformOptions, Babel
   normalizes boolean `true` like the native loader, and a `dom-patch`
   parity tier compiles the full dom corpus with patch mode on —
   **byte parity, zero ratchet files**.

Also: `_DX_DEV_` → `_SOLID_DEV_` (the dev ownership diagnostic was
shipping in production patch bundles — unreplaced truthy string), and
occurrence-aware duplicate-key matching in buildRowOps + identityOps
(first-wins handed one DOM row to multiple next positions).

Known accepted edge: a demoted LIST-ROW body re-drives under the list
owner, so per-row severing is lost for demoted rows (they only demote when
user code defines an accessor on a row record at runtime).

Deferred from the audit's secondary list: staged exception-safe applyOps
(remove-before-build), per-store rather than global patchCount gating, the
@ts-nocheck on patch-driver.ts, and a versioned internal compiler entry
for the runtime primitives.

## 19. Pay-for-use restructure (2026-08-26) — the merge blocker

The size gate (scripts/size) failed 5/8 scenarios: every client app paid
~2.4 KB brotli (simple-app floor 10.41 → 12.99 KB) because insert called
`driveList` directly, and stores ~1 KB because the write paths imported
patch.ts's emitters statically.

Restructure:
- **web**: driver moved to `patch-driver.ts`; insert dispatches through a
  `listDriver` hook slot, armed lazily from `rowProof`/`patchDriver`
  (module-scope install is an unshakeable top-level side effect in the
  flat dist bundle — first attempt measurably FAILED; rowProof runs at
  template creation, always before the list's insert, so lazy arming is
  order-sound).
- **signals**: emitters ride `patch-hooks.ts`, installed at first
  registration. Sound: every emission is `pc`-guarded and `pc` only
  exists via registration. `registerSlotPatchNext` moved into patch.ts so
  slot-only registrations arm too.

Result: all 8 scenarios green. App floors ~+100 B vs next (the hook slot
+ `$ll` metadata); store floors +~490 B of trap/walk seams (limits
ratcheted with notes in .size-limit.js). Driver engagement unchanged
(dbmon tick 1.60); full suite 32/32.

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
