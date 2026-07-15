# Size scenarios (#2883)

Tree-shaken import-cost tracking: `.size-limit.js` defines scenario entries
(signals floor, +createStore, +isPending/latest, the render+one-signal simple
app, a representative CSR app) with hard gzip-limits. CI fails when a scenario
exceeds its limit — that means tree-shaking regressed, or a deliberate feature
landed and the limit should be bumped in the same PR with a reason. The
simple-app scenario is pinned at 10 KB on purpose.

This directory is deliberately **outside the pnpm workspace**, with its own
npm lockfile. Its tooling must never enter the workspace dependency graph:
changing that graph re-keys pnpm peer instances (vitest,
@codspeed/vitest-plugin), which relocates the benchmark harness and shows up
as phantom CodSpeed regressions. Nothing here is published (`private: true`).

Run locally: `cd scripts/size && npm ci && npm run size` (build the repo
first). The retained-module-graph test in
`packages/solid-signals/tests/treeshake.test.ts` is the companion diagnostic
that names the re-coupled module when shaking breaks.
