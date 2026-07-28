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
    limit: "12.85 KB",
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
