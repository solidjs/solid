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
    limit: "7.85 KB",
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
    limit: "9.85 KB",
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
    path: "minimal-app.js",
    limit: "10.6 KB",
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
    path: "hydrating-app.js",
    // Upstream drift ratchet (2026-08-27): shared effect notifier (+core)
    // and #3057 invoke's client surface since the 17.25 cap (measured
    // 17.38). Drift, not a stage-2 feature.
    limit: "17.45 KB",
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
    path: "hydrating-store-app.js",
    limit: "25.9 KB",
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
    path: "csr-app.js",
    limit: "12.8 KB",
    modifyEsbuildConfig
  },
  {
    name: "app: CSR flip preview — + patchDriver (non-list patch templates)",
    // What patch-mode DEFAULT-ON adds to ~every app: nearly any real
    // template has one eligible pure member-read binding, so the compiler
    // emits at least one patchDriver call — retaining the dual driver and
    // the store channel's value-tier machinery: registration, the apply
    // queue/drains, error routing, and the demotion path (~1.5 KB brotli
    // over the classic app). NOT here: the list driver (only rowProof arms
    // the insert seam) and the row-ops emitters + reconcile diff builders
    // (row hooks arm only from list registrations).
    path: "csr-app-patch.js",
    limit: "14.5 KB",
    modifyEsbuildConfig
  },
  {
    name: "app: CSR flip preview — + rowProof (patch-mode list driver)",
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
    path: "csr-app-patch-lists.js",
    limit: "16.75 KB",
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
    path: "../../packages/web/frames/dist/client.js",
    limit: "11.1 KB",
    modifyEsbuildConfig: framesEsbuildConfig
  }
];
