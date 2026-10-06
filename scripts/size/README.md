# Size scenarios (#2883)

Tree-shaken import-cost tracking: `scenarios.js` defines scenario entries
(signals floor, +createStore, +isPending/latest, the render+one-signal simple
app, a representative CSR app, a hydrating pair — with and without store
primitives — that keeps the store engine pay-for-use under `hydrate()`, three
compiled-template scenarios — a compiled floor and a JSX todo app in CSR and
hydrating form — the frames client as a package, two server-component PAGES:
base and live, and two server-entry floors: `getRequestEvent`/`isServer` and
`renderToString`) with hard brotli limits on the eager entry chunk. CI fails
when a scenario exceeds its limit and grew more than a small minified
allowance over its base (see [The gate](#the-gate)) — that means tree-shaking regressed, or a deliberate
feature landed and the limit should be bumped in the same PR with a reason.

## The gate

Caps are **brotli** bytes on the eager entry chunk — brotli is what ships —
set at measured + 10 B rounded up to 0.01 KB. But brotli's layout is not
monotonic in the input: a change of a few minified bytes moves a scenario's
brotli by ±50–90 B, so a brotli-only gate failed PRs for noise and every
"fix" either raised a cap (permanently) or golfed the code until the layout
came out lucky. Minified bytes are deterministic, so the gate (`gate.mjs`)
uses them to tell noise from growth. Per scenario:

| brotli vs cap | minified vs base                      | verdict                        |
| ------------- | ------------------------------------- | ------------------------------ |
| at or under   | anything                              | **pass**                       |
| over          | grew by ≤ `MINIFIED_ALLOWANCE` (20 B) | **pass with a warning**        |
| over          | grew by more                          | **fail**                       |
| over          | no base measurement                   | **fail** (the cap is absolute) |

"Base" is the PR's base commit (`pull_request.base.sha`, the first parent
of the merge commit CI measures as the head), measured in the same run
with the head's harness; on a push to `next` it is the commit before the
push. The warning — in the job summary, the PR size comment and as an
annotation — reads _over brotli cap by N B, minified +M B — layout noise;
cap will be re-based at the next ratchet_. The allowance is one constant,
`MINIFIED_ALLOWANCE` in `gate.mjs`; a scenario may set its own with
`minifiedAllowance` in `scenarios.js` (none does).

Real growth is still a decision made in the PR: lower the bytes, or raise
the scenario's cap in the same PR with a dated reason in its ledger. Raising
a frozen floor cap (below) additionally needs a `Size-Exception:` line in
the PR body — the override for growth the maintainer has accepted.

Locally, `npm run size` is the absolute gate (any scenario over its cap
fails); `node gate.mjs head.json base.json` applies the PR rule to two
`size.mjs --json` files, and `npm test` runs the decision's tests.

## The ratchet

Noise that passed with a warning leaves a scenario over its cap; savings
leave caps loose. `npm run ratchet` re-bases every cap on what the tree
measures now — measured + 10 B rounded up to 0.01 KB — and **only ever
lowers** a cap. It rewrites the inline caps in `scenarios.js` and the frozen
floors in `floor-caps.json`, adds a dated ledger line above each lowered
cap, and prints the lowered inline caps and the lowered **frozen floors** as
separate tables, so a floor change is seen as one. A scenario still over its
cap is listed and left alone: the ratchet does not raise.

Run it once per RC, on `next`, from CI's numbers — local and CI artifacts
differ by tens of brotli bytes:

```sh
gh run download <run-id> -n size-head   # the Size run of the push to next
node ratchet.mjs --from size-head.json --note "RC.7, next @ abc1234" --dry-run
node ratchet.mjs --from size-head.json --note "RC.7, next @ abc1234"
```

Without `--from` it measures this checkout (build it first). Land the
result as its own PR.

## Bundler

Scenarios are bundled by **Rolldown** (`bundle.mjs`), the bundler Vite ships
with, so tree-shaking, chunk shapes and the minifier are what an application
actually downloads. Rolldown is pinned exactly in `package.json`: its minifier
decides the numbers, so an upgrade is a re-base recorded like any other cap
change. Code splitting is real — a scenario's `import()` yields a lazy chunk
that is reported and never counted; the seroval codec the page scenarios load
lazily shows up that way at its true size.

Scenarios bundle for the browser unless they set `platform`/`conditions`.
The `server:` scenarios bundle for Node (Rolldown's node conditions, no
`development`) with `solid-js`/`@solidjs/web` aliased to their
`dist/server.js` — what the `node` export condition selects — and seroval
bundled from `@solidjs/web`'s own dependency edge, as the page scenarios
bundle it.

Until 2026-09-26 the harness measured with esbuild through `size-limit`. The
switch re-based every cap (Rolldown lands 4–9% lower on the same artifacts;
the table is in the switch PR and each scenario's ledger note in
`scenarios.js`). Ledger deltas must not be read across that line.

## Compiled scenarios

The hand-written `app:` fixtures call the runtime directly and never compile
a template, so the DOM attribute runtime (`spread`, `className`, `style`,
`setAttribute`, `addEvent`, `delegateEvents`) and the hydratable walk
helpers were never on the gate. A scenario with `compile` is JSX under
`fixtures/` — `fixtures/compiled/` holds a one-button floor and a todo app
with an element spread, `merge`/`omit`, a component spread, delegated and
direct events, `class`/`style` objects, a keyed `<For>`, `<Show>`,
`<Loading>` around a `lazy()` child and a store — compiled at measure time
by the **native `@solidjs/compiler` of the checkout being measured**
(`packages/compiler/index.js`, so the compare job measures the base with the
base's compiler) in client DOM mode with the production posture the Vite
plugin uses (`dev: false`, `hydratable` from the scenario), then bundled like
every other scenario. The compiler sees only each file's basename, so the
output — and the numbers — are the same on every host. The compiled app's
own modules report as the `app` package. CI needs nothing beyond what it
already does: the compiler is built before `pnpm build`.

## Frozen floor caps

The three floor scenarios — the signals floor, the simple app, and the
hydrating app without stores — the two server-component page scenarios, and
the two server-entry floors have their caps in `floor-caps.json`, not in
`scenarios.js`. They are
**frozen**: a PR may lower them, never raise them. `check-floor-caps.mjs`
diffs the file against the PR's base branch in CI and fails on a raise unless
the PR body contains a line starting with `Size-Exception:` naming why the
maintainer accepted the cost (read from the PR body when the run starts —
edit the body, then re-run). Ten weeks of individually justified 10–300 B
bumps took the signals floor from 7.1 to 9.9 KB; the freeze makes the next
one a decision, not a paragraph. See
`documentation/plans/size-reduction-audit.md`. The ratchet may lower a
frozen floor like any cap.

## Attribution

`npm run size` (`size.mjs`) gates every scenario and prints, with each result,
the lazy chunks and the minified bytes each package contributed (`signals`,
`solid`, `web`, `web/frames`, `web/server-functions`, …), so a bump is
attributed in the log that reports it. Minified bytes are the attributable
unit; brotli compresses across module boundaries. `node attribute.mjs [name]
[--min bytes]` lists the individual dist modules of matching scenarios.
`node size.mjs --json out.json` writes the results for the gate and the PR
comment.

## CI

`.github/workflows/size.yml` runs three jobs. `head` builds the commit under
test and measures it; `base` builds the base (above) and measures it with
the head's harness (`SIZE_PACKAGES_ROOT`); the two run in parallel. `check`
— the required status — waits for both, renders the summary and the PR
comment (`report.mjs`), decides (`gate.mjs`) and checks the floor freeze
(`check-floor-caps.mjs`). A base that cannot be built or measured leaves the
caps absolute rather than blocking.

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

## Ledger

- **2026-10-05 — minified allowance and ratchet.** The gate stopped failing
  on brotli alone: over the cap with ≤ 20 B minified growth over the base
  passes with a warning; caps stay brotli and are re-based downward per RC
  by `npm run ratchet`. Prompted by one day of noise: #3807 +63 B minified
  went +36 then +97 B brotli after `next` moved (a +61 B variant measured
  +3 / −54); #3814 +10 B minified went +50 / +56 B; #3811 +20 B minified
  went +55 / +89 B; #3817 reordered a condition for −20 B minified and
  moved one scenario −90 B brotli. The base measurement moved out of the informational
  `compare` job (which ran after `check`) into a parallel `base` job that
  `check` waits on, and pushes to `next` now compare against the previous
  commit instead of the absolute cap. No cap changed.
