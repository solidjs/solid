# Size scenarios (#2883)

Tree-shaken import-cost tracking: `.size-limit.js` defines scenario entries
(signals floor, +createStore, +isPending/latest, the render+one-signal simple
app, a representative CSR app, a hydrating pair — with and without store
primitives — that keeps the store engine pay-for-use under `hydrate()`, the
frames client as a package, and two server-component PAGES: base and live)
with hard brotli limits. CI fails when a scenario exceeds its limit — that
means tree-shaking regressed, or a deliberate feature landed and the limit
should be bumped in the same PR with a reason.

## Frozen floor caps

The three floor scenarios — the signals floor, the simple app, and the
hydrating app without stores — have their caps in `floor-caps.json`, not in
`.size-limit.js`. They are **frozen**: a PR may lower them, never raise them.
`check-floor-caps.mjs` diffs the file against the PR's base branch in CI and
fails on a raise unless the PR body contains a line starting with
`Size-Exception:` naming why the maintainer accepted the cost. Ten weeks of
individually justified 10–300 B bumps took the signals floor from 7.1 to
9.9 KB; the freeze makes the next one a decision, not a paragraph. See
`documentation/plans/size-reduction-audit.md`.

## Attribution

`npm run size` runs size-limit and then `attribute.mjs`, which bundles every
scenario the same way with an esbuild metafile and prints the minified bytes
each package contributed (`signals`, `solid`, `web`, `web/frames`,
`web/server-functions`, …). Minified bytes are the attributable unit; brotli
compresses across module boundaries. `node attribute.mjs --modules [name]`
lists the individual dist modules of matching scenarios.

## Layout

This directory is deliberately **outside the pnpm workspace**, with its own
npm lockfile. Its tooling must never enter the workspace dependency graph:
changing that graph re-keys pnpm peer instances (vitest,
@codspeed/vitest-plugin), which relocates the benchmark harness and shows up
as phantom CodSpeed regressions. Nothing here is published (`private: true`).

The page scenarios alias the seroval codec to `lazy-codec.js`: both clients
load it through a dynamic import (a separate chunk in production) and
size-limit does not split, so the stub keeps the import site without inlining
the chunk. `lazy-page.js` plays the same role for `lazy()`.

Run locally: `cd scripts/size && npm ci && npm run size` (build the repo
first). The retained-module-graph test in
`packages/signals/tests/treeshake.test.ts` is the companion diagnostic
that names the re-coupled module when shaking breaks.
