// Import-cost scenarios for #2883, measured against the built browser-prod
// artifacts. Bare specifiers resolve via esbuild aliases so nothing here
// touches the workspace dependency graph. Limits carry ~5% headroom over the
// sizes at landing: a breach means tree-shaking regressed (or a deliberate
// feature landed — bump the limit in the same PR and say why). The simple-app
// scenario is pinned at 10 KB on purpose.
// Subpath aliases first: esbuild's alias matches by prefix, so the bare
// `solid-js` entry would otherwise remap `solid-js/internal` (the seams the
// runtimes consume — packages/solid/src/internal.ts) to `solid.js/internal`.
const alias = {
  "solid-js/internal": "../../packages/solid/dist/internal.js",
  "solid-js": "../../packages/solid/dist/solid.js",
  "@solidjs/web": "../../packages/web/dist/web.js",
  "@solidjs/signals": "../../packages/signals/dist/prod/index.js"
};
const modifyEsbuildConfig = config => ({ ...config, alias });

// Observe tier (documentation/plans/observe-tier-plan.md): the artifacts the
// `observe` export condition selects — wiring kept (attribution hook sites,
// owner labels, edge counters, the diagnostics channel), checks folded. Its
// scenario measures what a production observability build ships; the prod
// scenarios above it must not move because of the tier's existence.
// Subpath aliases are listed first: esbuild's alias matches by prefix, and
// the bare `solid-js` entry would otherwise swallow `solid-js/attribution`.
const observeAlias = {
  "solid-js/attribution": "../../packages/solid/dist/attribution.js",
  "solid-js/internal": "../../packages/solid/dist/internal.js",
  "@solidjs/signals/attribution": "../../packages/signals/dist/observe/attribution.js",
  "solid-js": "../../packages/solid/dist/solid.observe.js",
  "@solidjs/web": "../../packages/web/dist/web.observe.js",
  "@solidjs/signals": "../../packages/signals/dist/observe/index.js"
};
const observeEsbuildConfig = config => ({ ...config, alias: observeAlias });

// The frames scenario measures the EAGER graph a server-component consumer
// ships: the frames client entry plus the server-function transport it
// carries. `@solidjs/web/serialization` (the seroval codec, ~13 KB gz) is
// external because it loads lazily via the host's `prepareData` hook — a
// static seroval import creeping back into either dist blows this limit
// (or fails resolution outright), which is the regression this guards.
const framesEsbuildConfig = config => ({
  ...config,
  // No `alias` spread: `solid-js`/`@solidjs/web` are external here, and the
  // "@solidjs/web" alias would prefix-clobber the subpath specifiers before
  // `external` could match them. Only the bundled transport needs routing.
  alias: {
    "@solidjs/web/server-functions/client": "../../packages/web/server-functions/dist/client.js"
  },
  external: [
    "solid-js",
    "solid-js/internal",
    "@solidjs/web",
    "@solidjs/web/serialization",
    "@solidjs/web/serialization/decode"
  ]
});

// RC.6 correctness reconciliation (2026-09-01): these caps were last
// reconciled before #3181's synchronous superseded-flight settle walk, the
// held-truth/optimistic-store follow-ups (#3146, #3147, #3178), and the
// hydration/DOM correctness batch (#3163, #3180, #3182, #3187, #3189).
// #3181 explicitly accepted its core-retained cost and updated the
// in-package treeshake budget, but this scenario gate was missed. The frames
// delta is the separately reviewed server-function transport hardening.
// Limits below are the measured Linux CI/local artifacts rounded up to the
// next 0.01 kB; this is a ratchet reconciliation, not additional headroom.
//
// Delegated EventListenerObject parity (#3206): scenarios retaining the
// delegated dispatcher pay for object-form invocation and for clearing a
// replaced bound tuple's data slot. Linux CI/local measurements are rounded
// to the next 0.01 kB at the affected limits below.
//
// Own-property parity (#3204): style and spread now match SSR for inherited
// attributes, children, and refs. The affected client scenarios are likewise
// rounded up to the next 0.01 kB.
//
// Post-RC.6 audit (2026-09-02): #3226's pending-source ownership fix is
// core-retained, adding 12 B to isPending/latest and up to 16 B to hydrating
// builds on Linux. The remaining caps are ratcheted to the larger of the
// measured Linux CI and macOS artifacts, rounded up to the next 0.01 kB.
module.exports = [
  {
    name: "signals: core floor (createSignal/Memo/Effect/Root/flush)",
    path: "../../packages/signals/dist/prod/index.js",
    import: "{ createSignal, createMemo, createEffect, createRoot, flush }",
    // loadingValue (commit #0): 7.1 -> 7.35 KB, measured at 7.18 KB. The
    // loading window lives on always-retained paths by construction — it's
    // an OPTION on createMemo/createSignal, so its support (the `_loading`
    // field, the window checks in recompute/handleAsync, the parking of
    // unready sources without read-visible pending) is reachable from the
    // core entry points and cannot shake based on usage. ~110 B brotli after
    // a dedupe pass (parkLoadingWindow shared by recompute's catch and
    // handleError, hoisted instanceof, unconditional window clears); the
    // alternatives (a STATUS_UNINITIALIZED ride-along, null-slot hooks)
    // either break the born-committed invariant or don't shake anyway.
    //
    // 2.0.0-rc: 7.35 -> 7.45 KB, measured at 7.32. Per-commit: flatten
    // promise-of-AsyncIterable (66accfb8, ~+100 B — the deferred pump,
    // el-targeted close registration, and in-flight identity guards all sit
    // on handleAsync, which every async-capable entry retains) plus the
    // effect-phase read gating (#3006, ~+15 B). A textual dedupe pass on the
    // flatten path (shared NotReady tail / probe / disposal push) measured
    // NEGATIVE under brotli — repeats compress nearly free, indirection adds
    // unique tokens — so the bytes are the feature's real cost.
    //
    // Stage-3 hot-path batch (pre-release ratchet): 7.45 -> 7.85 KB, measured
    // at 7.70. The perf rework trades bytes for monomorphic speed on the
    // core loop: node-shape alignment + presence bits (88a856d8), the
    // cold-field extension split `_x` (7bde47fe, 97d7a277, ece1cc77,
    // 46d7d325, e89a66d3), the signal-literal diet + `_transition` return
    // (f895a3bf, 8b38e874), the staged-rewrite fast path (f1a35423), the
    // companion-walk gate (#3038, debc22b9), and the #3042/#3043 transition
    // fixes. Verified the prod chunks carry no dev diagnostics — this is
    // the batch's real retained cost, accepted for its runtime wins.
    // Re-audit-5 hardening ripple (2026-08-27): the mergeTransitionState
    // stash move + stamp retarget and the dispatch snapshot marks are
    // core-retained — a few dozen brotli bytes on every scenario.
    //
    // #3122 eager iterator teardown (2026-08-31): 7.9 -> 7.91 KB, measured
    // at 7.903. The _flightTeardown release sits on recompute's supersede
    // path, which the core loop always retains. Conscious bump — see the
    // in-package treeshake budget note.
    //
    // #3164 fold ruling (2026-08-31): 7.91 -> 7.95 KB, measured at 7.94.
    // read()'s A17-for-held-truth arm (fold-staged truth masked from
    // ordinary readers under a live optimism-retaining transition) plus the
    // GlobalQueue._heldTruthMasked hook slot. The mask's ledger and the
    // transition-optimism probe live in the optimistic module behind the
    // hook — the floor pays only the guarded call site.
    //
    // Fold relocation pass (2026-09-01): 7.95 -> 7.94 KB, measured at 7.93.
    // heldTruthNodes + transitionHoldsOptimism moved from scheduler.ts into
    // the optimistic module, and read()'s latest()/authoritative-read
    // exemptions moved inside the hook (which now takes the observer) —
    // the floor keeps only `config-gate && hook?.(el, c)`.
    //
    // Patch-channel removal (2026-09-02): 8.02 -> 7.98 KB, measured at
    // 7.95. The channel is deleted from next — regions own value delivery,
    // the unified-For design owns structure — reclaiming the store write-path emission seams retained by the core floor.
    //
    // Store create-floor diet (2026-09-04): 7.98 -> 8.00 KB, measured at
    // 7.995. The slot-node unobserved dispatch sits on the two core sweep
    // sites (unlinkSubs, sweepTransientStoreNodes): a config-flag branch to
    // the ONE shared hook. slotSignal itself shakes out of storeless
    // bundles; these ~15 B buy the store scenarios their per-node closure/
    // NodeExtension diet (see the createStore note).
    //
    // Contested-effect re-derivation (#3322, 2026-09-09): 8.00 -> 8.10 KB,
    // measured at 8.07. Effects have one value slot and do not entangle
    // transactions, so a second live transaction (or mainline) recomputing a
    // shared render effect overwrote the value the first still owed a run
    // for, and its silent commit then published it. Effect._valueTransition
    // stamps the owner, contestEffect records the effect on the owed
    // transaction(s), finalizePureQueue re-dirties them ahead of the heap
    // run; read()'s signal fast path gains the stale-reader mask for foreign
    // staged writes the slow path already had. ~+240 B minified, all of it
    // core: the clobber happens in recompute and the fix IS commit ordering.
    // Every scenario below moves by the same ~70-90 B.
    //
    // Effect ownership on finalize re-entry (#3319, 2026-09-09): 8.10 -> 8.18 KB,
    // measured at 8.146. finalizePureQueue captures the batch it started with
    // and no longer commits/reverts a batch that a commit hook, boundary
    // sweep or recompute handed to an entered transaction (the PR's guard),
    // while a completing transaction with a separate ambient batch still
    // settles its own containers. Effects then follow the #3322 owner stamp:
    // in a flush whose finalize entered a transaction, runEffect leaves runs
    // owned by a still-held transaction queued for the next gate to park,
    // and applies everything computed mainline. ~+166 B minified; the coarse
    // alternative (park the whole flush) measured +70 B but left the write
    // that caused the flush readable while its own render stayed stale.
    // Lanes are exempt by construction (they never enter the ordinary queue).
    // Firewall child chain doubly linked (#3351, 2026-09-10): 8.18 -> 8.22 KB,
    // measured at 8.181 (was 8.152). `_prevChild` on the signal literals (both
    // tiers) plus linkFirewallChild/unlinkFirewallChild: a projection leaf the
    // unobserved sweep drops now leaves the chain in O(1) instead of being
    // retained (with its last value) for the projection's lifetime.
    //
    // Lane authority (#3335, #3334, #3330, #3331, A15 re-rule; ported from
    // #3347 onto `next` @ 4935c7dd, 2026-09-11): 8.19 -> 8.37 KB, measured at
    // 8369 B against `next`'s 8188 (+181 B). Core-retained seams of the lane
    // fixes:
    // read()'s override arm (superseded-node selection hook), the reveal
    // carve-out gated on input visibility (three bit tests, one lane hook,
    // `heldFromStale` recording late readers for the commit replay),
    // commitPendingNode marking a still-pending node's inputs published,
    // recompute's stale-recording drop, runEffect's lane-less owner gate,
    // the provenance carrier (`origin`) captured per flight and re-armed at
    // the landing, INV-11's compare-slot term, setSignal's authoritative
    // store-landing dispatch, the contested re-derive deferred past a
    // reverting settle. The decision logic (supersession, provenance
    // comparison, lane demotion, replay gating, the landing) lives in
    // optimistic.ts and shakes out of this floor. In-package floor 22,252 ->
    // 22,737.
    //
    // Conditional pending recovery (#3371, 2026-09-11): a memo that drops
    // a pending source and recovers to an unchanged value retires that
    // source from the dependents it orphaned (settlePendingSource takes a
    // `source`; retryReaches is core-retained as the alternate-path
    // guard). +191 B minified in the in-package floor (22,457 -> 22,648);
    // measured here at 8428 B against the 8.40 KB cap.
    // Second write while an async chain is in flight (#3373/#3376, #3375,
    // #3374; 2026-09-12): 8.45 -> 8.50 KB, measured at 8471 B against
    // `next`'s 8428 (+43) — a landing retires only its own pending entry
    // (`landStatus`), a fresh flight drops inherited entries, the
    // transaction tests a source's own flight by its self entry, and the
    // stale-reader carve-out joins the reporters of a node the transaction
    // waits on. +132 B minified in the in-package floor (22,648 -> 22,780).
    // Boundary reset ends the hold (#3375 ruling, 2026-09-12): 8.50 -> 8.55 KB,
    // measured at 8507 B against 8471 (+36) — a reporter behind a collecting
    // loading boundary no longer blocks its transaction, and parked
    // transactions can be woken for re-judgement (`wokenTransitions`, entered
    // from the finally of an idle pass). +135 B minified in the in-package
    // floor (22,780 -> 22,915).
    // Held reader disposed / lane direct-commit over a stale hold (#3372,
    // #3377; 2026-09-12): 8.55 -> 8.60 KB, measured at 8556 B against 8507
    // (+49) — the disposal wake site and the lane hold drop. +58 B minified
    // in the in-package floor (22,915 -> 22,973).
    // Lane release + shared hole (#3426, #3427, #3407; 2026-09-14): 8.60 ->
    // 8.65 KB, measured at 8628 B against `next`'s 8572 (+56) — the hold
    // check prunes dead reporters itself (`sourceObserved`, shared with the
    // settle verdict and the landing), the action body's end starts the
    // correction (`_acted`, the `_endOptimism` hook from flush), and an
    // effect's recompute no longer re-enters its stamp: a landing folds in
    // every transaction waiting on the flight (`enterWaiting`) instead.
    // +137 B minified in the in-package floor (23,058 -> 23,195).
    // Held-input rules (#3408, #3410; 2026-09-14, on top of #3434): 8.65 ->
    // 8.70 KB, measured at 8685 B against `next`'s 8628 (+57) — `enterStagedRead` on read()'s value
    // selections and the deferred dependency trim; see the core floor note.
    // Overlapping flights (#3443, #3444; 2026-09-14, on top of #3442): 8.70 ->
    // 8.75 KB, measured at 8718 B against `next`'s 8691 (+27) — pending
    // propagation onto a memo another transaction HOLDS enters its
    // transaction (`initTransition` at notifyStatus's dependent walk, keyed on
    // STATUS_PENDING / a staged value, not the stamp alone), and a
    // lane-dirtied zombie runs instead of being cancelled; +54 B minified in
    // the in-package floor (23,365 -> 23,419). The first cut (stamp-only
    // entanglement) fit at 8690; the holds carve-out is what tips the cap.
    // Born held (A29 creation-time form, 2026-09-14): 8.70 -> 8.85 KB,
    // measured at 8796 B against 8691 (+105) — a memo or effect created from
    // mainline while a hold is live stages INTO the transaction instead of
    // committing (recompute), the read-side "no committed value" rule, the
    // commit-time init, and enterStagedRead's pass-scoped path (no ambient
    // entry from creation code: an unrelated write after the mount stays
    // mainline). +316 B minified in the in-package floor (23,365 -> 23,681).
    // Rebased over #3443/#3444 (2026-09-15): measured at 8820 B against
    // `next`'s 8708 (+112); 23,419 -> 23,753 minified.
    // Async landing keeps the committed frame's deps (A30 landing arm,
    // #3461, 2026-09-15): 8.85 -> 8.90 KB, measured at 8851 B against
    // `next`'s 8849 (+2, brotli noise for a moved call: asyncWrite's
    // trimStaleDeps now runs after the write, only when the landing
    // published; 0 B minified in the in-package floor, 23,752 flat).
    // Superseded source keeps blocking (#3462, 2026-09-15): transitionComplete
    // judges a reporter's source by a non-empty `_pendingSources`, not the
    // self entry alone; -2 B minified (23,750), measured at 8855 B on top of #3464 (8851).
    // A28 — writes visible at flush, read-side (2026-09-15, rebased over #3464–#3471):
    // measured at 9,102 B against `next` (+204 B). `unflushedValue` and its exemptions,
    // the flushed-value selection arms and late-linker latch, `_flushedStaged` for
    // held rewrites, CONFIG_PROMOTED, the companion re-sync at flush start (lazy
    // companions join it), the override arm's flush gate; the write-path arms are cold
    // helpers and the read sites test one module flag, keeping the write loop at
    // parity. +728 B minified in the in-package floor (23,752 -> 24,480).
    // Hold-consistency batch 2 (#3479, 2026-09-15; #3456 #3458 #3460 #3463 #3469):
    // measured at 9,266 B (+164 B on A28's 9,102). All core-retained: recompute's
    // re-park sweep over the sources a pass stopped carrying; `heldFromStale`
    // notifying a first observer's pending up its queue chain; `reporterBlocksSource`
    // walking a zombie's owner chain to the transaction staging its removal (+ the
    // `verdict` argument through `sourceObserved`); `heldTrims` deferring an unchanged
    // pass's dep trim to the flush verdict; and read()'s override arm folded to one
    // engine hook (`_overrideRead`, absorbing `_supersededRead` and carrying the lane
    // outside-view rule, whose body sheds with the engine). +358 B minified in the
    // in-package floor (24,478 -> 24,836). Golf measured: terser source compressed
    // WORSE under brotli (9,253 -> 9,301); the hook fold is the one that held.
    // Lanes stage (#3479 review, 2026-09-15): measured at 9,298 B (+32 B; 9,292 with
    // recompute's derived-override posture branch, 2026-09-16 — noise). The
    // recompute publish arm routes an optimistic-dirty memo through the
    // `_laneOverride` engine hook and its override test admits a derived one;
    // the rest (laneOverride, the derived arms in the verdict, lane and status
    // modules) sheds with the engine.
    // Reporter-liveness fix rebased over `_parent` mangling (#3495 + #3496,
    // 2026-09-16): measured at 9,379 B. The signals floor is unchanged
    // minified; the combined property names shift brotli layout.
    // A projection's leaf companions die with it; latest() of a dead leaf creates
    // none (spec O5, 2026-09-16): 9,393 B (+13 over the cap); +104 B minified in
    // owner.ts (core floor), the shadow retirement lives in verdict.ts.
    // One `unflushed` for signal and store (spec O4, 2026-09-16): 9,418 B (+18 over
    // the cap); CONFIG_ADOPTED_UNFLUSHED set at adoption, cleared by the carrying
    // flush; +56 B minified in the signals floor (25,193 -> 25,249).
    // Move 3b, one implementation per rule (#3523, 2026-09-17), rebased over
    // #3518/#3522: readerSeesCommitted / visibleOverride (step 1, merged as
    // #3515), the store's node reads through it (step 2), recordStaleReplay
    // (step 3), A29 at the store's untracked paths (step 4), S7, one ownership
    // relation ownsHold (6b) and serve() — Rule 1's one slow selection (6c).
    // Core minified: +31 (replay helper) +1 (enterStagedRead null node) +44
    // (ownsHold, not inlined) +88 (serve wrapper/parameter/guard) = +164 B.
    // Five store/signal divergences fixed (posture-store-parity S4, S5, S7, S8;
    // S6 ruled and deferred); every paired matrix state row-identical.
    // Measured at 9,489 B (+39 over the rebased cap).
    // A write is a proposal (A34, #3494 / #3519 review, 2026-09-17): 9,543 B against
    // `next`'s 9,489 (+54 B). Core-retained: `batchJoins` (a held node's
    // mainline write records the join and schedules; drained inside flush's
    // try, the fast sync path defers to it), the adoption loop's no-proposal
    // drop (signals and writable memos, through commitPendingNode), a
    // kept-tail pending mark re-deriving its subscriber (A30), and
    // reporterBlocksSource following `_pendingSources` one hop.
    // Born held exempts boundaries (A29 amended, #3540, 2026-09-18): 9,613 B
    // against `next`'s 9,567 (+46 B). Core-retained: `underFreshLoadingBoundary`
    // (the queue-chain walk to the nearest pending-collecting boundary),
    // enterStagedRead taking the staging path inside a flush for a pass under a
    // fresh boundary (the mainline and in-flush arms folded to one predicate),
    // recompute's born-held arm restaging a re-pass instead of re-queuing it
    // and telling the fresh boundary (queue.notify with a NotReadyError), and
    // `spectating` refusing the entry (enterStagedRead) and the staged-only
    // value (serve) for the boundary's priming read. +169 B minified in the
    // in-package floor (25,660 -> 25,829). Relocation measured NO-WIN: the
    // walk behind a `GlobalQueue` slot installed by boundaries.ts saved 8 B
    // here and cost the boundary-using app scenarios 50-70 B each.
    // rc.10: on follows the frame (#3540): 9,653 B against `next`'s 9,640
    // (+13 B) — the re-arm drain moves from finalizePureQueue to `flush`,
    // after the heap and before the verdict (`drainRearms()` + heap re-run;
    // `_endOptimism` moved ahead of it), and `notifyOnLane` (the display-ahead
    // swap's lane-channel notification). The DEV-only after-the-fact
    // LOADING_ON_OUTSIDE_HOLD sweep is 0 B here (its own shaken function).
    // Boundaries are not retained by this floor.
    // Lazy memo relink + dead-owner freeze (#3555, 2026-09-22): 9,685 B
    // against `next`'s 9,675 (+10 B; 15 B under the cap, which is unchanged).
    // Core-retained: `linkChild` (the one head link shared by createOwner,
    // setupComputedNode and prepareComputed's auto-dispose reawaken, with its
    // zombie guard), the freeze branch in prepareComputed (a dormant node
    // read under a disposed owner drops AUTO_DISPOSE and returns instead of
    // recomputing, #3024), and disposeChildren detaching the chain before
    // its loop, pointing each drained child's prev at itself and reading its
    // next sibling after its disposal. +63 B minified in the in-package
    // floor (26,054 -> 26,117); the rest is mangler/brotli layout.
    // Held truth masks lane passes only (#3164 ruling, #3568; 2026-09-22):
    // 9.70 -> 9.75 KB, measured at 9,711 B against `next`'s 9,685 (+26 B).
    // Core-retained: readerSeesCommitted's CONFIG_HELD_TRUTH arm gains a
    // `currentOptimisticLane !== null` term — deriving readers of held truth
    // fall through to the A29 arm instead of being served committed. +10 B
    // minified in the in-package floor (26,117 -> 26,127); the rest is brotli
    // layout. The store twin (`heldTruthMasked`) is in the store module:
    // + createStore is -5 B, isPending/latest -45 B (mangler/brotli layout).
    // A node disposed during its own pass stays disposed, the pass void
    // (#3621, 2026-09-23): 9,733 B against `next`'s 9,724 (+9 B; 17 B under
    // the cap, which is unchanged). Core-retained: recompute's `finally` mask
    // (and updateIfNecessary's) carries REACTIVE_DISPOSED — the bits are
    // free — and recompute returns on it after the body: `clearDeps` (the
    // reads after the `dispose()` call re-linked the dead node to its
    // sources), the flight retire (`_inFlight = null`, so a promise the body
    // returned after disposing lands on a retired identity), and the lane
    // restore. +72 B minified in the in-package floor (26,193 -> 26,265).
    // + createStore is -22 B, isPending/latest -5 B (mangler/brotli layout).
    // A held derivation is not a proposal (#3612, 2026-09-23): 9.75 -> 9.80
    // KB, measured at 9,792 B against `next`'s 9,733 (+59 B). Core-retained:
    // `setMemo` asks `heldDerivation` up front — the node is stamped by
    // another transaction and neither it nor its `_firewall` carries
    // REACTIVE_MANUAL_WRITE — and on a hit resolves an updater against the
    // committed value, takes the A34 join as before, and `rederiveHeld`s
    // (DIRTY + enqueue) instead of masking; updateIfNecessary's post-pull
    // wipe now carries the mask, which is state, not scheduling (a
    // `latest()` probe must not decide proposal vs prev). +150 B minified
    // in the in-package floor (26,265 -> 26,415); the store twin is in the
    // store module (see + createStore).
    limit: "9.80 KB",
    modifyEsbuildConfig
  },
  {
    name: "signals: + createStore",
    path: "../../packages/signals/dist/prod/index.js",
    import: "{ createSignal, createMemo, createEffect, createRoot, flush, createStore }",
    // 2.0.0-beta.25: +~0.7 KB from shallow stores + markRaw landing in the
    // createStore graph (the options.shallow branch retains wrapShallow /
    // applyStateShallow under tree-shaking) plus the reconcile raw-leaf
    // handling. Reviewed trade-off — see PR #2931.
    //
    // 2.0.0-beta.27: 12.5 -> 12.85 KB, measured at 12.59 KB. Not one feature:
    // correctness fixes accumulated across the store + scheduler graph, and
    // the scenario had already drifted ~30 B past the cap before this batch.
    // The identifiable additions are reconcile's container-kind guard
    // (`recursablePair`, #2946), the projection derive-swap path (#2941), and
    // the queue-traversal pass stamp that makes child disposal recoverable
    // (#2947). Each was reviewed on its own; none is shakeable, since all sit
    // on paths `createStore` always retains. Headroom is back to the ~2% the
    // sibling scenarios carry.
    //
    // 2.0.0-beta.32: 12.85 -> 13.15 KB, measured at 12.89 KB. Same shape as
    // the beta.27 bump: no single feature, ~300 B of correctness fixes
    // accumulated on always-retained store/scheduler paths since the limit
    // was set (per-commit measurement): never-wrap-platform-objects (#2952,
    // +70 B), the projection derive-swap chain (#2941, +60 B), zombie-
    // recompute cancellation for parking transitions (+60 B), bare
    // IteratorResult tolerance in async-iterable reads (+60 B), the silent-
    // recovery dependent sweep (#2949, +50 B), errored-derive memo parity
    // (#2897, +30 B), optimistic layer holds (#2951, +10 B) — offset by the
    // blocked-check shrink (-30 B) and lane-replay cleanup (-10 B). The
    // breach sat unnoticed from the first over-cap landing because this
    // gate only runs on pull_request (size.yml); direct pushes to next never
    // measure. Headroom restored to the ~2% convention.
    //
    // 2.0.0-rc: 13.15 -> 13.5 KB, measured at 13.23. Per-commit: flatten
    // promise-of-AsyncIterable (66accfb8, ~+100 B core — see the core-floor
    // note), latest() wake-only lane demotion (#3009, ~+50 B in
    // recomputeLane), effect-phase read gating (#3006, ~+20 B). All on
    // always-retained core paths.
    //
    // Store rewrite: ratcheted 13.5 -> 12.2 KB, measured at 11.98. The
    // single-implementation store (legacy deleted) plus the tree-shakeable
    // optimistic channel (injection table installed by createOptimisticStore;
    // plain-store graphs retain none of it) took −1.26 KB out of this
    // scenario. Locked in at the ~2% headroom convention.
    //
    // Stage-3 batch (pre-release ratchet): 12.2 -> 13.4 KB, measured at
    // 13.16. The core bytes from the core-floor note plus the store-side
    // O(written) work: prototype-overlay pending backings (#3044, a1b8958c),
    // the pre-shaped target constructor (c38bc24e — #3044 fields tipped
    // object targets into dictionary mode), and the written-keys notify
    // bound (2888642e). All on paths createStore always retains.
    //
    // Projection transition isolation (#3074/#3075): 13.4 -> 13.5 KB,
    // measured at 13.40 exactly. The held-view mask (adoption under a live
    // transition serves the pre-hold committed backing to untracked readers)
    // plus the latest() pull in the get trap. Not shakeable: the derived
    // createStore overload retains projection machinery in every store graph
    // (see treeshake.test.ts) — an injection-table split was measured and
    // came out LARGER under brotli (indirection adds unique tokens).
    //
    // Stage-2 patch channel: 13.5 -> 14.1 KB (measured 13.71 pre-#3074, ~13.8
    // with the held-view bytes). The channel itself is pay-for-use (emitters
    // ride hooks installed at first registration — patch-hooks.ts — and
    // shake out of this scenario); the ~490 B here are the write-path SEAMS
    // that must live on always-retained trap/walk/fold code: the `pc`
    // extension + guards at every emission site, the setter-channel row-ops
    // branch in drainFolds, and the fold-commit family emission. Compare the
    // app-floor scenarios below, which carry only the ~100 B insert seam.
    //
    // Re-audit-2 correctness batch + upstream drift: 14.1 -> 14.35 KB
    // (measured 14.31). Occurrence-aware key matching (adoption window +
    // buildRowOps queues, SameValueZero everywhere keys compare), the
    // same-batch coalescing stamp (pc.qa/ql + pushSelf), adoption-seam
    // accessor demotion gates, and unhandled-halt parity; the rest is
    // upstream core drift (#3082's visibility gate, the shared notifier,
    // #3078's dormancy sweep) since the 14.1 ratchet.
    //
    // Fold scheduling (#3089, merged from next): 14.35 -> 14.45 KB. The
    // always-arm in queueFold (the size-gated arm stranded later folds), the
    // write-time transition stamp (foldBatches WeakMap + ensurePB stamp), and
    // the drain's defer check — ~40 B measured on the pre-stage-2 base. All
    // load-bearing correctness on paths createStore always retains.
    //
    // #3122/#3123 correctness batch (2026-08-31): 14.45 -> 14.51 KB,
    // measured at 14.503. The #3122 teardown core bytes plus the store-walk
    // exports (arrayStructureChanged/membershipChanged) the landing-
    // contradiction gate reads; the replay machinery itself stays in the
    // optimistic module (see the store-family app scenario).
    //
    // #3164 fold ruling (2026-08-31): 14.51 -> 14.56 KB, measured at 14.55.
    // The core-floor arm (see that note) plus the held-truth mask SEAMS on
    // always-retained store paths: nodeValue's guarded _heldTruthMasked
    // call, readSource's optHooks.retainsOptimism dispatch, and the
    // tentativePBs draft-session guard in ensurePB. The mask bodies
    // themselves ride the optimistic module (see the store-family app
    // scenario).
    //
    // Fold relocation pass (2026-09-01): 14.56 -> 14.55 KB, measured at
    // 14.54 — the core-floor relocation (see that note).
    //
    // Patch-channel removal (2026-09-02): 14.66 -> 14.05 KB, measured at
    // 14.00. The channel is deleted from next — regions own value delivery,
    // the unified-For design owns structure — reclaiming the write-path seams, wk struct indirection, and reconcile row-ops builders.
    //
    // Store create-floor diet (2026-09-04): 14.05 -> 14.16 KB, measured at
    // 14.155. slotSignal (the pre-shaped store-leaf literal: _host/_key
    // backrefs replacing the per-node options object, equals closure,
    // unobserved closure, and NodeExtension) plus the get trap's first-read
    // dedupe (one descriptor probe threaded to node creation, one node-map
    // lookup, first-read wrap-cache population). ~105 B of retained code
    // that deletes four allocations + three hidden-class transitions per
    // store leaf: getNode self-time −23%, get-trap self-time −19%, dbmon
    // mount min −4%. Conscious speed-for-bytes trade, same ruling as the
    // Stage-3 hot-path batch.
    //
    // Store correctness batch (2026-09-04): 14.16 -> 14.20 KB, measured at
    // 14.197 on Linux CI (14.19 macOS). The livestream-found fixes on
    // always-retained store paths: the first-flight transaction carve-out
    // (#3264), the held-manual-write re-ask classification (#3265), the
    // draft compose-read gate (#3266, its dev-only sibling #3263 costs
    // nothing in prod), plus routing async setter errors through the node's
    // error state (#3262, handleAsync). A golf pass was attempted and
    // measured: extracting the repeated compose-gate/override-read into
    // helpers came out +29 B, fully inlining the #3266 helper +70 B, and
    // merging the has-trap's twin override arms −1 B here but +7 B on the
    // store-family app — the graph sits at its brotli optimum post-#3270
    // (repeats compress free; indirection adds unique tokens). Ratcheted,
    // not golfed.
    //
    // Fold privatization merge (#3271): 14.20 -> 14.29 KB, measured at
    // 14.282 macOS (Linux typically +~7 B on this scenario). Clone-path
    // folds finding their container privatized mid-batch (a descendant fold
    // path-copied through them) merge written keys in place instead of
    // swapping in the stale ensurePB clone — the swap orphaned the
    // ancestor's writes (parent CAS failed against the privatization
    // clone). Silent data loss on writable projections; load-bearing.
    //
    // rc.6 P1 store sweep (#3282/#3283/#3284): 14.29 -> 14.35 KB, measured
    // at 14.35 macOS. Three corruption/disconnection fixes: identity-
    // resolved parent-slot keys at fold time (wrap-time pk goes stale when
    // arrays move — an edited moved row folded onto a sibling's slot),
    // family-map registration of privatization clones (derived stores
    // orphaned ancestor observers and broke proxy identity), and the #3044
    // overlay key merge in deep()'s walk (mid-flush re-walks dropped every
    // untouched child from the effect's dependency set). All fold-time or
    // deep()-only paths — no hot read/write cost.
    //
    // Tracked-effect wakes ride the heap (#3291, 2026-09-06): 14.35 -> 14.42
    // KB, measured at 14.391 macOS (+45 B). Not retained code: the tracked
    // special case in enqueueSub is DELETED and GlobalQueue._update gains a
    // four-line branch; the signals core floor is 75 B SMALLER minified
    // (21,536 -> 21,461). Brotli layout drift on this scenario's output —
    // the other seven scenarios moved -28…+21 B in both directions. Capped
    // with ~30 B of Linux headroom (cf. the simple-app cap, 2026-09-05).
    //
    // Adoption diffs against the pending view (#3296, 2026-09-06): measured
    // at 14374 macOS — 17 B UNDER the pre-fix 14391, cap unchanged. The
    // adoption diff base is the view the nodes were last told (the draft's
    // pending backing when one preceded the adoption), carried to the
    // deferred fold in the slot that was the boolean `adopted` flag; the
    // eager reconcile path reads `prev` it already had. An interim cancel
    // pass (+44 B) was replaced by this before release.
    // Contested-effect re-derivation (#3322, 2026-09-09): 14.42 -> 14.52 KB,
    // measured at 14.49. Core scheduler cost; see the core-floor note.
    // Effect ownership on finalize re-entry (#3319, 2026-09-09): 14.52 KB -> 14.60 KB,
    // measured at 14.559. Core scheduler cost; see the core-floor note.
    // deep()/identity over chained views (#3323, 2026-09-09): 14.60 KB -> 14.70 KB,
    // measured at 14.663. resolveChainedRaw (a chained target's pending-backing
    // child resolves to the inner family's proxy — reachable from serveDataKey,
    // so every store bundle carries it; chaining is not optimistic-only), the
    // snapshot's wrapper redirect below chained families, and the ownKeys /
    // getOwnPropertyDescriptor trap bodies extracted into visibleKeys /
    // visibleDescriptor so the deep() walk shares them.
    // Projection root writes on the overlay path (#3352, 2026-09-10): 14.70 ->
    // 14.75 KB, measured at 14.696 (was 14.654; brotli layout swung equivalent
    // variants 14.658–14.700). ensurePB's overlay
    // eligibility widens to non-optimistic families (chained backings stay on
    // the clone), the overlay flatten is a shared helper the write-override
    // landing now calls instead of swapping the backing, and privatizeCommitted
    // CASes the parent slot (a pre-existing overlay bug: a child flatten
    // resurrected a slot the parent's earlier fold had replaced or deleted).
    // Firewall child chain doubly linked (#3351, 2026-09-10): 14.75 -> 14.83 KB,
    // measured at 14.776 (was 14.696). The core-floor arm plus the slot-node
    // literal's `_prevChild` and the unlink calls in the four unobserved
    // hooks (value, presence, key-set, deep witness).
    // Narrow-store write floor (#3360, 2026-09-10): 14.83 -> 14.97 KB,
    // measured at 14.921 (was 14.770). The scan grade + own-key count on
    // the target, the spread arm in cloneRaw, the width/ownership gate on
    // the overlay, and the bare-assignment arms in the set trap and
    // flatten. Buys 1.85x on per-write cost (629 -> 340 ns steady state).
    // Ownership stamp (#3360 part two, 2026-09-10): 14.97 -> 15.06 KB,
    // measured at 15.012 (was 14.921). Owned backings carry `$OWNER` instead
    // of two weak-collection registrations per draft: the stamp-first
    // lookup helper, the stamp filter in the ownKeys trap / snapshot /
    // membership diff / key walks, and the trap guards. 340 -> ~178 ns.
    //
    // Lane authority (#3335, #3334, #3330, #3331, A15 re-rule; ported from
    // #3347 onto `next` @ 4935c7dd, 2026-09-11): 15.01 -> 15.32 KB, measured
    // at 15318 B against `next`'s 15012 (+306 B). The core seams (see the
    // core floor note)
    // plus the store twins: held adoption under a live transaction on
    // optimistic families (`heldMaskView`, `stageHeldAdoptions`),
    // `notifyOptimisticWrites` judging against the view readers see, and
    // the authoritative landing on an override-covered node dispatching to
    // the engine.
    // Second write while an async chain is in flight (#3373–#3376,
    // 2026-09-12): 15.35 -> 15.45 KB, measured at 15413 B against `next`'s
    // 15340 (+73 — the core seams, see the core floor note).
    // #3372/#3377 (2026-09-12): 15.45 -> 15.50 KB, measured at 15485 B against 15427
    // (+58); see the core floor note.
    // Companion lane parented (#3379, 2026-09-12): 15.50 -> 15.55 KB, measured
    // at 15522 B against 15485 (+37 brotli on a -4 B minified reorder — the
    // statement moved across a block boundary; noise, not weight).
    // Held children (#3404, 2026-09-13): 15.55 -> 15.60 KB, measured at
    // 15552 B on the merge with `next` — CONFIG_HELD_CHILDREN set/cleared
    // around recompute and commitPendingNode.
    // Effect arm of A30 (#3438, 2026-09-14): 15.60 -> 15.65 KB, measured at
    // 15636 B against `next`'s 15580 (+56 brotli on +35 B minified — the
    // `_modified` gate on recompute's trim and runEffect's trim); see the
    // core floor note.
    // Memo lane posture (#3442, 2026-09-14): no bump, measured at 15624 B on
    // the rebase over #3438 (+12 B minified — one assignment in recompute's
    // head; brotli noise absorbs it; see the core floor note).
    // Overlapping flights (#3443, #3444; 2026-09-14, on top of #3442): 15.65 ->
    // 15.70 KB, measured at 15679 B — pending propagation onto a held memo enters
    // its transaction, and a lane-dirtied zombie runs instead of being
    // cancelled (+54 B minified in the in-package floor); see the core floor note.
    // Born held (2026-09-14): 15.65 -> 15.80 KB, measured at 15750 B against
    // 15624 (+126); rebased over #3443/#3444: 15743 B against `next`'s 15658
    // (+85); see the core floor note.
    // #3454 + #3455 together (2026-09-15): 15.80 -> 15.85 KB, measured at 15809 B
    // on `next` a8a89497. Each fit alone (#3454's lazy merge/omit views in
    // store/utils; #3455's verdict/optimistic changes measured 15780 against
    // the pre-#3454 `next`) — the union tipped the cap by 9 B after both
    // merged.
    // A28 — writes visible at flush, read-side (2026-09-15): measured at 16,155 B
    // against `next` (+305 B); the signals core delta, see the core floor note.
    // A pending reporter recovering without its flight landing wakes its parked
    // transaction (fuzzer #3446 P1, spec O3, 2026-09-16): measured at 16,201 B
    // (+1 over the cap); +100 B minified in the signals floor (24,478 -> 24,578).
    // Hold-consistency batch 2 (#3479, 2026-09-15): measured at 16,343 B; the signals
    // core delta, see the core floor note.
    // A projection's leaf companions die with it; latest() of a dead leaf creates
    // none (spec O5, 2026-09-16): 16,481 B (+31 over the cap); +104 B minified in
    // owner.ts (core floor), the shadow retirement lives in verdict.ts.
    // Released leaves leave the companion set (#3503, 2026-09-16): rebased over
    // the O5 fix, measured at 16,493 B against `next`'s 16,481 (+12 brotli for
    // `_companionChildren?.delete(n)` in unlinkFirewallChild). The 16.50 KB cap
    // is unchanged; core floor and isPending/latest scenarios are unchanged.
    // Hydration claim-path trim (#3513, 2026-09-17): measured at 16,517 B against
    // current `next`'s 16,495 (+22). The fixed-shape `_snapshotValue` cleanup
    // replaces `delete` with assignment; the pure core floor shrinks by 1 B.
    // Shared read predicates (DESIGN-CONSOLIDATION move 3b step 1, 2026-09-17):
    // readerSeesCommitted / visibleOverride / one hasActiveOverride. Minified
    // signals: core +13 B, +createStore -38 B, full bundle -72 B; brotli on the
    // pure-signals fixtures -4 / -29 / -5 B. This scenario's esbuild bundle
    // measured at 16,509 B rebased over #3507, against `next`'s 16,517 (-8 B).
    // Move 3b, one implementation per rule (#3523, 2026-09-17), rebased over
    // #3518/#3522: readerSeesCommitted / visibleOverride (step 1, merged as
    // #3515), the store's node reads through it (step 2), recordStaleReplay
    // (step 3), A29 at the store's untracked paths (step 4), S7, one ownership
    // relation ownsHold (6b) and serve() — Rule 1's one slow selection (6c).
    // Core minified: +31 (replay helper) +1 (enterStagedRead null node) +44
    // (ownsHold, not inlined) +88 (serve wrapper/parameter/guard) = +164 B. +55 B store (S7, an optimistic override survives its key becoming
    // unobserved), +123 / +130 B store (S4 / S5 fixes at the backing and the
    // untracked node paths).
    // Five store/signal divergences fixed (posture-store-parity S4, S5, S7, S8;
    // S6 ruled and deferred); every paired matrix state row-identical.
    // Measured at 16,610 B (+60 over the rebased cap).
    // A write is a proposal (A34, #3494 / #3519 review, 2026-09-17): 16,645 B against
    // `next`'s 16,574 (+71 B). Core-retained: `batchJoins` (a held node's
    // mainline write records the join and schedules; drained inside flush's
    // try, the fast sync path defers to it), the adoption loop's no-proposal
    // drop (signals and writable memos, through commitPendingNode), a
    // kept-tail pending mark re-deriving its subscriber (A30), and
    // reporterBlocksSource following `_pendingSources` one hop.
    // The descriptor trap subscribes to the key's presence node and witnesses
    // isPending()/affects() as `in` does (structural oracle, 2026-09-17):
    // +3 B brotli over the cap, measured at 16,703 B.
    // Born held exempts boundaries (#3540, 2026-09-18): 16,759 B against
    // `next`'s 16,707 (+52 B) — the core floor's +46 B (see its note); 0 B in
    // the store.
    // `on` re-arms at the flush's finalize (#3540, 2026-09-21): 16,811 B,
    // +11 B over the cap — the scheduler's `pendingRearms` set, `queueRearm`,
    // the finalize drain and the simple-sync-flush gate (+58 B minified in
    // the signals core).
    // rc.10: on follows the frame (#3540): 16,793 B against `next`'s 16,811
    // (-18 B) — the core floor's drain move (see its note); the rest is the
    // prop mangler handing out different short names. 0 B in the store.
    // LOADING_ON_OUTSIDE_HOLD same-source only (#3584, 2026-09-22): 16.85 ->
    // 16.90 KB, measured at 16,866 B against `next`'s 16,805 (+61 B). The
    // after-the-fact DEV sweep and the `_swapUnseen` field are gone (−9 B
    // prod in boundaries.ts, 0 B in the scheduler); boundaries are not
    // retained here and this scenario's minified bundle is the same byte
    // count as `next`'s — the delta is the prop mangler handing out
    // different short names package-wide once two `_` props left the class,
    // and the brotli layout that follows. 0 B in the store.
    // ssrElement/merge at the writer floor (#3562, 2026-09-22): rebased over
    // #3584, measured at 16,891 B against `next`'s 16,866 (+25 B; 9 B under
    // the cap, which is unchanged): merge()'s presized source arrays and the
    // `$RECORD` classification of proxy sources in store/utils.ts (a view
    // answers its record, the store's symbol fast path answers undefined; the
    // `$SOURCES` / `$OMIT` / `$VIEW` probes are gone). No core source change;
    // the core floor is 0 B, and isPending/latest's +31 B, the every-store-
    // family app's +32 B and CSR observe's +11 B are the prop mangler's
    // short-name assignment and the brotli layout that follows.
    // Lazy memo relink + dead-owner freeze (#3555, 2026-09-22): 16.90 ->
    // 16.95 KB, measured at 16,903 B against `next`'s 16,891 (+12 B):
    // linkChild on reawaken, the freeze branch in prepareComputed, and
    // disposeChildren's post-disposal sibling read (+63 B minified in the
    // signals core, see the core floor note); the rest is mangler/brotli
    // layout. 0 B in the store.
    // Draft valid until superseded or disposed (#3585, proj R37,
    // 2026-09-22): 16,921 B against `next`'s 16,908 (+13 B; 29 B under the
    // cap, which is unchanged). Core: `schedule()` records the microtask it
    // withholds under projectionWriteActive and `scheduleWithheld` re-arms
    // it (+83 B minified in the scheduler). Store: the per-run token on the
    // family, `isDisposed(owner)` in the draft gate, and the after-write
    // arming closure, paid for by folding the three mutating draft traps
    // onto one bracket and dropping the run-returned gate on the arming
    // (the derive body only runs outside a flush at creation, and a
    // top-level sync projection stranded the scheduler behind it): -23 B
    // minified in projection.js. The core floor does not retain
    // `scheduleWithheld` (+8 B, layout).
    // A held derivation is not a proposal (#3612, 2026-09-23): 16.95 -> 17.10
    // KB, measured at 17,060 B against `next`'s 16,927 (+133 B). Core: the
    // `heldDerivation` / `rederiveHeld` pair behind `setMemo` (+150 B
    // minified, see the core floor note). Store: `derivedStoreWrite` wraps
    // the derived setter — `notifyWrites` records a leaf whose `_firewall` is
    // the setter's node and is held by another transaction, and the wrap's
    // `finally` re-derives on a hit, masks otherwise (the pre-existing
    // mask-after ordering). The mask is asked per leaf so the discriminator
    // does not live in `setSignal`, which async landings also call.
    limit: "17.10 KB",
    modifyEsbuildConfig
  },
  {
    name: "signals: + isPending/latest",
    path: "../../packages/signals/dist/prod/index.js",
    import: "{ createSignal, createMemo, createEffect, createRoot, flush, isPending, latest }",
    // loadingValue (commit #0): 8.75 -> 9 KB, measured at 8.84 KB — the same
    // core-floor bytes (see above); the verdict layer itself only gained a
    // comment (the window is verdict-quiet by design, no code).
    //
    // 2.0.0-rc: 9 -> 9.2 KB, measured at 9.01 — the same core bytes as the
    // core-floor note (flatten + #3006) plus the #3009 demotion, which lives
    // in the optimistic module this scenario retains via latest().
    //
    // Missed-wake fix (#3037): 9.2 -> 9.3 KB, measured at 9.24. ~45 B on
    // always-retained paths: the insertSubs latch (gen-current, non-tail
    // link writes on RECOMPUTING subs), recompute's capture + reschedule
    // tail, and the updateIfNecessary reentrancy guard (nested mapArray
    // rows reading the outer store mid-derive re-entered recompute and
    // corrupted dep bookkeeping). None shakeable — all sit on the core
    // notification/recompute loop.
    //
    // Stage-3 batch (pre-release ratchet): 9.3 -> 9.85 KB, measured at
    // 9.67 — the core-floor batch (see that note) plus the #3042 latest()
    // companion mid-transition backfill, which lives in the optimistic
    // module this scenario retains via latest().
    //
    // rc.5 signals drift (2026-08-30): 9.85 -> 9.9 KB, measured at 9.87.
    // The #3108 truth-author authoritative-read fix (88fa9d64) lives in the
    // optimistic module this scenario retains via latest(), and the
    // refresh() quiescence promise (51ffcb9a) leaves marks on the settle
    // walk. Drift, not a regression.
    //
    // #3104/#3122 correctness batch (2026-08-31): 9.9 -> 9.94 KB, measured
    // at 9.932. The latest()/collectPending probe-suspension symmetry
    // (#3104) lives in the verdict layer this scenario exists to measure;
    // the rest is the #3122 teardown core bytes.
    //
    // #3164/#3166 batch (2026-08-31): 9.94 -> 9.99 KB, measured at 9.98.
    // The core-floor fold arm (see that note), asyncWrite's authoritative-
    // observer wake (#3164 signal path: a landing staged under an active
    // override must wake until()'s predicate or it deadlocks), and the
    // mid-flight latest(isPending()) probe fix (#3166) in the verdict
    // layer this scenario retains.
    //
    // Fold relocation pass (2026-09-01): 9.99 -> 9.98 KB, measured at 9.97
    // — the core-floor relocation (see that note).
    //
    // Patch-channel removal (2026-09-02): 10.10 -> 10.04 KB, measured at
    // 10.01. The channel is deleted from next — regions own value delivery,
    // the unified-For design owns structure — reclaiming the optimistic emission seams retained via latest().
    //
    // Store correctness batch (2026-09-04): 10.04 -> 10.05 KB, measured at
    // 10.043 on Linux CI (10.03 macOS) — this scenario pays only the #3262
    // handleAsync try/catch and the #3265 re-ask line (see the createStore
    // note for the batch and the measured no-win golf pass).
    //
    // Uninitialized cross-lane suspension (#3276/#3277): 10.05 -> 10.08 KB,
    // measured at 10.058 macOS. The check rides laneSuspends in the
    // optimistic module — which THIS scenario retains via latest()'s
    // optimisticComputed shadow — rather than core read()'s throw path:
    // the original inline placement cost 27-66 B across five scenarios
    // (createStore, both floors, family, CSR); relocated, every other
    // scenario is unchanged and only this one pays ~8 B.
    //
    // Lane hold on observation (#3289): 10.08 -> 10.13 KB, measured at
    // 10.080 macOS (baseline 10.040). laneHeld — a lane is held only by
    // async a render effect observed (the transaction's reporter map), the
    // same INV-3 rule transactions use — lives in the lanes module this
    // scenario retains via latest(); the core floor and createStore are
    // byte-identical. ~40 B for the predicate and its two call sites.
    //
    // Dead companion refresh removed (follow-up): 10.13 -> 10.10 KB,
    // measured at 10.062 macOS. laneAsyncPending/laneAsyncSettled refreshed
    // the lane source's isPending companion on every derived pending/settle,
    // but computePendingState never read _pendingAsync — the source's own
    // write, commit and settlement paths already refresh it. -18 B.
    // Contested-effect re-derivation (#3322, 2026-09-09): 10.10 -> 10.17 KB,
    // measured at 10.14. Core scheduler cost; see the core-floor note.
    // Effect ownership on finalize re-entry (#3319, 2026-09-09): 10.17 KB -> 10.27 KB,
    // measured at 10.237. Core scheduler cost; see the core-floor note.
    // Firewall child chain doubly linked (#3351, 2026-09-10): 10.27 -> 10.32 KB,
    // measured at 10.272. Core cost; see the core-floor note.
    //
    // Lane authority (#3335, #3334, #3330, #3331, A15 re-rule; ported from
    // #3347 onto `next` @ 4935c7dd, 2026-09-11): 10.25 -> 10.67 KB, measured
    // at 10667 B against `next`'s 10253 (+414 B). The core seams (see the
    // core floor note)
    // plus the engine they dispatch to, which this scenario retains:
    // override supersession with action provenance (`supersedeOverride`,
    // `supersededRead`, the same-value stamp renewal), the authoritative
    // store landing (`landOnOverride`), the per-node merged-lane hold
    // (`laneHeld` over `waitingTransition`), `laneLive`, and the
    // lane-routed settle entering the waiting transaction.
    //
    // Conditional pending recovery (#3371, 2026-09-11): a memo that drops
    // a pending source and recovers to an unchanged value retires that
    // source from the dependents it orphaned (settlePendingSource takes a
    // `source`; retryReaches is core-retained as the alternate-path
    // guard). +191 B minified in the in-package floor (22,457 -> 22,648);
    // measured here at 10713 B against the 10.70 KB cap.
    // Second write while an async chain is in flight (#3373–#3376,
    // 2026-09-12): 10.75 -> 10.82 KB, measured at 10784 B against `next`'s
    // 10713 (+71 — the core seams, see the core floor note).
    // Boundary reset ends the hold (#3375 ruling, 2026-09-12): 10.82 -> 10.85 KB,
    // measured at 10820 B against 10784 (+36); see the core floor note.
    // #3372/#3377 (2026-09-12): 10.85 -> 10.90 KB, measured at 10857 B against 10820
    // (+37); see the core floor note.
    // #3426/#3427/#3407 (2026-09-14): 10.90 -> 11.05 KB, measured at 11018 B
    // against `next`'s 10897 (+121 — the core seams plus `endOptimism` in the
    // optimistic module this scenario loads); see the core floor note.
    // Overlapping flights (#3443, #3444; 2026-09-14, on top of #3442): 11.05 ->
    // 11.10 KB, measured at 11066 B — pending propagation onto a held memo enters
    // its transaction, and a lane-dirtied zombie runs instead of being
    // cancelled (+54 B minified in the in-package floor); see the core floor note.
    // Born held (2026-09-14): 11.05 -> 11.25 KB, measured at 11196 B against
    // 11050 (+146 — the core seams plus the verdict pulls' `_verdictPull`
    // brackets and supersededRead's entry); rebased over #3443/#3444: 11213 B
    // against `next`'s 11084 (+129); see the core floor note.
    // Body-end visibility + latest() seed (#3455, 2026-09-15): 11.25 -> 11.30 KB,
    // measured at 11267 B against `next`'s 11213 (+54) — `supersededRead`
    // resolves the override owner and enters for a committed truth too, the
    // verdict's body-end A18 (d) branch, and `uninitializedSource`'s owner
    // walk; all in the verdict/optimistic modules this scenario retains
    // (core floor 8820 -> 8832, +createStore 15743 -> 15780, both in cap).
    // A28 — writes visible at flush, read-side (2026-09-15): measured at 11,639 B
    // against `next` (+339 B); the signals core delta, see the core floor note.
    // Hold-consistency batch 2 (#3479, 2026-09-15): measured at 11,793 B; the signals
    // core delta, see the core floor note.
    // Lanes stage (#3479 review, 2026-09-15): measured at 11,959 B (+166 B). A lane
    // pass publishes a memo's speculative result into the override slot
    // (`laneOverride`), and the override lifecycle learns the derived kind:
    // promote-on-revert, skipped by the body-end supersession and the
    // authoritative-blockage census, merged through and suspended on in lanes,
    // pending flowing through it in status. Retained here by `latest()`.
    // A projection's leaf companions die with it; latest() of a dead leaf creates
    // none (spec O5, 2026-09-16): 12,074 B (+24 over the cap); +104 B minified in
    // owner.ts (core floor), the shadow retirement lives in verdict.ts.
    // One `unflushed` for signal and store (spec O4, 2026-09-16): 12,124 B (+24 over
    // the cap); CONFIG_ADOPTED_UNFLUSHED set at adoption, cleared by the carrying
    // flush; +56 B minified in the signals floor (25,193 -> 25,249).
    // Move 3b, one implementation per rule (#3523, 2026-09-17), rebased over
    // #3518/#3522: readerSeesCommitted / visibleOverride (step 1, merged as
    // #3515), the store's node reads through it (step 2), recordStaleReplay
    // (step 3), A29 at the store's untracked paths (step 4), S7, one ownership
    // relation ownsHold (6b) and serve() — Rule 1's one slow selection (6c).
    // Core minified: +31 (replay helper) +1 (enterStagedRead null node) +44
    // (ownsHold, not inlined) +88 (serve wrapper/parameter/guard) = +164 B.
    // Five store/signal divergences fixed (posture-store-parity S4, S5, S7, S8;
    // S6 ruled and deferred); every paired matrix state row-identical.
    // Measured at 12,188 B (+38 over the rebased cap).
    // A write is a proposal (A34, #3494 / #3519 review, 2026-09-17): 12,285 B against
    // `next`'s 12,188 (+97 B). Core-retained: `batchJoins` (a held node's
    // mainline write records the join and schedules; drained inside flush's
    // try, the fast sync path defers to it), the adoption loop's no-proposal
    // drop (signals and writable memos, through commitPendingNode), a
    // kept-tail pending mark re-deriving its subscriber (A30), and
    // reporterBlocksSource following `_pendingSources` one hop.
    // Born held exempts boundaries (#3540, 2026-09-18): 12,367 B against
    // `next`'s 12,253 (+114 B). The core floor's +46 B (see its note), and
    // the verdict layer pays for `spectating` at serve's staged-only arm
    // beside its own `_verdictPull` gate in enterStagedRead (the two gates
    // are now tested together in one predicate).
    // rc.10: on follows the frame (#3540): 12,370 B against `next`'s 12,391
    // (-21 B) — the core floor's drain move (see its note); the rest is the
    // prop mangler handing out different short names.
    // A pending fallback's boundary is judged before the verdict (#3540,
    // 2026-09-22): 12.40 -> 12.45 KB, measured at 12,431 B against `next`'s
    // 12,393 (+38 B), rebased over #3577 — the flush's pre-verdict
    // `checkBoundaryChildren(this, true)` walk and heap re-run (core;
    // boundaries are not retained here).
    // Lazy memo relink + dead-owner freeze (#3555, 2026-09-22): 12.45 ->
    // 12.50 KB, measured at 12,479 B against `next`'s 12,428 (+51 B):
    // linkChild on reawaken, the freeze branch in prepareComputed, and
    // disposeChildren's post-disposal sibling read (+63 B minified in the
    // signals core, see the core floor note); the verdict layer is
    // untouched, so the +41 B over the core floor's own delta is
    // mangler/brotli layout over the larger bundle.
    // A held derivation is not a proposal (#3612, 2026-09-23): 12.50 -> 12.55
    // KB, measured at 12,534 B against `next`'s 12,459 (+75 B): the signals
    // core's `heldDerivation` / `rederiveHeld` behind `setMemo` and the
    // mask-preserving post-pull wipe in updateIfNecessary (+150 B minified,
    // see the core floor note); the rest is mangler/brotli layout.
    limit: "12.55 KB",
    modifyEsbuildConfig
  },
  {
    name: "app: render + one signal (the simple-app floor)",
    // Missed-wake fix (#3037): the pinned 10 KB floor gives way to a P0
    // correctness hole — writes landing beneath a subscriber's own recompute
    // were silently swallowed (heap refuses RECOMPUTING nodes), leaving
    // projections permanently stale. Measured at 10.06 after a dedupe pass
    // (insertSubs loop `_sub` hoist); the remaining ~58 B is the latch, the
    // recompute reschedule tail, and the reentrancy guard — see the
    // isPending/latest note.
    //
    // Stage-3 batch (pre-release ratchet): 10.1 -> 10.55 KB, measured at
    // 10.34. Entirely the signals-core bytes from the core-floor note —
    // the app growth across all four app scenarios tracks the signals
    // scenarios byte-for-byte (the linked dom-expressions runtime updates
    // contributed ~nothing to the client bundles).
    //
    // Upstream drift ratchet (2026-08-27): the shared effect notifier's
    // always-retained core bytes ate the last headroom (measured 10.56).
    // +50 B of cap, not a feature.
    //
    // next merge (2026-08-28): 10.6 -> 10.65 KB, measured at 10.61 — the
    // branch's insert seam plus next's post-cap drift summing in the same
    // floor.
    //
    // rc.5 signals drift (2026-08-30): 10.65 -> 10.7 KB, measured at 10.66.
    // The refresh() quiescence promise's settle-walk bytes (51ffcb9a) are
    // core-retained, so every app floor pays them. Drift, not a regression.
    //
    // #3164 fold ruling (2026-08-31): 10.7 -> 10.73 KB, measured at 10.72
    // — the signals core-floor arm + asyncWrite wake (see those notes).
    //
    // Fold relocation pass (2026-09-01): 10.73 -> 10.72 KB, measured at
    // 10.71 — the core-floor relocation (see that note).
    //
    // In-place class mutation fix (#3188): 10.80 -> 10.84 KB, measured at
    // 10.834. className() retains the last applied object/array snapshot so
    // shared-reference reruns can diff mutations without deleting external
    // classes.
    path: "minimal-app.js",
    //
    // Patch-channel removal (2026-09-02): 10.86 -> 10.73 KB, measured at
    // 10.70. The channel is deleted from next — regions own value delivery,
    // the unified-For design owns structure — reclaiming the core-retained emission seams.
    // Preload identity canonicalization, rebased onto next (2026-09-02):
    // 10.73 -> 10.74 KB, measured at 10.731 against next's 10.700 with only
    // dist/web.js swapped. Not retained code: the tree-shaken bundle is
    // byte-identical and web.js contributes the same 7106 minified bytes on
    // both sides. head.ts gains two top-level helpers this bundle never
    // reaches (asciiLowerCase, qualifierValue), which shifts esbuild's
    // identifier allocation over the same-length output — brotli layout
    // drift, 31 B. Ratcheted to the next 0.01 kB per this file's rule.
    // Tracked-effect wakes ride the heap (#3291, 2026-09-06): 10.74 -> 10.78
    // KB, measured at 10.751 macOS (+21 B; brotli drift — the minified core
    // shrank, see the createStore note). Linux CI has measured ~23 B above
    // macOS on this scenario, hence the extra 0.02 kB.
    // Contested-effect re-derivation (#3322, 2026-09-09): 10.78 -> 10.85 KB,
    // measured at 10.82. Core scheduler cost; see the core-floor note.
    // Effect ownership on finalize re-entry (#3319, 2026-09-09): 10.85 KB -> 10.92 KB,
    // measured at 10.883. Core scheduler cost; see the core-floor note.
    // Incremental heap marking (#3350, 2026-09-10): 10.92 -> 10.96 KB,
    // measured at 10.924 against next's 10.895. A one-call swap in
    // insertIntoHeap (`heap._marked = false` -> `markNode(n)`, dropping the
    // DIRTY test markNode already performs); createStore and isPending
    // scenarios both shrank on the same build, so the +29 B here is brotli
    // layout drift, not retained code.
    //
    // Lane authority (#3335, #3334, #3330, #3331, A15 re-rule; ported from
    // #3347 onto `next` @ 4935c7dd, 2026-09-11): 10.92 -> 11.12 KB, measured
    // at 11121 B against `next`'s 10924 (+197 B) — the core seams (see the
    // core floor note)
    // and, where the app retains lanes, the engine they dispatch to.
    // Second write while an async chain is in flight (#3373–#3376,
    // 2026-09-12): 11.15 -> 11.25 KB, measured at 11212 B against `next`'s
    // 11145 (+67 — the core seams, see the core floor note).
    // Boundary reset ends the hold (#3375 ruling, 2026-09-12): 11.25 -> 11.30 KB,
    // measured at 11243 B against 11212 (+31); see the core floor note.
    // #3372/#3377 (2026-09-12): 11.30 -> 11.35 KB, measured at 11295 B against 11243
    // (+52); see the core floor note.
    // #3426/#3427/#3407 (2026-09-14): 11.35 -> 11.40 KB, measured at 11368 B
    // against `next`'s 11322 (+46); see the core floor note.
    // Held-input rules (#3408, #3410; 2026-09-14, on top of #3434): 11.40 ->
    // 11.45 KB, measured at 11417 B against `next`'s 11368 (+49) — `enterStagedRead` on read()'s value
    // selections and the deferred dependency trim; see the core floor note.
    // Born held (A29 creation-time form, #3451; 2026-09-15): 11.45 -> 11.65 KB,
    // measured at 11566 B against `next`'s 11407 (+159); the signals-core
    // bytes from the core floor note, nothing app-side.
    // A28 — writes visible at flush, read-side (2026-09-15): measured at 11,829 B
    // against `next` (+179 B); the signals core delta, see the core floor note.
    // Hold-consistency batch 2 (#3479, 2026-09-15): measured at 11,974 B; the signals
    // core delta, see the core floor note.
    // Lanes stage (#3479 review, 2026-09-16): 12.05 -> 12.15 KB, measured at
    // 12,075 B rebased over #3488 (its +100 B minified reporter wake, in cap on
    // `next` by 1 B, plus this PR's +139 B core-retained arms — see the
    // treeshake ceiling note); the signals core delta, nothing app-side.
    // One `unflushed` for signal and store (spec O4, 2026-09-16): 12,200 B (+50 over
    // the cap); CONFIG_ADOPTED_UNFLUSHED set at adoption, cleared by the carrying
    // flush; +56 B minified in the signals floor (25,193 -> 25,249).
    // Move 3b, one implementation per rule (#3523, 2026-09-17), rebased over
    // #3518/#3522: readerSeesCommitted / visibleOverride (step 1, merged as
    // #3515), the store's node reads through it (step 2), recordStaleReplay
    // (step 3), A29 at the store's untracked paths (step 4), S7, one ownership
    // relation ownsHold (6b) and serve() — Rule 1's one slow selection (6c).
    // Core minified: +31 (replay helper) +1 (enterStagedRead null node) +44
    // (ownsHold, not inlined) +88 (serve wrapper/parameter/guard) = +164 B.
    // Five store/signal divergences fixed (posture-store-parity S4, S5, S7, S8;
    // S6 ruled and deferred); every paired matrix state row-identical.
    // Measured at 12,274 B (+24 over the rebased cap).
    // A write is a proposal (A34, #3494 / #3519 review, 2026-09-17): 12,351 B against
    // `next`'s 12,274 (+77 B). Core-retained: `batchJoins` (a held node's
    // mainline write records the join and schedules; drained inside flush's
    // try, the fast sync path defers to it), the adoption loop's no-proposal
    // drop (signals and writable memos, through commitPendingNode), a
    // kept-tail pending mark re-deriving its subscriber (A30), and
    // reporterBlocksSource following `_pendingSources` one hop.
    // Hybrid handoff rule 4 (#3498, 2026-09-18): 12.40 -> 12.45 KB, measured at
    // 12,385 B against `next`'s 12,360 (+25 B). Layout drift only: this bundle
    // retains none of the hybrid store branch (verified — the minified output
    // is the same 34,727 B and differs only in which short names the minifier
    // hands out); ratcheted so the 15 B of remaining headroom does not flake
    // on Linux. 0 B in the signals floor.
    // `on` re-arms at the flush's finalize (#3540, 2026-09-21): 12,472 B,
    // +22 B over the cap — the scheduler's `pendingRearms` drain sits on the
    // flush path every app retains (see the `+ createStore` note).
    // rc.10: on follows the frame (#3540): 12,473 B against `next`'s 12,472
    // (+1 B) — the core floor's drain move; within the cap.
    // Lazy memo relink + dead-owner freeze (#3555, 2026-09-22): 12.50 ->
    // 12.55 KB, measured at 12,510 B against `next`'s 12,489 (+21 B):
    // linkChild on reawaken, the freeze branch in prepareComputed, and
    // disposeChildren's post-disposal sibling read (+63 B minified in the
    // signals core, see the core floor note); the rest is mangler/brotli
    // layout. 0 B in solid and web.
    // A node disposed during its own pass stays disposed, the pass void
    // (#3621, 2026-09-23): 12.55 -> 12.60 KB, measured at 12,552 B against
    // `next`'s 12,522 (+30 B; +2 over the cap). The signals core's +72 B
    // minified (see the core floor note): recompute's `finally` mask carries
    // REACTIVE_DISPOSED and the pass returns on it — `clearDeps`, the flight
    // retire, the lane restore. 0 B in solid and web.
    limit: "12.60 KB",
    modifyEsbuildConfig
  },
  {
    name: "app: hydrating (no stores) with Show/For/Loading/Errored/lazy",
    // The csr-app surface entered through hydrate(). Must NOT carry the
    // store engine (store/reconcile/projection/optimistic): store hydration
    // is reached through generic adapters parameterized by the core
    // primitive, so enableHydration() itself retains none of it — the
    // engine rides the wrapper the app imports to use stores. Before that
    // seam this fixture measured 22.60 KB (engine retained just by calling
    // hydrate()); 15.83 KB measured after, ceiling at the ~2% headroom
    // convention.
    //
    // loadingValue (commit #0): 16.15 -> 16.35 KB, measured at 16.04. ~210 B
    // brotli: the signals-core loading window (~110 B, see the core-floor
    // note) plus the hydration guards that hold commit #0 through the claim
    // walk — the clean-thenable unwrap guard in readHydratedValue, the
    // deferred first yield in normalizeIterator, and the hasLoadingWindow
    // probe they key on. All sit on the shared signal-hydration body that
    // every hydrating app retains.
    //
    // 2.0.0-rc: 16.35 -> 16.7 KB, measured at 16.35 (exactly at the old
    // cap). The core-floor bytes (flatten 66accfb8 + #3006 + #3009) plus
    // ~10 B from lazy()'s { export } option (#3011: the exportName pick in
    // load/hydration-lookup).
    //
    // Stage-3 batch (pre-release ratchet): 16.7 -> 17.25 KB, measured at
    // 16.92 — the signals-core bytes (see the core-floor note).
    //
    // useHead prelude relocation (#3081): 17.25 -> 17.4 KB, measured at
    // 17.31. ~120 B brotli in hydrate() itself — the head-prelude
    // normalization runs before any claiming, so it sits on the one entry
    // point every hydrating app retains and cannot shake. Golfing measured
    // ~1 B; the bytes are the fix's real cost.
    path: "hydrating-app.js",
    // Upstream drift ratchet (2026-08-27): shared effect notifier (+core)
    // and #3057 invoke's client surface since the 17.25 cap (measured
    // 17.38). Drift, not a stage-2 feature.
    //
    // next merge (2026-08-28): 17.45 -> 17.55 KB, measured at 17.48 — the
    // useHead prelude relocation (#3081, ~120 B in hydrate(), see its note)
    // arriving from next on top of the drift-ratcheted floor.
    //
    // #3164 fold ruling (2026-08-31): 17.55 -> 17.6 KB, measured at 17.59
    // — the signals core-floor arm + asyncWrite wake (see those notes).
    //
    // Fold relocation pass (2026-09-01): 17.6 -> 17.56 KB, measured at
    // 17.54 — this bundle's import graph retained the scheduler-resident
    // ledger; the relocation lets it shake.
    //
    // In-place class mutation fix (#3188): 17.67 -> 17.68 KB, measured at
    // 17.673. Hydration seeds the applied-class snapshot without mutating
    // the claimed DOM so the first live in-place change still diffs.
    //
    // Responsive image preloads (2026-09-01): 17.56 -> 17.59 KB, measured at
    // 17.570 (+29 B). The one document scenario that pays: it retains
    // `lazy`, so the whole asset-registration path is reachable and it picks
    // up the source-set branch in mountHeadResource. csr-app moved the other
    // way on brotli layout (see its note); the identity commit before this
    // one was byte-neutral in every document bundle.
    //
    // Patch-channel removal (2026-09-02): 17.72 -> 17.61 KB, measured at
    // 17.58. The channel is deleted from next — regions own value delivery,
    // the unified-For design owns structure — reclaiming the insert $ll seam and core emission bytes.
    // Contested-effect re-derivation (#3322, 2026-09-09): 17.61 -> 17.68 KB,
    // measured at 17.613. Core scheduler cost; see the core-floor note.
    //
    // Halt -> reportError + document-root preload abandon (#3338, 2026-09-10):
    // 17.68 -> 17.72 KB, measured at 17.69 (+50 B over the pre-#3338 17.64).
    // ~20 B is haltReactivity handing the cause to `reportError` so a
    // creation-time throw that ancestors fold to status (the manifest-miss
    // lazy() failure) still reaches window.onerror / telemetry instead of
    // console-only; ~20 B is hydrate() refusing the client-render fallback
    // at a document root (`nodeType === 9` -> report the preload failure and
    // stop). All diagnostic prose is dev-gated; prod ships terse strings.
    //
    // mapArray SMALL-MOVE fast path (#3227, rebased 2026-09-10): 17.72 KB ->
    // 18.34 KB, measured at 18.29 on the rebased tree (+600 B over 17.69).
    // Scan + commit as two functions (a replace compiles only the scan)
    // plus a 65-compare pre-probe in updateKeyedMap; identity-keyed mode
    // only. Lands in every scenario that bundles <For>.
    //
    // Lane authority (#3335, #3334, #3330, #3331, A15 re-rule; ported from
    // #3347 onto `next` @ 4935c7dd, 2026-09-11): 18.30 -> 18.53 KB, measured
    // at 18529 B against `next`'s 18295 (+234 B) — the core seams (see the
    // core floor note)
    // and, where the app retains lanes, the engine they dispatch to.
    //
    // Conditional pending recovery (#3371, 2026-09-11): a memo that drops
    // a pending source and recovers to an unchanged value retires that
    // source from the dependents it orphaned (settlePendingSource takes a
    // `source`; retryReaches is core-retained as the alternate-path
    // guard). +191 B minified in the in-package floor (22,457 -> 22,648);
    // measured here at 18622 B against the 18.56 KB cap.
    // Second write while an async chain is in flight (#3373–#3376,
    // 2026-09-12): 18.65 -> 18.70 KB, measured at 18678 B against `next`'s
    // 18622 (+56 — the core seams plus the collecting boundary recording
    // every source its effect is pending on, `CollectionQueue.notify`).
    // Boundary reset ends the hold (#3375 ruling, 2026-09-12): 18.70 -> 18.75 KB,
    // measured at 18721 B against 18678 (+43); see the core floor note.
    // #3372/#3377 (2026-09-12): 18.75 -> 18.80 KB, measured at 18749 B against 18721
    // (+28); see the core floor note.
    // #3426/#3427/#3407 (2026-09-14): 18.80 -> 18.85 KB, measured at 18811 B
    // against `next`'s 18780 (+31); see the core floor note.
    // Effect arm of A30 (#3438, 2026-09-14): 18.85 -> 18.90 KB, measured at
    // 18880 B against `next`'s 18816 (+64 brotli on +35 B minified); see the
    // core floor note.
    // Memo lane posture (#3442, 2026-09-14): no bump, measured at 18854 B on
    // the rebase over #3438 (+12 B minified; brotli noise absorbs it).
    // Born held (A29 creation-time form, #3451; 2026-09-15): 18.90 -> 19.10 KB,
    // measured at 19023 B against `next`'s 18899 (+124); the signals-core
    // bytes from the core floor note, nothing app-side.
    // A28 — writes visible at flush, read-side (2026-09-15): measured at 19,367 B
    // against `next` (+267 B); the signals core delta, see the core floor note.
    // Hold-consistency batch 2 (#3479, 2026-09-15): measured at 19,534 B; the signals
    // core delta, see the core floor note.
    // Lanes stage (#3479 review, 2026-09-16): 19.60 -> 19.70 KB, measured at
    // 19,606 B (+72 brotli on ~+40 B minified: recompute's derived-override
    // posture branch, fuzzer latest-1 #2481). Brotli noise: the same bytes
    // read -6 on the core floor and +16 on isPending/latest.
    // Client error hook (2026-09-16): 19.70 -> 19.80 KB, measured at 19,782 B rebased
    // over #3479–#3488. This scenario renders <Errored>, so it carries the hook
    // module (core/error-hooks.ts: the ambient registration, once-per-error,
    // the owner-label walk), retained by `createErrorBoundary`'s report —
    // ~+200 B; pay-for-use, the price of a boundary that can tell a monitor
    // what it caught. Scenarios without a boundary did not move (`render`'s
    // write of `onError` onto the root owner is the only prod-floor cost).
    // `_parent` reserved from property mangling (2026-09-16): 19.80 -> 19.85 KB,
    // measured at 19,825 B. It is the second cross-package owner field beside
    // `_name`: solid-js walks it on signals' owners (hydration's snapshot
    // root — which the prod build was mis-marking while it was mangled) and
    // the core walks it on solid-js's server owners (`ownerPath`,
    // `OBSERVE.exclude`). ~+40 B across the prod scenarios; the observe ones
    // moved by gzip noise or shrank.
    // Hydration claim-path trim (#3513, 2026-09-17): measured at 19,931 B against
    // current `next`'s 19,849 (+82). One indexed childNodes claim pass replaces
    // iterator-copy + compaction; frame ancestry is queried once per root.
    // Hydration writes land as client renders (#3504, 2026-09-17): 19.95 -> 20.05 KB,
    // measured at 20,044 B rebased over #3513 (+113 B). solid-js's createRoot
    // gains the hydration slot indirection the other primitives have plus a
    // hydrating body that marks the snapshot root; a resume window records its
    // boundary owner and `sharedConfig.isClaiming` walks `_parent` to it;
    // @solidjs/web's isHydrating consults it. 0 B in the signals floor.
    // Shared read predicates (DESIGN-CONSOLIDATION move 3b step 1, 2026-09-17):
    // readerSeesCommitted / visibleOverride / one hasActiveOverride. Minified
    // signals: core +13 B, +createStore -38 B, full bundle -72 B; brotli on the
    // pure-signals fixtures -4 / -29 / -5 B. This scenario's esbuild bundle
    // measured at 20,054 B rebased over #3507, against `next`'s 20,044 (+10 B).
    // Error hook: where thrown, apart from where met (2026-09-17): measured
    // at 20,098 B rebased over #3515, against `next`'s 20,054 (+44 B).
    // `reportClientError` takes the thrower the status wrapper already names
    // and fills `boundaryPath` beside `ownerPath`; this scenario renders
    // <Errored>, so it carries the hook module.
    // Move 3b, one implementation per rule (#3523, 2026-09-17), rebased over
    // #3518/#3522: readerSeesCommitted / visibleOverride (step 1, merged as
    // #3515), the store's node reads through it (step 2), recordStaleReplay
    // (step 3), A29 at the store's untracked paths (step 4), S7, one ownership
    // relation ownsHold (6b) and serve() — Rule 1's one slow selection (6c).
    // Core minified: +31 (replay helper) +1 (enterStagedRead null node) +44
    // (ownsHold, not inlined) +88 (serve wrapper/parameter/guard) = +164 B.
    // Five store/signal divergences fixed (posture-store-parity S4, S5, S7, S8;
    // S6 ruled and deferred); every paired matrix state row-identical.
    // Measured at 20,148 B (+48 over the rebased cap).
    // A write is a proposal (A34, #3494 / #3519 review, 2026-09-17): 20,208 B against
    // `next`'s 20,148 (+60 B). Core-retained: `batchJoins` (a held node's
    // mainline write records the join and schedules; drained inside flush's
    // try, the fast sync path defers to it), the adoption loop's no-proposal
    // drop (signals and writable memos, through commitPendingNode), a
    // kept-tail pending mark re-deriving its subscriber (A30), and
    // reporterBlocksSource following `_pendingSources` one hop.
    // Shallow store leaves stay raw (#3498, 2026-09-18): 20,260 B against
    // `next`'s 20,208 (+52 B). The hydration replay shadow copies only the
    // root for a shallow store instead of JSON-cloning the tree
    // (createShadowDraft's `shallow` branch); it sits on the shared store
    // hydration adapter this bundle retains without the store engine.
    // Hybrid handoff waits for the server answer (#3498, 2026-09-18): 20.3 ->
    // 20.5 KB, measured at 20,431 B against `next`'s 20.23 KB (+~200 B). The
    // hybrid store branch of hydrateStoreLikeFn: a pending serialized answer
    // is handed to the engine as a two-step stream (adoptedAnswerStream) whose
    // second pull — the engine's own continuation after the landing commits —
    // flips the handoff, so the client takeover no longer supersedes the
    // server flight; a `live` latch scopes the first-yield discard to that
    // one handoff run and lets a rejected answer stand until refresh(); an
    // `adopted` latch and a live-guarded flip make a dependency change before
    // the landing take over (rule 4, +42 B). Same shared store hydration
    // adapter as the entry above, retained here without the store engine.
    // Born held exempts boundaries; `on` is a key (#3540, 2026-09-18): 20,521 B
    // against `next`'s 20,431 (+90 B). Core: the same +46 B as the core floor
    // note; boundaries: the same key computed / output-pass reset / born-held
    // source retention as the CSR note.
    // rc.10: on follows the frame (#3540): 20,663 B against `next`'s 20,542
    // (+121 B). Core: the drain move (core floor note); boundaries: the same
    // `_rearm` / `_swap(lane)` / lane-aware on-node / `_settled` as the CSR
    // note. Solid: `<Errored on>` and its hydration-wrapper threading are
    // gone. 0 B in web.
    // A pending fallback's boundary is judged before the verdict (#3540,
    // 2026-09-22): 20.70 -> 20.75 KB, measured at 20,731 B against `next`'s
    // 20,679 (+52 B), rebased over #3577. Core: the pre-verdict boundary walk
    // (core floor note). Boundaries: `_judgeHeld` (the output-pending gate
    // over `_checkSources`) and the `_output` back-reference it reads; the
    // DEV rule's two-state test is shaken.
    // Chrome performance tracks (2026-09-22): 20.70 -> 20.75 KB, measured at
    // 20,672 B against `next`'s 20,663 (+9 B) with the minified bundle
    // structurally identical — same byte count, and an identifier-normalised
    // diff of the two is empty. The delta is esbuild's mangled-name
    // assignment shifting under brotli, not code: every source-name site is
    // folded (spread labels ride `spreadName` instead of call arguments, the
    // boundary names gate the call or set `_name` after it, createStore's
    // name branch is an `__OBSERVE__` block). Verify with the same
    // normalised diff before attributing a future move here to the tier.
    // Quiet hybrid handoff (#3574, 2026-09-22): 20.75 -> 20.80 KB, measured
    // at 20,781 B against `next`'s 20,737 (+44 B), rebased over #3595 and the
    // performance tracks. Solid only: the shared store hydration adapter's
    // `wrapFirstYield` step 0 + `quietAnswer` (see the store-family note).
    // Memo/signal hybrid handoff waits for the landing (memo-shaped #3574,
    // 2026-09-22): 20.80 -> 20.85 KB, measured at 20,843 B against `next`'s
    // 20,781 (+62 B). Solid only: hydrateSignalLike's hybrid branch grows
    // the store's landing-gated adoption (adoptedAnswerStream, rule-4
    // supersession, rule-3 authority transfer) in place of the
    // withHydrationGate creation flip; the quiet run reuses wrapFirstYield
    // with the adopted value as its `quiet` parameter (+1 optional
    // parameter, shared with the store adapter). 0 B in signals or web.
    // Style-gated fragment resume (#3600, 2026-09-23): 20.85 -> 20.95 KB,
    // measured at 20,919 B against `next`'s 20,883 (+36 B). Two parts.
    // Inherited: `next` at ed60f054a already measures 20,883 (33 B over
    // this cap) — #3606's `runDisposal` detach-before-run in the signals
    // core landed over #3605's 20,843 without a bump (its PR CI ran on the
    // pre-#3605 base). This PR: +36 B, solid only — the fragment ledger
    // holds a boundary's resume until a `$dfs`-parked swap lands
    // (`fragmentParked`, `whenRevealed`; `fragmentPending` reuses the parked
    // test). 0 B in web: `waitAsset`'s `{ transparent: true }` and the
    // hydrating skip in `gateHeadResource` are not in this fixture.
    // Null owner takes the transparent path; hybrid latches for non-stream
    // shapes (#3609, 2026-09-23): no bump, measured at 21,088 B against
    // `next`'s 21,056 (+32 B) rebased over #3615. Solid only — the
    // `noHydrationId()` guards (commit 1) and hydrateSignalLike dropping
    // its creation-time gate flip on non-iterable hybrid shapes (commit 2);
    // see the with-stores note for the breakdown. Brotli layout: the same
    // source measured 20,907 against the pre-#3615 `next`'s 20,919 (-12 B).
    // Errored builds a thunk fallback inside its own scope (#3620 follow-up,
    // 2026-09-23): 20.95 -> 21.00 KB, measured at 20,981 B against `next`'s
    // 20,907 (+74 B) with the minified bundle 10 B SMALLER (61,324 vs
    // 61,334): the one code change is a token removal — `Errored`'s fallback
    // call drops its `&& f.length` guard (solid only, client and server
    // dists) — and an identifier-normalised diff of the two bundles is that
    // single statement. The delta is esbuild's mangled-name assignment
    // shifting under brotli (as in the performance-tracks note above); the
    // same source measures -37 B on the with-stores app and -31 B on CSR.
    // A held derivation is not a proposal (#3612, 2026-09-23): 21.00 -> 21.10
    // KB, measured at 21,055 B against `next`'s 20,986 (+69 B). The signals
    // core's `heldDerivation` / `rederiveHeld` behind `setMemo` (+150 B
    // minified, see the core floor note). 0 B in solid and web.
    limit: "21.10 KB",
    modifyEsbuildConfig
  },
  {
    name: "app: hydrating + every store primitive family",
    // The companion WITH-stores scenario: pays for the engine + hydration
    // adapters by importing the primitives, keeping today's hydration
    // behavior with zero action required. 22.62 KB measured at the seam
    // landing (byte parity with the pre-seam 22.68); ~2% headroom.
    //
    // loadingValue (commit #0): 23.05 -> 23.3 KB, measured at 22.83 — the
    // same ~210 B as the no-store scenario (core window + hydration guards)
    // plus the store-replay seed parking in hydrateStoreFromAsyncIterable.
    //
    // 2.0.0-rc: 23.3 -> 23.65 KB, measured at 23.19 — the same batch as the
    // no-store scenario (flatten + #3006 + #3009 + lazy export), restoring
    // the ~2% headroom convention.
    //
    // Store rewrite: ratcheted 23.65 -> 23.3 KB, measured at 22.84 (this
    // scenario imports every store family, so it keeps the optimistic
    // channel and pays the injection seam; the −470 B is the legacy
    // deletion net of the rewrite). ~2% headroom.
    //
    // Stage-3 batch (pre-release ratchet): 23.3 -> 24.65 KB, measured at
    // 24.19 — the signals-core bytes plus the store-side #3044/written-keys
    // work (see the createStore note; this scenario retains all of it).
    //
    // Projection transition isolation (#3074/#3075): 24.65 -> 24.75 KB,
    // measured at 24.65 exactly — the held-view mask + latest() pull (see
    // the createStore note; this scenario retains all of it).
    //
    // Shared effect status notifier (ba6c0b6f): 24.75 -> 24.9 KB, measured
    // at 24.80. The statusNotifierOf seam is always-retained core; it buys
    // -127 B/node heap and -15% effect creation (the per-effect NodeExtension
    // allocation it removes). The other floors absorbed it within headroom.
    //
    // Stage-2 patch channel: 24.9 -> 25.9 KB (measured 25.23 pre-#3074,
    // pre-notifier) — the createStore write-path seams (~490 B, see that
    // note) plus this scenario's optimistic/projection family emission seams
    // and the web runtime's ~100 B insert hook. The driver + emitters
    // themselves are pay-for-use and absent here (no compiled patch output
    // imports them).
    //
    // Fold scheduling (#3089, merged from next): 25.9 -> 26 KB — the same
    // bytes as the createStore note (this scenario retains all of it).
    //
    // rc.5 signals drift (2026-08-30): 26 -> 26.1 KB, measured at 26.07.
    // The #3108 truth-author fix (88fa9d64, optimistic module) plus the
    // refresh() quiescence promise (51ffcb9a, settle walk) — this scenario
    // retains every store family, so it pays both. Drift, not a regression.
    //
    // Transaction-lifecycle fixes (2026-08-31): 26.1 -> 26.15 KB, measured at
    // 26.12. #3141 (initTransition guarantees a flush) and #3140 (commit
    // clears _transition stamps; initTransition refuses a done transaction)
    // — ~25 B of scheduler prod code for an ambient-capture fix and a
    // prod-hang fix. The other nine budgets absorbed it within headroom.
    //
    // #3123/#3164 fold ruling (2026-08-31): 26.15 -> 26.71 KB, measured at
    // 26.70. The optimistic-store reckoning, re-ruled from replay to FOLD
    // after GabbeV's union-tear report (#3164): the interim #3123 replay
    // machinery (retained-setter replay, echo dedupe, settle re-derivation,
    // ~26.535 measured) was backed out and replaced by landing folds —
    // truth landings stage into the retaining transaction
    // (runAsTransitionBatch), held-truth masks keep ordinary readers on
    // committed until the atomic reveal (heldTruthNodes ledger +
    // transitionHoldsOptimism, dispatched through _heldTruthMasked /
    // optHooks.retainsOptimism), until()/latest() tunnel through, and the
    // revert path resyncs overlaid keysets for mapArray. This scenario
    // retains every store family, so it pays the whole module. Ruled
    // correctness-over-size in the #3164 thread; conscious bump.
    //
    // Typed responsive preloads (2026-09-01): byte-neutral, measured at
    // 26.701 across the whole branch — the identity canonicalization shares
    // one helper with the code it replaced, and this bundle does not retain
    // the source-set adoption branch.
    path: "hydrating-store-app.js",
    //
    // Patch-channel removal (2026-09-02): 26.99 -> 26.15 KB, measured at
    // 26.09. The channel is deleted from next — regions own value delivery,
    // the unified-For design owns structure — reclaiming the full store-family emission surface (value + row tiers).
    //
    // Store create-floor diet (2026-09-04): 26.15 -> 26.25 KB, measured at
    // 26.248 — the slotSignal + first-read-dedupe bytes (see the
    // createStore note; this scenario retains all of it).
    //
    // Store correctness batch (2026-09-04): 26.25 -> 26.27 KB, measured at
    // 26.264 on Linux CI (26.26 macOS) — the same fixes as the createStore
    // note; this scenario retains all of them plus the optimistic module's
    // first-flight carve-out (#3264).
    //
    // Fold privatization merge (#3271): 26.27 -> 26.37 KB, measured at
    // 26.36 macOS — the drainFolds merge arm (see the createStore note);
    // this scenario retains all of it.
    //
    // rc.6 P1 store sweep (#3282/#3283/#3284): 26.37 -> 26.43 KB, measured
    // at 26.42 macOS / 26424 B Linux CI (the usual +4-7 B Linux delta) —
    // see the createStore note; this scenario retains all of it.
    //
    // Adoption diffs against the pending view (#3296, 2026-09-06): 26.43 ->
    // 26.45 KB, measured at 26423 macOS (+~30 B brotli drift on this
    // scenario's layout; the createStore scenario carrying the same change
    // came in UNDER its pre-fix size — see its note). The usual +4-7 B
    // Linux delta leaves ~20 B headroom.
    // Contested-effect re-derivation (#3322, 2026-09-09): 26.45 -> 26.52 KB,
    // measured at 26.453. Core scheduler cost; see the core-floor note.
    // Effect ownership on finalize re-entry (#3319, 2026-09-09): 26.52 KB -> 26.60 KB,
    // measured at 26.558. Core scheduler cost; see the core-floor note.
    // deep()/identity over chained views (#3323, 2026-09-09): 26.60 KB -> 26.70 KB,
    // measured at 26.648. Store cost; see the createStore note.
    // mapArray SMALL-MOVE fast path (#3227, rebased 2026-09-10): 26.70 KB ->
    // 27.34 KB, measured at 27.29 on the rebased tree (+600 B over 26.69).
    // See the hydrating (no stores) note; same cost, every <For> scenario.
    // Firewall child chain doubly linked (#3351, 2026-09-10): 27.34 -> 27.48 KB,
    // measured at 27.430 (was 27.273; +80 B of it is the createStore arm, the
    // rest brotli layout across the store family bundle). See the createStore note.
    // Narrow-store write floor (#3360, 2026-09-10): 27.48 -> 27.57 KB,
    // measured at 27.518 (was 27.391). The createStore arm; see that note.
    // Ownership stamp (#3360 part two, 2026-09-10): 27.57 -> 27.66 KB,
    // measured at 27.608 (was 27.518). The createStore arm; see that note.
    //
    // Lane authority (#3335, #3334, #3330, #3331, A15 re-rule; ported from
    // #3347 onto `next` @ 4935c7dd, 2026-09-11): 27.61 -> 28.21 KB, measured
    // at 28208 B against `next`'s 27608 (+600 B). The core seams (see the
    // core floor note)
    // plus the store twins: held adoption under a live transaction on
    // optimistic families (`heldMaskView`, `stageHeldAdoptions`),
    // `notifyOptimisticWrites` judging against the view readers see, and
    // the authoritative landing on an override-covered node dispatching to
    // the engine.
    //
    // Conditional pending recovery (#3371, 2026-09-11): a memo that drops
    // a pending source and recovers to an unchanged value retires that
    // source from the dependents it orphaned (settlePendingSource takes a
    // `source`; retryReaches is core-retained as the alternate-path
    // guard). +191 B minified in the in-package floor (22,457 -> 22,648);
    // measured here at 28268 B against the 28.24 KB cap.
    // Second write while an async chain is in flight (#3373–#3376,
    // 2026-09-12): 28.30 -> 28.35 KB, measured at 28300 B against `next`'s
    // 28268 (+32 — the core seams and the collecting boundary).
    // Boundary reset ends the hold (#3375 ruling, 2026-09-12): 28.35 -> 28.40 KB,
    // measured at 28380 B against 28300 (+80); see the core floor note.
    // Mainline effect ownership across the forced in-transaction re-run
    // (#3412, 2026-09-13): 28.40 -> 28.45 KB, measured at 28408 B on the
    // merge with `next` — the save/restore of `_valueTransition` in
    // recompute, on top of #3413's companion-gate change.
    // Held children (#3404, 2026-09-13): cap held at 28.45 KB; see the
    // createStore note.
    // #3426/#3427/#3407 (2026-09-14): 28.45 -> 28.65 KB, measured at 28602 B
    // against `next`'s 28430 (+172 — the core seams plus `endOptimism` in
    // the optimistic module); see the core floor note.
    // Held-input rules (#3408, #3410; 2026-09-14, on top of #3434): 28.65 ->
    // 28.70 KB, measured at 28680 B against `next`'s 28602 (+78) — `enterStagedRead` on read()'s value
    // selections and the deferred dependency trim; see the core floor note.
    // Born held (A29 creation-time form, #3451; 2026-09-15): 28.70 -> 28.85 KB,
    // measured at 28746 B against `next`'s 28580 (+166); the signals-core
    // bytes from the core floor note, nothing app-side.
    // Loading `on` reset collects forwarded readers (#3459, 2026-09-15), on
    // top of #3464/#3465/#3466: 28.85 -> 28.90 KB, measured at 28861 B against
    // `next`'s 28815 (+46 — the reset walk in boundaries.ts, retained wherever
    // Loading is; the PR alone measured 28848 against the pre-#3464 `next`,
    // 2 B under, and the three fixes that landed meanwhile used the room).
    // Seams behind `solid-js/internal` (#3470, 2026-09-15): 28.90 -> 28.95 KB,
    // measured at 28901 B against `next`'s 28861 (+40). Mangler noise, not
    // cost: the minified bundle is byte-identical (89072 B both sides) and
    // differs only in which short names the minifier hands out — the extra
    // module boundary shifts its allocation. The same swap compresses the
    // other app scenarios BETTER (simple-app -33, hydrating -45, CSR -21);
    // this one drew the short straw, 1 B over a cap #3459 had just
    // consumed the room under.
    // A28 — writes visible at flush, read-side (2026-09-15): measured at 29,280 B
    // against `next` (+330 B); the signals core delta, see the core floor note.
    // Hold-consistency batch 2 (#3479, 2026-09-15): measured at 29,501 B; the signals
    // core delta, see the core floor note.
    // Lanes stage (#3479 review, 2026-09-15): measured at 29,657 B (+156 B); the
    // signals optimistic-engine delta, see the isPending/latest note.
    // Client error hook (2026-09-16): 29.75 -> 29.90 KB, measured at 29,854 B rebased
    // over #3479–#3488. This scenario renders <Errored>, so it carries the hook
    // module (core/error-hooks.ts: the ambient registration, once-per-error,
    // the owner-label walk), retained by `createErrorBoundary`'s report —
    // ~+250 B; pay-for-use, the price of a boundary that can tell a monitor
    // what it caught. Scenarios without a boundary did not move (`render`'s
    // write of `onError` onto the root owner is the only prod-floor cost).
    // Reporter-liveness fix rebased over `_parent` mangling (#3495 + #3496,
    // 2026-09-16): measured at 29,903 B; combined brotli layout drift.
    // A projection's leaf companions die with it; latest() of a dead leaf creates
    // none (spec O5, 2026-09-16): 29,953 B (+43 over the cap); +104 B minified in
    // owner.ts (core floor), the shadow retirement lives in verdict.ts.
    // Hydration claim-path trim (#3513, 2026-09-17): measured at 30,041 B against
    // current `next`'s 29,985 (+56). Same one-pass claim/frame-query trade as the
    // no-store hydration scenario; the store engine itself is unchanged.
    // Hydration writes land as client renders (#3504, 2026-09-17): 30.05 -> 30.15 KB,
    // measured at 30,107 B rebased over #3513 (+66 B); the solid-js createRoot /
    // resume-window claim gate, see the hydrating (no stores) note. 0 B in the
    // signals floor.
    // Error hook thrower/boundary paths (2026-09-17): 30.15 -> 30.25 KB,
    // measured at 30,203 B rebased over #3515, against `next`'s 30,130 (+73 B).
    // Move 3b, one implementation per rule (#3523, 2026-09-17), rebased over
    // #3518/#3522: readerSeesCommitted / visibleOverride (step 1, merged as
    // #3515), the store's node reads through it (step 2), recordStaleReplay
    // (step 3), A29 at the store's untracked paths (step 4), S7, one ownership
    // relation ownsHold (6b) and serve() — Rule 1's one slow selection (6c).
    // Core minified: +31 (replay helper) +1 (enterStagedRead null node) +44
    // (ownsHold, not inlined) +88 (serve wrapper/parameter/guard) = +164 B. +55 B store (S7, an optimistic override survives its key becoming
    // unobserved), +123 / +130 B store (S4 / S5 fixes at the backing and the
    // untracked node paths).
    // Five store/signal divergences fixed (posture-store-parity S4, S5, S7, S8;
    // S6 ruled and deferred); every paired matrix state row-identical.
    // Measured at 30,296 B (+46 over the rebased cap).
    // A write is a proposal (A34, #3494 / #3519 review, 2026-09-17): 30,303 B against
    // `next`'s 30,219 (+84 B). Core-retained: `batchJoins` (a held node's
    // mainline write records the join and schedules; drained inside flush's
    // try, the fast sync path defers to it), the adoption loop's no-proposal
    // drop (signals and writable memos, through commitPendingNode), a
    // kept-tail pending mark re-deriving its subscriber (A30), and
    // reporterBlocksSource following `_pendingSources` one hop.
    // Shallow store leaves stay raw (#3498, 2026-09-18): 30,469 B against
    // `next`'s 30,303 (+166 B): the replay shadow's `shallow` branch above
    // plus, in the projection engine, `wrapDraft`'s shallow short-circuit (no
    // draft proxy over a raw leaf) and `cloneState` — the loading shadow and
    // its commit copy take the root alone for a shallow store. The deep path
    // is byte-identical in behavior; the bytes are the shallow branch.
    // Hybrid handoff waits for the server answer (#3498, 2026-09-18): 30.5 ->
    // 30.6 KB, measured at 30,545 B against `next`'s 30.41 KB (+~135 B, of
    // which +18 B is rule 4); the same hydrateStoreLikeFn hybrid-branch change
    // as the hydrating (no stores) note. 0 B in the signals floor.
    // Born held exempts boundaries; `on` is a key (#3540, 2026-09-18): 30,695 B
    // against `next`'s 30,545 (+150 B). Core: the same +46 B as the core
    // floor note; boundaries: the same key computed / output-pass reset /
    // born-held source retention as the CSR note. 0 B in the store engine.
    // `on` is a dependency list; re-arm at the finalize (#3540, 2026-09-21):
    // 30,765 B, +15 B over the cap. Core: `pendingRearms` / `queueRearm` /
    // the finalize drain replace `keyComputed`'s value compare and
    // `_prevOn` (a near wash in boundaries.ts); solid: `<Errored on>` threaded
    // through the hydration wrapper to createErrorBoundary's options.
    // rc.10: on follows the frame (#3540): 30,844 B against `next`'s 30,739
    // (+105 B) — the same core + boundaries + solid deltas as the entry
    // above; brotli's context over the larger bundle lands 20 B differently
    // from the entry above's -3 B. 0 B in the store engine.
    // Lazy memo relink + dead-owner freeze (#3555, 2026-09-22): 30.90 ->
    // 30.95 KB, measured at 30,901 B against `next`'s 30,874 (+27 B):
    // linkChild on reawaken, the freeze branch in prepareComputed, and
    // disposeChildren's post-disposal sibling read (+63 B minified in the
    // signals core, see the core floor note); the rest is mangler/brotli
    // layout. 0 B in the store engine, solid, or web.
    // Draft valid until superseded or disposed (#3585, proj R37,
    // 2026-09-22): 30.95 -> 31.1 KB, measured at 31,058 B against `next`'s
    // 30,901 (+157 B). Real bytes are +60 minified: `schedule()` records
    // the microtask it withholds under projectionWriteActive and
    // `scheduleWithheld` re-arms it (+83 B in the scheduler — the one place
    // the guard lives); the store's per-run token, `isDisposed(owner)` in
    // the draft gate and the after-write arming closure are paid for by
    // folding the three mutating draft traps onto one bracket and dropping
    // the run-returned gate on the arming (-23 B in projection.js). The
    // other ~100 B is mangler/brotli layout: the same bytes measured 30,953
    // with the gate still in place (+52) and 31,058 without it — a 13 B
    // minified removal moved brotli +105. + createStore, which retains the
    // same store engine, moved +13 B.
    // Quiet hybrid handoff (#3574, 2026-09-22): 30,985 B against `next`'s
    // 31,058 (-73 B: the same added source as the no-stores entry's +44 B,
    // landing negative under brotli's layout over this larger bundle), cap
    // unchanged at 31.1 KB. Solid
    // only, in the shared store hydration adapter: `wrapFirstYield` lands a
    // synchronous step 0 (the adopted answer) ahead of the source's duplicate
    // first yield, and `quietAnswer` gives the promise-shaped handoff the same
    // three-step shape, so the store never reads pending through the handoff
    // (rule 5). 0 B in the signals core, the store engine, or web.
    // Memo/signal hybrid handoff waits for the landing (memo-shaped #3574,
    // 2026-09-22): 31.1 -> 31.15 KB, measured at 31,134 B against `next`'s
    // 30,985 (+149 B; the same +62 B of source as the no-stores entry — the
    // prior entry's brotli layout swing over this bundle reversing, so the
    // two handoff PRs net +76 B here against +106 B no-stores). Solid only,
    // in hydrateSignalLike (see the no-stores note).
    // Style-gated fragment resume (#3600, 2026-09-23): 31.15 -> 31.2 KB,
    // measured at 31,155 B against `next`'s 31,145 (+10 B; the same solid
    // ledger source as the no-stores entry's +36 B, laid out differently by
    // brotli over this larger bundle). `next`'s 31,145 already carries
    // #3606's +11 B over #3605's 31,134, unbumped (see the no-stores note).
    // 0 B in the signals core, the store engine, or web.
    // Null owner takes the transparent path; hybrid latches for non-stream
    // shapes (#3609, 2026-09-23): 31.30 -> 31.35 KB, measured at 31,328 B
    // against `next`'s 31,284 (+44 B, 28 B over the old cap) rebased over
    // #3615; the same source measured 31,220 against the pre-#3615 `next`'s
    // 31,155 (+65 B — the commit split below is from that run). Solid only,
    // in hydration.ts. Commit 1 (+50 B, 31,205): `noHydrationId()` — the
    // `!owner || owner.id == null` guard mirroring the server's serialize
    // predicate — at the top of every hydration facade body (signal-like,
    // store-like, effect, error boundary, loading boundary), plus
    // hydrateSignalLike honoring `transparent`. Commit 2 (+15 B): the
    // store adapter's hybrid branch gains memo's detect-then-arm shape
    // (`takeover` from the adoption trace; non-iterable runs route through
    // readSerializedOrCompute) while both wrappers drop the creation-time
    // gate flip for non-iterable shapes — the snapshot scope held that
    // write past `done` and replayed it as a live re-run, the very refetch
    // the ruling forbids. The no-stores companion carries the same source at
    // +32 B (-12 B before the rebase — brotli layout over the smaller
    // bundle). 0 B in the signals core, the store engine, or web.
    // Revert of #3615 (#3618, 2026-09-23): the hydrate() gate's +129 B is
    // gone, and #3616's bump is re-expressed over the pre-#3615 baseline:
    // 31.2 -> 31.25 KB, measured at 31,220 B (#3616's own +65 B over the
    // pre-#3615 31,155, as its note above recorded). The no-stores entry
    // returns to its pre-#3615 20.95 KB cap, measured at 20,907 B.
    // A node disposed during its own pass stays disposed (#3621, 2026-09-23):
    // 31.25 -> 31.30 KB, measured at 31,230 B against `next`'s 31,183 (+47 B,
    // 20 B under the cap — ratcheted for Linux headroom). The signals core's
    // +72 B minified void-pass arm (see the core floor note); the no-stores
    // companion moved +5 B (20,981 -> 20,986) on the same build, so the rest
    // here is brotli layout over the larger bundle. 0 B in the store engine,
    // solid, or web.
    // A held derivation is not a proposal (#3612, 2026-09-23): 31.30 -> 31.40
    // KB, measured at 31,350 B against `next`'s 31,230 (+120 B). The signals
    // core's `setMemo` arm (+150 B minified, see the core floor note) and
    // the store engine's `derivedStoreWrite` wrap on the derived setter (see
    // the + createStore note). 0 B in solid or web.
    limit: "31.40 KB",
    modifyEsbuildConfig
  },
  {
    name: "app: CSR with Show/For/Loading/Errored/lazy",
    // Ratcheted 12 -> 11.95 KB after the hydration-phase seam trim
    // (isHydrationInProgress/onHydrationEnd moved from the sharedConfig
    // literal into enableHydration(), −100 B here, 11.72 KB measured) so
    // the win is locked in at the ~2% headroom convention.
    //
    // 2.0.0-rc: 11.95 -> 12.3 KB, measured at 12.06. Per-commit: flatten
    // promise-of-AsyncIterable (66accfb8, ~+110 B — handleAsync rides in
    // every async-capable bundle), #3006 (~+40 B), #3009 + lazy { export }
    // (#3011) ~+15 B combined. See the core-floor note for why the flatten
    // bytes don't dedupe away under brotli.
    //
    // Stage-3 batch (pre-release ratchet): 12.3 -> 12.8 KB, measured at
    // 12.53 — the signals-core bytes (see the core-floor note).
    //
    // #3122 eager iterator teardown (2026-08-31): 12.9 -> 12.92 KB,
    // measured at 12.911 — the core-floor teardown bytes (see that note).
    //
    // #3164 fold ruling (2026-08-31): 12.92 -> 12.94 KB, measured at 12.93
    // — the signals core-floor arm + asyncWrite wake (see those notes).
    //
    // Fold relocation pass (2026-09-01): 12.94 -> 12.95 KB, measured at
    // 12.948. The one counter-mover: this bundle never retained the
    // scheduler-resident ledger (nothing to shake), so it pays only the
    // hook call site's second argument plus brotli layout drift.
    //
    // Responsive image preloads (2026-09-01): 23 B SMALLER, measured at
    // 12.925 against 12.948. Brotli layout drift, not a real shrink — the
    // preceding identity commit measured byte-identical here. Ceiling left
    // where it is; ratchet it in a drift pass, not in a feature PR.
    path: "csr-app.js",
    //
    // Patch-channel removal (2026-09-02): 13.11 -> 12.97 KB, measured at
    // 12.93. The channel is deleted from next — regions own value delivery,
    // the unified-For design owns structure — reclaiming the insert $ll seam and core emission bytes.
    //
    // Responsive image preloads, as merged (#3183, 2026-09-05): 12.97 ->
    // 13.01 KB, CI measured 13.00 (over by 30 B). The 09-01 note above
    // predates the review round that added srcset URL-forgery rejection,
    // the canonicalization split and hasWidthDescriptor to client.ts —
    // those bytes land here, and this scenario was not ratcheted with the
    // hydrating ones. Ratchet on next so the branch is green again.
    // Contested-effect re-derivation (#3322, 2026-09-09): 13.01 -> 13.04 KB,
    // measured at 13.00. Core scheduler cost; see the core-floor note.
    // Effect ownership on finalize re-entry (#3319, 2026-09-09): 13.04 KB -> 13.08 KB,
    // measured at 13.048. Core scheduler cost; see the core-floor note.
    // mapArray SMALL-MOVE fast path (#3227, rebased 2026-09-10): 13.08 KB ->
    // 13.75 KB, measured at 13.70 on the rebased tree (+630 B over 13.07).
    // See the hydrating (no stores) note; same cost, every <For> scenario.
    //
    // Lane authority (#3335, #3334, #3330, #3331, A15 re-rule; ported from
    // #3347 onto `next` @ 4935c7dd, 2026-09-11): 13.74 -> 13.92 KB, measured
    // at 13921 B against `next`'s 13738 (+183 B) — the core seams (see the
    // core floor note)
    // and, where the app retains lanes, the engine they dispatch to.
    //
    // Conditional pending recovery (#3371, 2026-09-11): a memo that drops
    // a pending source and recovers to an unchanged value retires that
    // source from the dependents it orphaned (settlePendingSource takes a
    // `source`; retryReaches is core-retained as the alternate-path
    // guard). +191 B minified in the in-package floor (22,457 -> 22,648);
    // measured here at 13975 B against the 13.95 KB cap.
    // Second write while an async chain is in flight (#3373–#3376,
    // 2026-09-12): 14.00 -> 14.05 KB, measured at 14029 B against `next`'s
    // 13975 (+54 — the core seams and the collecting boundary).
    // Boundary reset ends the hold (#3375 ruling, 2026-09-12): 14.05 -> 14.15 KB,
    // measured at 14098 B against 14029 (+69); see the core floor note.
    // #3372/#3377 (2026-09-12): 14.15 -> 14.20 KB, measured at 14169 B against 14098
    // (+71); see the core floor note.
    // Held-input rules (#3408, #3410; 2026-09-14, on top of #3434): 14.20 ->
    // 14.25 KB, measured at 14245 B against `next`'s 14169 (+76) — `enterStagedRead` on read()'s value
    // selections and the deferred dependency trim; see the core floor note.
    // Effect arm of A30 (#3438, 2026-09-14): 14.25 -> 14.30 KB, measured at
    // 14251 B against `next`'s 14245 (+6); see the core floor note.
    // Born held (A29 creation-time form, #3451; 2026-09-15): 14.30 -> 14.45 KB,
    // measured at 14384 B against `next`'s 14257 (+127); the signals-core
    // bytes from the core floor note, nothing app-side.
    // #3459 Loading `on` reset collects its forwarded readers (2026-09-15):
    // 14.45 -> 14.5 KB, measured at 14.467 against next's 14.429 (+38 B):
    // the CollectionQueue reset walk over the live transactions' reporters
    // (`_holds` + the source harvest) in boundaries.ts, retained wherever
    // Loading is. Signals-only scenarios moved the other way (createStore
    // -62 B) — the new scheduler export shifts brotli layout, not a shrink.
    // A28 — writes visible at flush, read-side (2026-09-15): measured at 14,747 B
    // against `next` (+247 B); the signals core delta, see the core floor note.
    // Hold-consistency batch 2 (#3479, 2026-09-15): measured at 14,917 B; the signals
    // core delta, see the core floor note.
    // Client error hook (2026-09-16): 15.00 -> 15.15 KB, measured at 15,140 B rebased
    // over #3479–#3488. This scenario renders <Errored>, so it carries the hook
    // module (core/error-hooks.ts: the ambient registration, once-per-error,
    // the owner-label walk), retained by `createErrorBoundary`'s report —
    // ~+180 B; pay-for-use, the price of a boundary that can tell a monitor
    // what it caught. Scenarios without a boundary did not move (`render`'s
    // write of `onError` onto the root owner is the only prod-floor cost).
    // `_parent` reserved from property mangling (2026-09-16): 15.15 -> 15.20 KB,
    // measured at 15,181 B. It is the second cross-package owner field beside
    // `_name`: solid-js walks it on signals' owners (hydration's snapshot
    // root — which the prod build was mis-marking while it was mangled) and
    // the core walks it on solid-js's server owners (`ownerPath`,
    // `OBSERVE.exclude`). ~+40 B across the prod scenarios; the observe ones
    // moved by gzip noise or shrank.
    // Reporter liveness reads this pass's deps; a dropped dep retires the reporter
    // and wakes every parked transaction (fuzzer #3446 P1, spec O3, 2026-09-16):
    // 15,170 B before the #3496 rebase (+30 over its base); 0 B minified in
    // the signals floor (24,578 flat). Combined with `_parent` mangling:
    // 15,250 B; cap ratcheted to the measured output.
    // Shared read predicates (DESIGN-CONSOLIDATION move 3b step 1, 2026-09-17):
    // readerSeesCommitted / visibleOverride / one hasActiveOverride. Minified
    // signals: core +13 B, +createStore -38 B, full bundle -72 B; brotli on the
    // pure-signals fixtures -4 / -29 / -5 B. This scenario's esbuild bundle
    // measured at 15,251 B rebased over #3507, against `next`'s 15,238 (+13 B).
    // Move 3b, one implementation per rule (#3523, 2026-09-17), rebased over
    // #3518/#3522: readerSeesCommitted / visibleOverride (step 1, merged as
    // #3515), the store's node reads through it (step 2), recordStaleReplay
    // (step 3), A29 at the store's untracked paths (step 4), S7, one ownership
    // relation ownsHold (6b) and serve() — Rule 1's one slow selection (6c).
    // Core minified: +31 (replay helper) +1 (enterStagedRead null node) +44
    // (ownsHold, not inlined) +88 (serve wrapper/parameter/guard) = +164 B.
    // Five store/signal divergences fixed (posture-store-parity S4, S5, S7, S8;
    // S6 ruled and deferred); every paired matrix state row-identical.
    // Measured at 15,342 B (+42 over the rebased cap).
    // A write is a proposal (A34, #3494 / #3519 review, 2026-09-17): 15,461 B against
    // `next`'s 15,342 (+119 B). Core-retained: `batchJoins` (a held node's
    // mainline write records the join and schedules; drained inside flush's
    // try, the fast sync path defers to it), the adoption loop's no-proposal
    // drop (signals and writable memos, through commitPendingNode), a
    // kept-tail pending mark re-deriving its subscriber (A30), and
    // reporterBlocksSource following `_pendingSources` one hop.
    // Born held exempts boundaries; `on` is a key (#3540, 2026-09-18): 15,617 B
    // against `next`'s 15,492 (+125 B). Core: the same +46 B as the core
    // floor note. Boundaries: `on` is a tracked key computed (`keyComputed`:
    // a NotReadyError from the key is `ON_INIT`, a real error forwards up the
    // queue chain), read by the boundary's output pass and reset there
    // (`_reset`, moved out of `notify`); `_checkSources` keeps a born-held
    // source collected until the commit initializes it; the priming read is a
    // `spectate` (no dependency link, no transaction entry).
    // rc.10: on follows the frame (#3540): 15,686 B against `next`'s 15,637
    // (+49 B). Core: the drain move (core floor note). Boundaries: `_rearm`
    // collects from the live transactions' reporter registrations through
    // `reporterBlocksSource` (now exported) and swaps (`_swap(lane)`) —
    // staged into the frame, or committed and notified on the lane the
    // on-node ran under (`_rearmLane`, from `currentOptimisticLane`); the
    // source-settled predicate is `_settled` (shared with the DEV sweep,
    // whose stub and flag are the only DEV bytes left in prod). Solid:
    // `<Errored on>` is gone.
    // Sync supersede wakes parked transactions (#3577, 2026-09-22): 15.70 ->
    // 15.75 KB, measured at 15,725 B against `next`'s 15,686 (+39 B). One
    // `wakeParked()` call on recompute's #3181 sync-settle branch (~15 B
    // minified); the rest is brotli layout. The other scenarios stayed
    // within their caps.
    // A pending fallback's boundary is judged before the verdict (#3540,
    // 2026-09-22): 15.75 -> 15.80 KB, measured at 15,764 B against `next`'s
    // 15,725 (+39 B), rebased over #3577 — the same core walk and boundaries
    // `_judgeHeld` / `_output` as the hydrating note.
    // Chrome performance tracks (2026-09-22): 15.70 -> 15.80 KB, measured at
    // 15,733 B against `next`'s 15,686 (+47 B), the minified bundle
    // structurally identical (same byte count; identifier-normalised diff
    // empty) — esbuild's name assignment under brotli, see the hydrating
    // note. The signals-only prod scenarios are byte-identical.
    // Rebased over #3586 and #3555 (2026-09-22): 15.80 -> 15.85 KB, measured
    // at 15,815 B against `next`'s 15,764 (+51 B). Re-verified: the minified
    // bundles are 44,649 B on both sides and differ only in which short name
    // esbuild assigns where; the same brotli noise as above, now on top of
    // the upstream bytes, which those PRs left 36 B under this cap.
    // A held derivation is not a proposal (#3612, 2026-09-23): 15.85 -> 15.90
    // KB, measured at 15,854 B against `next`'s 15,780 (+74 B; 4 B over the
    // cap). The signals core's `heldDerivation` / `rederiveHeld` behind
    // `setMemo` (+150 B minified, see the core floor note). 0 B in solid and
    // web.
    limit: "15.90 KB",
    modifyEsbuildConfig
  },
  {
    name: "app: CSR, observe tier (same app on the `observe` artifacts)",
    // The CSR scenario resolved through the `observe` condition. The delta
    // against the prod CSR scenario is the tier's retained cost.
    //
    // Introduction (2026-09-08): 14.20 KB measured against prod CSR's 12.91
    // — +1.29 KB. That is the wiring itself: ~40 null-checked hook call
    // sites, `_name` labels on owners and computations, live edge counters
    // with the two always-on graph-size warnings (HUGE_FAN_OUT/IN text
    // included), the diagnostics channel (subscribe/capture/emit/ownerPath),
    // the interaction frame, and solid-js's per-component labelled root.
    // An earlier draft of the tier measured 23.79 KB because the engine was
    // referenced statically from `OBSERVE.attribution`; it now lives behind
    // `@solidjs/signals/attribution` and is charged by the scenario below.
    path: "csr-app.js",
    // Effect ownership on finalize re-entry (#3319, 2026-09-09): 14.30 KB -> 14.34 KB,
    // measured at 14.302. Core scheduler cost; see the core-floor note.
    // Observe node shapes (#3324, 2026-09-09): 14.34 -> 14.40 KB, measured
    // at 14.332 (was 14.284 before the PR, on the post-golf next). Observe
    // now carries a second literal per node factory — prod's plus its
    // `_name`/`_owner` slot — instead of a post-construction write, so the
    // tier's node shapes stop transitioning (creation tests 2-3x under
    // polymorphic load as shipped, at parity after). Prod is byte-identical;
    // this scenario alone pays the duplicated literal bodies. Headroom
    // restored: the +48 B left 8 B under the old ratchet.
    //
    // Navigation origin frame (2026-09-09): 14.40 -> 14.44 KB, measured at
    // 14.36 on top of #3324. `OBSERVE.attribution.withOrigin` (the
    // router-agnostic navigation seam, a twin of withInteraction) and the
    // `flushEnd` hook site after flush()'s drain loop. Observe-only: prod
    // folds both out.
    // mapArray SMALL-MOVE fast path (#3227, rebased 2026-09-10): 14.44 KB ->
    // 15.04 KB, measured at 14.99 on the rebased tree (+610 B over 14.38).
    // See the hydrating (no stores) note; same cost, every <For> scenario.
    //
    // Excluded owners (2026-09-10): measured at 14.43 on top of 14.38, still
    // under the ratchet. `OBSERVE.exclude`/`isExcluded` (the observer's own
    // subtree) and the owner-chain check in emitDiagnostic. Observe-only.
    //
    // Shape freeze (#3349, rebased 2026-09-10): 15.04 -> 15.08 KB, measured
    // at 15.03 on the rebased tree (+40 B over #3227's 14.99). No code this
    // scenario ships changed beyond exclude/isExcluded; dropping
    // `NavigationRef.until` from the engine (not bundled here) shifted the
    // build-wide property-mangler map, renaming one core slot in the shared
    // chunks, and the new name compresses worse. Mangler noise, not cost —
    // the pre-mangle bundle is byte-identical.
    //
    // Lane authority (#3335, #3334, #3330, #3331, A15 re-rule; ported from
    // #3347 onto `next` @ 4935c7dd, 2026-09-11): 15.04 -> 15.27 KB, measured
    // at 15269 B against `next`'s 15037 (+232 B) — the core seams (see the
    // core floor note)
    // and, where the app retains lanes, the engine they dispatch to.
    //
    // Conditional pending recovery (#3371, 2026-09-11): a memo that drops
    // a pending source and recovers to an unchanged value retires that
    // source from the dependents it orphaned (settlePendingSource takes a
    // `source`; retryReaches is core-retained as the alternate-path
    // guard). +191 B minified in the in-package floor (22,457 -> 22,648);
    // measured here at 15371 B against the 15.30 KB cap.
    // Second write while an async chain is in flight (#3373–#3376,
    // 2026-09-12): 15.40 -> 15.45 KB, measured at 15410 B against `next`'s
    // 15371 (+39 — the core seams and the collecting boundary).
    // Boundary reset ends the hold (#3375 ruling, 2026-09-12): 15.45 -> 15.50 KB,
    // measured at 15465 B against 15410 (+55); see the core floor note.
    // #3372/#3377 (2026-09-12): 15.50 -> 15.55 KB, measured at 15511 B against 15465
    // (+46); see the core floor note.
    //
    // Server observe slot (#3398, 2026-09-12): `OBSERVE.server` — the empty
    // object the server runtime populates (invocation channel, trace
    // provider). One literal property on the observe object, inert on the
    // client by design. Measured at 15501 B against 15485 without the slot
    // on the same `next` (+16), within the 15.55 KB cap. Observe-only.
    // Held children (#3404, 2026-09-13): 15.55 -> 15.60 KB, measured at
    // 15562 B on the merge with `next`; see the createStore note.
    // Held-input rules (#3408, #3410; 2026-09-14, on top of #3434): 15.60 ->
    // 15.65 KB, measured at 15630 B against `next` (#3434 head) — `enterStagedRead` on read()'s value
    // selections and the deferred dependency trim; see the core floor note.
    // Overlapping flights (#3443, #3444; 2026-09-14, on top of #3442): 15.65 ->
    // 15.70 KB, measured at 15681 B — pending propagation onto a held memo enters
    // its transaction, and a lane-dirtied zombie runs instead of being
    // cancelled (+54 B minified in the in-package floor); see the core floor note.
    // Born held (A29 creation-time form, #3451; 2026-09-15): 15.70 -> 15.90 KB,
    // measured at 15811 B against `next`'s 15679 (+132); the signals-core
    // bytes from the core floor note, nothing app-side.
    // Records channel (#3472, 2026-09-15): 15.90 -> 16.05 KB, measured at
    // 16027 B against `next`'s 15811 (+216). `OBSERVE.records` — the one
    // channel every runtime record rides (subscribe/observed/emit, one Map of
    // listener sets, registered on globalThis) — and the attribution slot's
    // `currentOrigin` query with the installed engine's globalThis
    // registration. Observe-only by construction: the prod scenarios above
    // did not move, and the frames prod scenario below folds its emitters.
    // A28 — writes visible at flush, read-side (2026-09-15): measured at 16311 B
    // on top of #3472 (+233 B); the signals core delta, see the core floor note.
    // Hold-consistency batch 2 (#3479, 2026-09-15): measured at 16,453 B; the signals
    // core delta, see the core floor note.
    // Client error hook (2026-09-16): 16.55 -> 16.70 KB, measured at 16,688 B rebased
    // over #3479–#3488. This scenario renders <Errored>, so it carries the hook
    // module (core/error-hooks.ts: the ambient registration, once-per-error,
    // the owner-label walk), retained by `createErrorBoundary`'s report —
    // ~+170 B; pay-for-use, the price of a boundary that can tell a monitor
    // what it caught. Scenarios without a boundary did not move (`render`'s
    // write of `onError` onto the root owner is the only prod-floor cost).
    // Reporter liveness reads this pass's deps; a dropped dep retires the reporter
    // and wakes every parked transaction (fuzzer #3446 P1, spec O3, 2026-09-16):
    // 16,730 B (+40 over base); 0 B minified in the signals floor (24,578 flat).
    // One `unflushed` for signal and store (spec O4, 2026-09-16): 16,770 B (+20 over
    // the cap); CONFIG_ADOPTED_UNFLUSHED set at adoption, cleared by the carrying
    // flush; +56 B minified in the signals floor (25,193 -> 25,249).
    // Error hook thrower/boundary paths (2026-09-17): 16.80 -> 16.85 KB,
    // measured at 16,804 B rebased over #3515, against `next`'s 16,752 (+52 B).
    // A write is a proposal (A34, #3494 / #3519 review, 2026-09-17): 16,937 B against
    // `next`'s 16,846 (+91 B). Core-retained: `batchJoins` (a held node's
    // mainline write records the join and schedules; drained inside flush's
    // try, the fast sync path defers to it), the adoption loop's no-proposal
    // drop (signals and writable memos, through commitPendingNode), a
    // kept-tail pending mark re-deriving its subscriber (A30), and
    // reporterBlocksSource following `_pendingSources` one hop.
    // Born held exempts boundaries; `on` is a key (#3540, 2026-09-18): 17,090 B
    // against `next`'s 16,965 (+125 B). Core: the same +46 B as the core
    // floor note. Boundaries: `on` is a tracked key computed (`keyComputed`:
    // a NotReadyError from the key is `ON_INIT`, a real error forwards up the
    // queue chain), read by the boundary's output pass and reset there
    // (`_reset`, moved out of `notify`); `_checkSources` keeps a born-held
    // source collected until the commit initializes it; the priming read is a
    // `spectate`. Observe: the boundaryFallback attribution call moved with
    // the reset.
    // rc.10: on follows the frame (#3540): 17,247 B against `next`'s 17,127
    // (+120 B) — the CSR note's core + boundaries + solid deltas; observe:
    // the boundaryFallback attribution call moved into `_swap`.
    // A pending fallback's boundary is judged before the verdict (#3540,
    // 2026-09-22): 17.30 -> 17.35 KB, measured at 17,311 B against `next`'s
    // 17,230 (+81 B), rebased over #3577 — the CSR note's core walk and
    // boundaries `_judgeHeld` / `_output` (+39 B there); no observe-gated
    // bytes added (the boundaryFallback call site is untouched), the rest is
    // brotli layout over the tier's wiring.
    // Chrome performance tracks, Stages 0–4 (2026-09-22): 17.30 -> 17.40 KB,
    // measured at 17,330 B against `next`'s 17,247 (+83 B). The tier's
    // share of the tracks work: the `flushStart` hook site beside `flushEnd`,
    // `effectRunStart/End` moved from `__DEV__` to `__OBSERVE__` (the
    // effect-callback record), `_name`s on the flow controls' internal nodes
    // (`children`, `boundary`, `value`, `reveal order`, `conditions`) and on
    // compiled binding effects (`span.textContent`, and `div.spread` /
    // `div.children` through web's `spreadName`), and the store's declared
    // name on its property nodes (`nameStore`/`storeLabel`). Prod: the
    // signals-only scenarios and frames byte-identical; the app scenarios
    // structurally identical (see the hydrating and CSR notes).
    // Fallback records time the display, not the swap (#3575 rebase): 17,402 B
    // (+72 B) — the two boundaryFallback show sites pass the transaction the
    // swap is staged in (`activeTransition`, or null for a lane swap).
    // Inherited from `next` (#3606, recorded 2026-09-23 while landing #3600):
    // 17.45 -> 17.50 KB, measured at 17,455 B on `next` at ed60f054a (17.43
    // KB at #3605's a10d33ba3) and 17,455 with #3600 on top (0 B from
    // #3600). #3606's `runDisposal`
    // detach-before-run in the signals core landed over #3605 without a
    // bump (its PR CI ran on the pre-#3605 base) and left this scenario 5 B
    // over. Prod CSR is 15,819, byte-identical either way.
    limit: "17.5 KB",
    modifyEsbuildConfig: observeEsbuildConfig
  },
  {
    name: "app: CSR, observe tier + attribution engine enabled",
    // The observe CSR scenario plus `solid-js/attribution` imported and
    // enabled. The delta against the scenario above is the engine — the
    // cost an observe consumer pays only when it turns attribution on.
    //
    // Introduction (2026-09-08): 23.91 KB, i.e. the engine is 9.7 KB brotli.
    // Its record types still carry live nodes (`RerunEvent.node`) and its
    // formatters ride along with `enable()`; slimming both is the follow-up
    // in documentation/plans/observe-tier-plan.md.
    path: "csr-app-attribution.js",
    // Contested-effect re-derivation (#3322, 2026-09-09): 24.00 -> 24.08 KB,
    // measured at 24.04. Core scheduler cost; see the core-floor note.
    // Observe node shapes (#3324, 2026-09-09): 24.08 -> 24.14 KB, measured
    // at 24.079 (1 B under the old ratchet). The literal duplication above
    // is offset here by the engine dropping the live `_subCount`/`_depCount`
    // machinery: WIDE_WRITE counts the subscriber list on the write and
    // hands over to HUGE_FAN_OUT at 2000. Ratchet restores headroom only.
    //
    // Navigations (2026-09-09): 24.14 -> 24.90 KB, measured at 24.86. The
    // engine's navigation records: the `navigation` origin kind and its
    // formatting, one NavigationEvent per withOrigin frame settled through
    // flushEnd / hold commit / supersession, `HoldEvent.origin` and the
    // route-named SILENT_HOLD/LONG_HOLD actor, and the `feedback().navigations`
    // fold. Engine-only cost; the observe tier above moved 30 B.
    //
    // Redirects + late-bound refs + census fix (2026-09-09): 24.90 -> 25.20 KB,
    // measured at 25.16. Redirect hops folding onto the pending navigation
    // (`NavigationEvent.redirects`, the "redirected from" formatting), the
    // ref re-read at settle, and the hold census requiring a companion to
    // reach an effect rather than any subscriber. Engine-only; the observe
    // tier above did not move.
    //
    // Halt -> reportError (#3338, 2026-09-10): 25.20 -> 25.26 KB, measured at
    // 25.22 (+60 B over the pre-#3338 25.16). The same ~20 B haltReactivity
    // change as the hydrating scenario, compressing worse on the observe
    // tier's layout; the observe CSR scenario above did not move. Nothing
    // engine-side changed.
    //
    // mapArray SMALL-MOVE fast path (#3227, rebased 2026-09-10): 25.26 KB ->
    // 25.87 KB, measured at 25.82 on the rebased tree (+600 B over 25.22).
    // See the hydrating (no stores) note; same cost, every <For> scenario.
    //
    // Shape freeze (#3349, rebased 2026-09-10): 25.87 -> 26.65 KB, measured
    // at 26.60 on the rebased tree (+780 B over #3227's 25.82; the PR's own
    // base measured 25.22 -> 25.98). One InteractionEvent per
    // withInteraction dispatch settled
    // through the same drain/hold clock as navigations (runs, created, holds
    // and navigations attached), the typed record channel (`subscribe(type)`),
    // `RerunEvent.at`/`HoldEvent.at`, `HoldEvent.acknowledgements` (the
    // structured face, with the reader's owner path) replacing the
    // `acknowledgedBy` strings, and the excluded-node check. Engine-only;
    // the observe tier above moved 50 B for `OBSERVE.exclude`/`isExcluded`
    // and the suppression check in emitDiagnostic. A golf pass measured the
    // dedup helpers (a shared reset, a shared ledger open) as brotli
    // negatives — the duplicated blocks were already back-references — and
    // kept only the collapses that shrank the compressed output. A draft
    // carried `NavigationRef.until` with same-ref re-entry (160 B) for
    // routers that await loaders outside the graph; dropped before landing
    // in favour of one rule for every router — wrap the write whose landing
    // is the destination showing, pass `at` — with the loader wait itself
    // being router work (see 08-dev-diagnostics.md, Navigations).
    // Incremental heap marking (#3350, 2026-09-10): 26.65 -> 26.68 KB,
    // measured at 26.652 against next's 26.598. The insertIntoHeap change is
    // a one-call swap that dropped a flag test; the CSR observe scenario on
    // the same artifacts did not move, so this is brotli layout drift.
    //
    // Lane authority (#3335, #3334, #3330, #3331, A15 re-rule; ported from
    // #3347 onto `next` @ 4935c7dd, 2026-09-11): 26.65 -> 26.82 KB, measured
    // at 26819 B against `next`'s 26652 (+167 B) — the core seams (see the
    // core floor note)
    // and, where the app retains lanes, the engine they dispatch to.
    //
    // Conditional pending recovery (#3371, 2026-09-11): a memo that drops
    // a pending source and recovers to an unchanged value retires that
    // source from the dependents it orphaned (settlePendingSource takes a
    // `source`; retryReaches is core-retained as the alternate-path
    // guard). +191 B minified in the in-package floor (22,457 -> 22,648);
    // measured here at 26888 B against the 26.85 KB cap.
    // Second write while an async chain is in flight (#3373–#3376,
    // 2026-09-12): 26.92 -> 26.95 KB, measured at 26930 B against `next`'s
    // 26888 (+42 — the core seams and the collecting boundary).
    // Boundary reset ends the hold (#3375 ruling, 2026-09-12): 26.95 -> 27.05 KB,
    // measured at 26978 B against 26930 (+48); see the core floor note.
    // #3372/#3377 (2026-09-12): 27.05 -> 27.10 KB, measured at 27066 B against 26978
    // (+88); see the core floor note.
    //
    // Excluded writes (#3380, 2026-09-12): 27.10 -> 27.16 KB, measured at
    // 27090 B against 27066 (+24; +56 on the pre-rebase base). A root write
    // to an excluded subject (the observer's own store) no longer counts
    // toward the interaction, and an interaction whose writes all went there
    // with none of the app's work run is forgotten rather than reported idle.
    // Store nodes now carry their root's creating owner (`_owner`) so they
    // are excluded subjects like signals — that part lives in store.ts and
    // no observe scenario bundles stores; the observe CSR scenario above did
    // not move.
    // #3426/#3427/#3407 (2026-09-14): 27.16 -> 27.25 KB, measured at 27203 B
    // against `next`'s 27109 (+94 — the core seams on the observe artifacts);
    // see the core floor note.
    // Born held (A29 creation-time form, #3451; 2026-09-15): 27.25 -> 27.45 KB,
    // measured at 27350 B against `next`'s 27227 (+123); the signals-core
    // bytes from the core floor note, nothing app-side.
    // Records channel (#3472, 2026-09-15): 27.45 -> 27.70 KB, measured at
    // 27673 B against `next`'s 27350 (+323): the +216 from the observe CSR
    // note plus the engine's answer to `currentOrigin` — the root origin a
    // recompute's causes trace back to, else the ambient frame.
    // A28 — writes visible at flush, read-side (2026-09-15): measured at 27909 B
    // on top of #3472 (+286 B); the signals core delta, see the core floor note.
    // Hold-consistency batch 2 (#3479, 2026-09-15): measured at 28,098 B; the signals
    // core delta, see the core floor note.
    // Client error hook (2026-09-16): 28.20 -> 28.35 KB, measured at 28,350 B rebased
    // over #3479–#3488. This scenario renders <Errored>, so it carries the hook
    // module (core/error-hooks.ts: the ambient registration, once-per-error,
    // the owner-label walk), retained by `createErrorBoundary`'s report —
    // ~+160 B; pay-for-use, the price of a boundary that can tell a monitor
    // what it caught. Scenarios without a boundary did not move (`render`'s
    // write of `onError` onto the root owner is the only prod-floor cost).
    // Reporter-liveness fix rebased over `_parent` mangling (#3495 + #3496,
    // 2026-09-16): measured at 28,363 B; combined brotli layout drift.
    // A projection's leaf companions die with it; latest() of a dead leaf creates
    // none (spec O5, 2026-09-16): 28,392 B (+22 over the cap); +104 B minified in
    // owner.ts (core floor), the shadow retirement lives in verdict.ts.
    // Engine folds split out (rebased 2026-09-16): 28.40 -> 27.25 KB, measured
    // at 27,169 B against `next`'s 28,392 (-1,223 B). `costs()`, `feedback()`,
    // `why()`, and `subscriptions()` are named exports whose modules register
    // with the engine's fold seam on import; this scenario is a records
    // consumer (enable, subscribe, formatRerun) and ships none of them. The
    // formatters stay in the engine because the `log` option prints through
    // them. Ratcheted down to pin the reduction.
    // Shared read predicates (DESIGN-CONSOLIDATION move 3b step 1, 2026-09-17):
    // measured at 27,256 B rebased over #3507, against `next`'s 27,196 (+60 B).
    // The source change is in the signals core; this scenario's attribution
    // modules only alter the compressor layout.
    // Move 3b, one implementation per rule (#3523, 2026-09-17), rebased over
    // #3518/#3522: readerSeesCommitted / visibleOverride (step 1, merged as
    // #3515), the store's node reads through it (step 2), recordStaleReplay
    // (step 3), A29 at the store's untracked paths (step 4), S7, one ownership
    // relation ownsHold (6b) and serve() — Rule 1's one slow selection (6c).
    // Core minified: +31 (replay helper) +1 (enterStagedRead null node) +44
    // (ownsHold, not inlined) +88 (serve wrapper/parameter/guard) = +164 B. +55 B store (S7, an optimistic override survives its key becoming
    // unobserved), +123 / +130 B store (S4 / S5 fixes at the backing and the
    // untracked node paths).
    // Five store/signal divergences fixed (posture-store-parity S4, S5, S7, S8;
    // S6 ruled and deferred); every paired matrix state row-identical.
    // Measured at 27,335 B (+35 over the rebased cap).
    // A write is a proposal (A34, #3494 / #3519 review, 2026-09-17): 27,426 B against
    // `next`'s 27,335 (+91 B). Core-retained: `batchJoins` (a held node's
    // mainline write records the join and schedules; drained inside flush's
    // try, the fast sync path defers to it), the adoption loop's no-proposal
    // drop (signals and writable memos, through commitPendingNode), a
    // kept-tail pending mark re-deriving its subscriber (A30), and
    // reporterBlocksSource following `_pendingSources` one hop.
    // Born held exempts boundaries; `on` is a key (#3540, 2026-09-18): 27,579 B
    // against `next`'s 27,448 (+131 B). Core: the same +46 B as the core
    // floor note. Boundaries: `on` is a tracked key computed (`keyComputed`:
    // a NotReadyError from the key is `ON_INIT`, a real error forwards up the
    // queue chain), read by the boundary's output pass and reset there
    // (`_reset`, moved out of `notify`); `_checkSources` keeps a born-held
    // source collected until the commit initializes it; the priming read is a
    // `spectate`. Observe: the boundaryFallback attribution call moved with
    // the reset.
    // `on` is a dependency list; re-arm at the finalize (#3540, 2026-09-21):
    // 27,614 B, +14 B over the cap — `keyComputed` / `ON_INIT` / `_prevOn`
    // become the on-node (`queueRearm` on every run after the first), and
    // `_reset` becomes `_rearm` + `_retry` (shared with the error fallback's
    // `reset()`); the scheduler gains `pendingRearms` and its finalize drain.
    // rc.10: on follows the frame (#3540): 27,701 B against `next`'s 27,614
    // (+87 B) — the CSR observe note's deltas; 0 B in the attribution
    // engine.
    // Pending-fallback reveal (#3581, 2026-09-22): 27.75 -> 27.80 KB, measured
    // at 27,756 B against 5e467329e's 27,704 (+52 B; 6 B over the old cap).
    // #3581 re-set the isPending/hydrating/CSR/CSR-observe caps but not this
    // one (its own measurement landed at 27,743, 7 B under). The bytes are the
    // pre-verdict boundary judgment (`_judgeHeld` / `_output` in
    // boundaries.ts) and the scheduler's `checkBoundaryChildren` walk in
    // core/scheduler.ts; no attribution-engine change.
    // Chrome performance tracks, Stages 0–4 (2026-09-22): 27.75 -> 28.60 KB,
    // measured at 28,504 B against `next`'s 27,701 (+803 B, of which +83
    // is the tier's, above). The engine's side: ref-counted
    // enable()/disable() with per-hold listener release, the `checks`
    // option, `isSilentHold`/`isLongHold` on the entry, `at`/`inputDelayMs`
    // on interactions, and the five timeline records a profiler track reads —
    // `flush`, `create`, `effect`, `flight`, `fallback` — each built only
    // while a listener exists, plus `nodeId` on derived cause records (the
    // Propagation track's node-to-node link). The enabled hot path was
    // re-benchmarked at the `next` baseline after the effect-frame WeakMap
    // was made lazy (see the Stage 2 note in
    // documentation/plans/chrome-performance-tracks-plan.md).
    // Fallback records time the display, not the swap (#3575 rebase): 28,757 B
    // (+253 B, of which +72 is the tier's, above). The engine holds a shown
    // fallback as staged under its transaction (or the current drain), moves
    // it to the drain at `transitionSettled`, follows `transitionMerged`, and
    // stamps its `at` at `flushEnd`; a hide before that drops it unrecorded —
    // a swap the content outran, or one the commit's sweep cleared before
    // any effect ran, was never on screen. The folds hear show/hide from the
    // same gate, so the feedback fold's shows/flashes agree.
    // enable() as a hold with a release; options merged by the most demanding
    // request (#3580 review, 2026-09-22): 28.85 -> 29.00 KB, measured at
    // 28,951 B (+194 B over the 28,757 above, 0 B in the tier). The holds
    // array and its release closure, `disable()` as the full teardown, and
    // `resolveHold`/`demanding`: each hold's request filled from the defaults
    // (`checks: false` folding its five checks first), then combined per key
    // — booleans OR, `historyLimit` max, a config over `false`, between
    // configs the lower bound and the longer `windowMs` — so the result is
    // independent of the order holds were taken. Engine-only.
    // A node disposed during its own pass stays disposed (#3621, 2026-09-23):
    // 29.00 -> 29.05 KB, measured at 28,999 B against `next`'s 28,965 (+34 B,
    // 1 B under the cap — ratcheted for Linux headroom). The signals core's
    // void-pass arm (see the core floor note) plus, on this tier, its paired
    // `recomputeEnd` call — the one early return recompute has, and the hook
    // contract says start and end always pair. 0 B in the engine.
    // UNTRACKED_ASYNC_HANDLER (2026-09-23, rebased): 29.05 -> 29.45 KB, measured at
    // 29,368 B on a full build (+369 B over next's 28,999; 80 B of Linux headroom). A handler that returns a thenable keeps
    // its InteractionEvent open until it settles (a 10s cap timer, `continuationMs`),
    // then the check: no write before the await and no action step under the frame
    // means no hold could have shown the wait — the message carries the two repairs.
    // Most of the bytes are that text. The tier moved 65 B for the return value
    // through `interactionEnd(returned)`; under its cap.
    // Re-measured at landing (rebased over #3630/#3631/#3617/#3629,
    // 2026-09-23): 29,408 B against `next`'s 29,018 (+390 B; 42 B of headroom
    // under the same cap). The tier is 17,487 against `next`'s 17,482 (+5 B) —
    // #3630's core bytes moved the compressor layout under both figures above.
    limit: "29.45 KB",
    modifyEsbuildConfig: observeEsbuildConfig
  },
  {
    name: "frames: eager client consumer (frames client + transport, lazy codec)",
    // 10.37 KB measured after Stage 5 (container tier): the eager halves
    // are deliberately tiny — the trace materializer install + the
    // document-face marker reviver + the WeakSet container probe guarding
    // the props proxy and the host's identity-only compare hook. The
    // seroval trace plugin itself rides the codec's DEFAULT plugin set in
    // dom-expressions, so its weight stays in the lazy codec chunk this
    // scenario excludes.
    //
    // 10.4 -> 11.1 KB, measured at 10.87: the settled dom-expressions batch
    // — §9.1 Stage 6 (behavior props / client-component kill) in the frames
    // client plus server-function call observers (pr-570) in the transport.
    // Verified via metafile that the bundle is still exactly the two dist
    // files (no seroval creep — the regression this scenario guards).
    //
    // Typed preload links: 11.06 -> 11.27 KB measured on the rc.5 base
    // (~210 B). Frames now preserve request metadata (ensurePreload +
    // qualifier-aware head matching), adopt matching document links, and
    // retain every late root asset record for mounts that register after
    // the stream arrives.
    //
    // Responsive image preloads (2026-09-01): 11.34 -> 11.37 KB, measured at
    // 11.360 (+40 B on top of the identity commit). Frame consumers locate
    // and create a source-set link with no href — adoption matches on a null
    // href — and the wire entry drops the key when there is none.
    //
    // Canonical qualifier matching (2026-09-01): 11.37 -> 11.38 KB, measured
    // at 11.374 (+14 B). The frame client's mirrored `qualifierValue` folds
    // `as` and reads an empty source set or size as absent, so a document
    // link spelled `as="IMAGE"` or carrying `imagesrcset=""` adopts instead
    // of duplicating — the same rules head.ts applies.
    //
    // Rebased onto next after the patch-channel removal (2026-09-02):
    // 11.30 -> 11.40 KB, measured at 11.372 against next's 11.266 — +106 B
    // for the whole branch (identity canonicalization, the source-set form,
    // and the mirrored qualifier folding above). The per-commit notes were
    // measured on the pre-removal base, so their absolutes no longer line
    // up with this file's floor, but their deltas do.
    //
    // Seams behind `solid-js/internal` (#3470, 2026-09-15): 11.40 -> 11.45 KB,
    // measured at 11442 B against `next`'s 11370 (+72 brotli on +31 minified).
    // Nothing in this bundle changed but one import's SPECIFIER:
    // `materializeContainerTrace` used to fold into the single
    // `from "solid-js"` statement and is now its own `from "solid-js/internal"`
    // statement, which brotli cannot share with the first; the module is
    // external either way. The price of taking the view protocol and the
    // server-scope seams off the public `solid-js` surface.
    path: "../../packages/web/frames/dist/client.js",
    limit: "11.45 KB",
    modifyEsbuildConfig: framesEsbuildConfig
  }
];
