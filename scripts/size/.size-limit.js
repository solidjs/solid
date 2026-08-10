// Import-cost scenarios for #2883, measured against the built browser-prod
// artifacts. Bare specifiers resolve via esbuild aliases so nothing here
// touches the workspace dependency graph. Limits carry ~5% headroom over the
// sizes at landing: a breach means tree-shaking regressed (or a deliberate
// feature landed — bump the limit in the same PR and say why). The simple-app
// scenario is pinned at 10 KB on purpose.
const alias = {
  "solid-js": "../../packages/solid/dist/solid.js",
  "@solidjs/web": "../../packages/solid-web/dist/web.js",
  "@solidjs/signals": "../../packages/solid-signals/dist/prod/index.js"
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
    "@solidjs/web/server-functions/client":
      "../../packages/solid-web/server-functions/dist/client.js"
  },
  external: ["solid-js", "@solidjs/web", "@solidjs/web/serialization"]
});

module.exports = [
  {
    name: "signals: core floor (createSignal/Memo/Effect/Root/flush)",
    path: "../../packages/solid-signals/dist/prod/index.js",
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
    limit: "7.35 KB",
    modifyEsbuildConfig
  },
  {
    name: "signals: + createStore",
    path: "../../packages/solid-signals/dist/prod/index.js",
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
    limit: "13.15 KB",
    modifyEsbuildConfig
  },
  {
    name: "signals: + isPending/latest",
    path: "../../packages/solid-signals/dist/prod/index.js",
    import: "{ createSignal, createMemo, createEffect, createRoot, flush, isPending, latest }",
    // loadingValue (commit #0): 8.75 -> 9 KB, measured at 8.84 KB — the same
    // core-floor bytes (see above); the verdict layer itself only gained a
    // comment (the window is verdict-quiet by design, no code).
    limit: "9 KB",
    modifyEsbuildConfig
  },
  {
    name: "app: render + one signal (the simple-app floor)",
    path: "minimal-app.js",
    limit: "10 KB",
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
    path: "hydrating-app.js",
    limit: "16.35 KB",
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
    path: "hydrating-store-app.js",
    limit: "23.3 KB",
    modifyEsbuildConfig
  },
  {
    name: "app: CSR with Show/For/Loading/Errored/lazy",
    // Ratcheted 12 -> 11.95 KB after the hydration-phase seam trim
    // (isHydrationInProgress/onHydrationEnd moved from the sharedConfig
    // literal into enableHydration(), −100 B here, 11.72 KB measured) so
    // the win is locked in at the ~2% headroom convention.
    path: "csr-app.js",
    limit: "11.95 KB",
    modifyEsbuildConfig
  },
  {
    name: "frames: eager client consumer (frames client + transport, lazy codec)",
    path: "../../packages/solid-web/frames/dist/client.js",
    limit: "10.35 KB",
    modifyEsbuildConfig: framesEsbuildConfig
  }
];
