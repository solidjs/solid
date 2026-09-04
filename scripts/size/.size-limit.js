// Import-cost scenarios for #2883, measured against the built browser-prod
// artifacts. Bare specifiers resolve via esbuild aliases so nothing here
// touches the workspace dependency graph. Limits carry ~5% headroom over the
// sizes at landing: a breach means tree-shaking regressed (or a deliberate
// feature landed — bump the limit in the same PR and say why). The simple-app
// scenario is pinned at 10 KB on purpose.
const alias = {
  "solid-js": "../../packages/solid/dist/solid.js",
  "@solidjs/web": "../../packages/web/dist/web.js",
  "@solidjs/signals": "../../packages/signals/dist/prod/index.js"
};
const modifyEsbuildConfig = config => ({ ...config, alias });

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
    limit: "8.00 KB",
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
    limit: "14.35 KB",
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
    limit: "10.08 KB",
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

    //
    // Unified For slot, default-on (2026-09-04): 10.73 -> 10.89 KB, measured
    // at 10.884. The floor has NO For — this is the ENGAGEMENT SEAM only:
    // insert's `$for.impl` call site plus the domOps singleton (the platform
    // web hands the slot). The slot algorithm itself rides For's module
    // graph in solid-js and tree-shakes out of For-less apps like this one.
    limit: "10.89 KB",
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
    //
    // Unified For slot, default-on (2026-09-04): 17.61 -> 19.76 KB, measured
    // at 19.75. THE deliberate bill: this scenario renders <For>, so it
    // retains the slot (~2.1 KB) through For's own module graph — every
    // keyed For gets chain+LIS structural updates and flat-mode mounts with
    // zero API and zero compiler involvement (jfb-signal structural geomean
    // 0.63, uibench 0.73, creates at parity — see DESIGN-UNIFIED-FOR.md).
    // Hydration claiming declines to classic at runtime today; the bytes
    // still ride for post-hydration mounts.
    limit: "19.76 KB",
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
    // Unified For slot, default-on (2026-09-04): 26.43 -> 28.64 KB — the
    // slot bytes through For's module graph (see the hydrating no-stores
    // note).
    limit: "28.64 KB",
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
    // Unified For slot, default-on (2026-09-04): 12.97 -> 15.20 KB, measured
    // at 15.19 — the slot bytes through For's module graph (see the
    // hydrating no-stores note).
    limit: "15.20 KB",
    modifyEsbuildConfig
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
    path: "../../packages/web/frames/dist/client.js",
    limit: "11.40 KB",
    modifyEsbuildConfig: framesEsbuildConfig
  }
];
