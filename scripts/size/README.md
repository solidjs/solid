# Size scenarios (#2883)

Tree-shaken import-cost tracking: `scenarios.js` defines scenario entries
(signals floor, +createStore, +isPending/latest, the render+one-signal simple
app, a representative CSR app, a hydrating pair — with and without store
primitives — that keeps the store engine pay-for-use under `hydrate()`, the
frames client as a package, and two server-component PAGES: base and live)
with hard brotli limits on the eager entry chunk. CI fails when a scenario
exceeds its limit — that means tree-shaking regressed, or a deliberate feature
landed and the limit should be bumped in the same PR with a reason.

## Bundler

Scenarios are bundled by **Rolldown** (`bundle.mjs`), the bundler Vite ships
with, so tree-shaking, chunk shapes and the minifier are what an application
actually downloads. Rolldown is pinned exactly in `package.json`: its minifier
decides the numbers, so an upgrade is a re-base recorded like any other cap
change. Code splitting is real — a scenario's `import()` yields a lazy chunk
that is reported and never counted; the seroval codec the page scenarios load
lazily shows up that way at its true size.

Until 2026-09-26 the harness measured with esbuild through `size-limit`. The
switch re-based every cap (Rolldown lands 4–9% lower on the same artifacts;
the table is in the switch PR and each scenario's ledger note in
`scenarios.js`). Ledger deltas must not be read across that line.

## Frozen floor caps

The three floor scenarios — the signals floor, the simple app, and the
hydrating app without stores — and the two server-component page scenarios
have their caps in `floor-caps.json`, not in `scenarios.js`. They are
**frozen**: a PR may lower them, never raise them. `check-floor-caps.mjs`
diffs the file against the PR's base branch in CI and fails on a raise unless
the PR body contains a line starting with `Size-Exception:` naming why the
maintainer accepted the cost. Ten weeks of individually justified 10–300 B
bumps took the signals floor from 7.1 to 9.9 KB; the freeze makes the next
one a decision, not a paragraph. See
`documentation/plans/size-reduction-audit.md`.

## Attribution

`npm run size` (`size.mjs`) gates every scenario and prints, with each result,
the lazy chunks and the minified bytes each package contributed (`signals`,
`solid`, `web`, `web/frames`, `web/server-functions`, …), so a bump is
attributed in the log that reports it. Minified bytes are the attributable
unit; brotli compresses across module boundaries. `node attribute.mjs [name]
[--min bytes]` lists the individual dist modules of matching scenarios.
`node size.mjs --json out.json` writes the results for the PR comment.

## Layout

This directory is deliberately **outside the pnpm workspace**, with its own
npm lockfile. Its tooling must never enter the workspace dependency graph:
changing that graph re-keys pnpm peer instances (vitest,
@codspeed/vitest-plugin), which relocates the benchmark harness and shows up
as phantom CodSpeed regressions. Nothing here is published (`private: true`).

Run locally: `cd scripts/size && npm ci && npm run size` (build the repo
first). `SIZE_PACKAGES_ROOT=<checkout>` measures another checkout's built
`packages/` with this harness — the compare job uses it for the base branch.
The retained-module-graph test in `packages/signals/tests/treeshake.test.ts`
is the companion diagnostic that names the re-coupled module when shaking
breaks.
