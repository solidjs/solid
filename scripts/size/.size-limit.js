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

module.exports = [
  {
    name: "signals: core floor (createSignal/Memo/Effect/Root/flush)",
    path: "../../packages/solid-signals/dist/prod/index.js",
    import: "{ createSignal, createMemo, createEffect, createRoot, flush }",
    limit: "7.1 KB",
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
    limit: "8.75 KB",
    modifyEsbuildConfig
  },
  {
    name: "app: render + one signal (the simple-app floor)",
    path: "minimal-app.js",
    limit: "10 KB",
    modifyEsbuildConfig
  },
  {
    name: "app: CSR with Show/For/Loading/Errored/lazy",
    path: "csr-app.js",
    limit: "12 KB",
    modifyEsbuildConfig
  }
];
