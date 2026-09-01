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
    // Re-audit-6 (2026-08-28): same-channel merge coalescing in
    // mergeTransitionState (both stashes holding the same record's entry
    // now collapse to one live-resolving entry). Core-retained; measured
    // 7.91.
    //
    // Re-audit-9 (2026-08-29): forced-entry dedup + stamp retargeting in
    // the merge path. Measured 7.92.
    //
    // #3122 eager iterator teardown (upstream, 2026-08-31): the
    // _flightTeardown release sits on recompute's supersede path, which the
    // core loop always retains. Measured 7.88 post-rebase.
    limit: "8 KB",
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
    // Re-audit-6 (2026-08-28): merge coalescing (core, see the core-floor
    // note) plus the prod-sound getter-demotion seams — accessed-key union
    // on the channel (pc.ak) and the targetKeysPlain bounded probe at both
    // adoption emission sites, replacing the dev-only check. Measured 14.46.
    //
    // Re-audit-7 (2026-08-28): stateless adoption probes (gates take the
    // incoming backing + prototype check), deep-path probe machinery
    // (deepPathsPlain), split normal/optimistic stamps, and the reconcile
    // root ancestor bubble — all on store paths createStore retains.
    // Measured 14.58.
    //
    // Re-audit-9 (2026-08-29): held-view admission, committed-visible skip
    // markers, tentative self-emission, unchanged-reconcile gate, function-
    // intermediate probes. Measured 14.80.
    // Rebase onto next (2026-08-31): upstream rc.5 drift stacks with the
    // branch bytes. Measured 14.99.
    //
    // #3122/#3123 correctness batch (upstream, 2026-08-31): the #3122
    // teardown core bytes plus the store-walk exports
    // (arrayStructureChanged/membershipChanged) the landing-contradiction
    // gate reads; the replay machinery itself stays in the optimistic
    // module (see the store-family app scenario). Held at 14.99 post-rebase
    // — the earlier replay landing was already absorbed here.
    //
    // #3164 fold ruling (upstream, 2026-09-01): heldTruthNodes ledger +
    // retainsOptimism seams ride paths createStore retains. Measured 15.12
    // post-rebase.
    // Fold-audit round (2026-09-01): staged-truth fold marker + fold-site
    // row/slot emissions (reveal coverage), per-index held-slot defers, and
    // the drain-end late sweep (no resync-then-ops double-builds). Measured 15.19.
    // Fold audit 2 (2026-09-01): transition-aware version init, reveal
    // channel split, target-keyed staged identity, release fast-forward.
    // Measured 15.22.
    // Fold audit 3 (2026-09-01): held-queue av init, reorder classification,
    // reveal single-notification mark. Measured 15.27.
    // Fold audit 4 (2026-09-01): eager visible-version, epoch-stamped
    // proven reveal marks, primitive-multiset reorder classification.
    // Measured 15.38.
    // Entanglement rebase drift (2026-09-01, until-flip + CONFIG_HELD_TRUTH).
    limit: "15.45 KB",
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
    // Re-audit-6 (2026-08-28): merge coalescing (core) — this scenario had
    // ~no headroom left after the audit-5 ripple. Measured 9.93.
    //
    // #3104/#3122 correctness batch (upstream, 2026-08-31): the
    // latest()/collectPending probe-suspension symmetry (#3104) lives in
    // the verdict layer this scenario exists to measure; the rest is the
    // #3122 teardown core bytes. Measured 9.89 post-rebase.
    // Entanglement rebase drift (2026-09-01, canonical push): boundary
    // wobble headroom.
    limit: "10.05 KB",
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
    // Re-audit-6 (2026-08-28): merge coalescing (core). Measured 10.70.
    path: "minimal-app.js",
    // Rebase drift (2026-09-01, #3169-#3176 + fold-ledger relocation).
    // Measured 10.76.
    // Entanglement rebase drift (2026-09-01, canonical push): boundary
    // wobble headroom.
    limit: "10.85 KB",
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
    // Re-audit-6 (2026-08-28): merge coalescing (core). Measured 17.56.
    limit: "17.65 KB",
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
    // Re-audit-6 (2026-08-28): merge coalescing (core) + the getter-
    // demotion recording/probe seams (see the createStore note; this
    // scenario retains the store engine). Measured 26.13.
    //
    // Re-audit-7 perf pass: manifest interning (WeakMap cache + prefix-tree
    // builder) so list mounts stopped re-processing per row. Measured 26.28.
    //
    // Re-audit-8 (2026-08-28): committed-view admission, generation-stamped
    // drains, forced-bubble coalescing stamps, tentative ancestor bubbling.
    // Measured 26.35.
    // Round-10 (2026-08-31): primitive-owned ancestor bubbling, boundary
    // hold routing (per-entry queue defer), demotion fanout isolation,
    // family retention token. Measured 26.47.
    path: "hydrating-store-app.js",
    // Round-10.9 (2026-08-31): demotion-lifecycle bytes (per-entry
    // envelopes, commit skip, akAll refcount). Measured 26.56.
    // Rebase onto next (2026-08-31): upstream drift + lifecycle fixes
    // stack with the branch bytes. Measured 27.06.
    // #3123 function-of-truth replay (upstream, 2026-08-31): retained
    // setter replay, flight-gate threading, keyed echo dedupe, and settle-
    // time re-derivation — this scenario retains every store family, so it
    // pays the whole optimistic module. Ruled correctness-over-size in the
    // #3123 thread. Measured 27.10 post-rebase (the earlier replay landing
    // was already absorbed in this budget).
    // Structural audit (2026-08-31): one-reckoning landing notification
    // (review commit 3e12ffdb) + superseded-work generation stamps and the
    // rebuilt late-registrant sweep. Measured 27.18.
    // #3164 fold ruling (upstream, 2026-09-01): the fold/reveal machinery
    // replaces replay wholesale; net near-wash here after the branch's
    // landing hook + generation stamps were deleted with the contract they
    // served. Measured 27.21 post-rebase.
    // Fold-audit round (2026-09-01): staged-truth fold marker + fold-site
    // row/slot emissions (reveal coverage), per-index held-slot defers, and
    // the drain-end late sweep (no resync-then-ops double-builds). Measured 27.30.
    // Version-chain redesign (2026-09-01): snapshot/watermark/sweep
    // machinery replaced by per-entry applied-version chains + ONE
    // flush-end resync + registration-time ancestor repair. Flat cost —
    // the per-finding mechanism accretion this class caused stops here. Measured 27.37.
    // Fold audit 4 (2026-09-01): eager visible-version, epoch-stamped
    // proven reveal marks, primitive-multiset reorder classification.
    // Measured 27.52.
    // Rebase drift (2026-09-01, #3169-#3176 + fold-ledger relocation).
    // Measured 27.56.
    // Fold audit 6 (2026-09-01): delivery-consumed dn overrides (INV-6) +
    // two-key-space matcher (mixed identities, undefined moves). Measured
    // 27.63.
    limit: "27.65 KB",
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
    // Re-audit-9 (2026-08-29): the merge-path core bytes (see core floor).
    // Measured 12.90.
    //
    // #3122 eager iterator teardown (upstream, 2026-08-31): the core-floor
    // teardown bytes (see that note). Measured 12.93 post-rebase.
    path: "csr-app.js",
    // Entanglement rebase drift (2026-09-01, canonical push): boundary
    // wobble headroom.
    limit: "13.05 KB",
    modifyEsbuildConfig
  },
  {
    name: "app: CSR default-on — + patchDriver (non-list patch templates)",
    // FLIP LANDED (2026-08-28): patch mode is the compiler default in both
    // Babel and Oxc; this is no longer a preview, it's what ~every app
    // ships. Opt out: patchDriver: false.
    //
    // What patch-mode DEFAULT-ON adds to ~every app: nearly any real
    // template has one eligible pure member-read binding, so the compiler
    // emits at least one patchDriver call — retaining the dual driver and
    // the store channel's value-tier machinery: registration, the apply
    // queue/drains, error routing, and the demotion path (~1.5 KB brotli
    // over the classic app). NOT here: the list driver (only rowProof arms
    // the insert seam) and the row-ops emitters + reconcile diff builders
    // (row hooks arm only from list registrations).
    //
    // Re-audit-6 (2026-08-28): the value-tier share of the hardening —
    // key recording at registration (the recording proxy in patchDriver's
    // initial apply + first-drain recording), applyStructural's live-list
    // dispatch, and the merge coalescing core bytes. Measured 14.91.
    //
    // Re-audit-7 (2026-08-28): static read manifests — compiled templates
    // now carry their key/path arrays (bytes IN the compiled fixture) and
    // the driver/channel gained the manifest branch, deep-path probes, and
    // per-drain stamp split. Buys prod-sound demotion across ternary
    // branches and nested chains. Measured 15.30; 15.51 after the perf pass
    // (manifest interning + hoisted _mf$ arrays in compiled output).
    //
    // Re-audit-8 (2026-08-28): manifest deep-probe at admission, generation
    // skip, forced coalescing, lane-timed ancestor bubbles. Measured 15.69.
    //
    // Re-audit-9 (2026-08-29): manifest-read effect fallback (write-free
    // compute), optimistic-view initial applies, committed-visible skip
    // markers, optimistic drain probes. Measured 15.99.
    // Round-10.6 (2026-08-31): alias currency probes (root keys + deep),
    // transaction-scoped dedup stamps, hold-aware demotion scheduling.
    // Measured 16.15.
    path: "csr-app-patch.js",
    // Round-10.7: canonical txn stamps + once-guarded held redrives. 16.22.
    // Size pass (2026-08-31): recording proxy deleted (akAll full-scan),
    // applyEntries single-mode, deferHalt/routeEntryError consolidation.
    // Measured 16.05 — ratchet tightened.
    // Round-10.9 (2026-08-31): per-entry manifest envelopes (write-free
    // demotion computes), failed-compute commit skip, akAll refcount,
    // transparent redrive roots. Measured 16.25.
    // Rebase onto next (2026-08-31): upstream drift stacks. Measured 16.36.
    // Round-10.13: structural hold parity + late-registrant resync
    // (queue capture, deferHeldStructural, live-resync sweep). Measured
    // 16.52.
    // Structural-audit follow-up (2026-08-31): slot registration stamps,
    // drain-side generation gate with live slot re-resolution, per-drain
    // resync dedup, landing resync hook. Measured 16.66.
    // Fold-audit round (2026-09-01): staged-truth fold marker + fold-site
    // row/slot emissions (reveal coverage), per-index held-slot defers, and
    // the drain-end late sweep (no resync-then-ops double-builds). Measured 16.88.
    // Version-chain redesign (2026-09-01): snapshot/watermark/sweep
    // machinery replaced by per-entry applied-version chains + ONE
    // flush-end resync + registration-time ancestor repair. Flat cost —
    // the per-finding mechanism accretion this class caused stops here. Measured 17.11.
    // Entanglement rebase drift (2026-09-01, until-flip + CONFIG_HELD_TRUTH).
    limit: "17.2 KB",
    modifyEsbuildConfig
  },
  {
    name: "app: CSR default-on — + rowProof (patch-mode list driver)",
    // FLIP LANDED (2026-08-28) — see the patchDriver scenario note.
    //
    // The full flip cost: a compiled patch-mode list row (rowProof) arms
    // the insert seam and retains the list driver plus the row-hooks tier
    // (row-ops/slot emitters + reconcile's keyed/identity diff builders) —
    // ~2.1 KB over the patchDriver floor, ~3.6 KB over classic. Paid
    // exactly by apps with driver-eligible store lists — the tier the
    // dbmon-class wins accrue to.
    //
    // Re-audit-3 hardening: 16.65 -> 16.75 KB (measured 16.69) — the
    // driver's failed-apply resync flag + partial-registration severing and
    // the coalescing entry updates ride this tier.
    //
    // Re-audit-6 (2026-08-28): the list-tier share of the hardening —
    // initial-construction sever-on-throw (client + hydration), ACTIVE
    // failed-apply resync on slot ticks, structural queue u-mark dispatch,
    // occurrence-aware identityOps — plus the value-tier bytes above.
    // Measured 17.20.
    //
    // Re-audit-7 (2026-08-28): the value-tier manifest bytes above plus
    // build-before-destroy slot rebuilds, hydration full-region surrender,
    // and emission-snapshot structural queues. Measured 17.56; 17.80 after
    // the perf pass (interning + prefix-tree probe + hoisted manifests).
    //
    // Re-audit-8 (2026-08-28): the value-tier bytes above plus captured-
    // record row binds (patchProxyFor riding the createTarget-installed
    // wrap hook — the direct wrapNext edge would have retained the whole
    // trap engine here, +3.7 kB, caught at this gate). Measured 18.09.
    //
    // Re-audit-9 (2026-08-29): the value-tier bytes above plus isWrappable
    // row-bind guards and immediate lane demotion. Measured 18.47.
    // Round-10.6 (2026-08-31): same value-tier bytes as csr-app-patch.
    // Measured 18.66.
    path: "csr-app-patch-lists.js",
    // Round-10.7: same bytes as the value tier. 18.79.
    // Size pass (2026-08-31): same trims. Measured 18.60 — tightened.
    // Round-10.9 (2026-08-31): demotion-lifecycle bytes (see value tier).
    // Measured 18.72.
    // Rebase onto next (2026-08-31): upstream drift stacks. Measured 18.82.
    // Round-10.13: structural hold parity + late-registrant resync.
    // Measured 19.03.
    // #3122 teardown (upstream, 2026-08-31): core-floor bytes ride this
    // tier too. Measured 19.02 post-rebase.
    // Structural audit (2026-08-31): registration-sequence window (fixed
    // both edges, suffix scan), hold-deferred late resyncs, visible-view
    // resolution, deleted-slot gate, superseded-work stamps. Measured
    // 19.14.
    // Follow-up (2026-08-31): the value-tier bytes above plus the slot sq
    // stamp and landing resync hook. Measured 19.26.
    // Fold-audit round (2026-09-01): staged-truth fold marker + fold-site
    // row/slot emissions (reveal coverage), per-index held-slot defers, and
    // the drain-end late sweep (no resync-then-ops double-builds). Measured 19.41.
    // Version-chain redesign (2026-09-01): snapshot/watermark/sweep
    // machinery replaced by per-entry applied-version chains + ONE
    // flush-end resync + registration-time ancestor repair. Flat cost —
    // the per-finding mechanism accretion this class caused stops here. Measured 19.56.
    // Fold audit 2 (2026-09-01): transition-aware version init, reveal
    // channel split, target-keyed staged identity, release fast-forward.
    // Measured 19.62.
    // Entanglement rebase drift (2026-09-01, until-flip + CONFIG_HELD_TRUTH).
    // Fold audit 6 (2026-09-01): two key spaces + undefined sentinel +
    // kind-aware prefix scan in the row matcher (mixed-identity P1,
    // undefined-move P2). Measured 19.74.
    // Fold audit 6b (2026-09-01): the driver's rebuild check agrees with
    // the matcher's SameValueZero (moved NaN row kept its node — parity
    // with classic's Map-based diff, which has this for free). 12 B.
    limit: "19.8 KB",
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
    // Typed preload links: 11.1 -> 11.28 KB, measured at 11.269. Frames now
    // preserve request metadata, adopt matching document links, and retain
    // every late root asset record for mounts that register after the
    // stream arrives.
    path: "../../packages/web/frames/dist/client.js",
    limit: "11.28 KB",
    modifyEsbuildConfig: framesEsbuildConfig
  }
];
