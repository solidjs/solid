// Import-cost scenarios for #2883. Bare specifiers resolve via esbuild
// aliases to the built browser-prod artifacts rather than root workspace
// devDeps: adding solid-js/@solidjs/* to the root package.json re-keys
// pnpm's peer graph (vitest/vite-plugin-solid instances), which relocates
// the benchmark harness and shows up as phantom CodSpeed regressions.
const alias = {
  "solid-js": "./packages/solid/dist/solid.js",
  "@solidjs/web": "./packages/solid-web/dist/web.js",
  "@solidjs/signals": "./packages/solid-signals/dist/prod/index.js"
};
const modifyEsbuildConfig = config => ({ ...config, alias });

module.exports = [
  {
    name: "signals: core floor (createSignal/Memo/Effect/Root/flush)",
    path: "packages/solid-signals/dist/prod/index.js",
    import: "{ createSignal, createMemo, createEffect, createRoot, flush }",
    limit: "7.1 KB",
    modifyEsbuildConfig
  },
  {
    name: "signals: + createStore",
    path: "packages/solid-signals/dist/prod/index.js",
    import: "{ createSignal, createMemo, createEffect, createRoot, flush, createStore }",
    limit: "11.6 KB",
    modifyEsbuildConfig
  },
  {
    name: "signals: + isPending/latest",
    path: "packages/solid-signals/dist/prod/index.js",
    import: "{ createSignal, createMemo, createEffect, createRoot, flush, isPending, latest }",
    limit: "8.75 KB",
    modifyEsbuildConfig
  },
  {
    name: "app: render + one signal (the simple-app floor)",
    path: "size-fixtures/minimal-app.js",
    limit: "10 KB",
    modifyEsbuildConfig
  },
  {
    name: "app: CSR with Show/For/Loading/Errored/lazy",
    path: "size-fixtures/csr-app.js",
    limit: "12 KB",
    modifyEsbuildConfig
  }
];
