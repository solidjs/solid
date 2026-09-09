# Observe Tier Plan — wiring vs checks, as a build flavor

_Drafted 2026-09-08. Status: AGREED (decisions D1–D5 below). Precedes P1 of
`server-dev-build-plan.md` so server emit sites land on the right object.
Design rationale: `documentation/proposals/production-observability-sketch.md`
§3 (measured wiring/checks split). Owner: Ryan._

## Objective

Separate the two things `__DEV__` gates today:

- **Checks** — strict reads, owner-scope writes, invariants, forbidden
  scopes, console reporting, dev-only error text. ~120 sites. Dev only.
- **Wiring** — attribution hook calls, `_name` labels, graph edge counters,
  the diagnostics event channel. ~40 sites. Needed by dev _and_ by any
  production observability.

After this plan: three build tiers (`dev` ⊃ `observe` ⊃ `prod`), one new
export condition, and two runtime objects — `OBSERVE` (exists in dev and
observe builds) and `DEV` (dev only). Default prod artifacts are
byte-identical to today under every bundler.

## Decisions

- **D1 — Names.** Flag `__OBSERVE__` (signals) / `"_SOLID_OBSERVE_"`
  (solid-js, web); export condition `observe`; runtime export `OBSERVE`.
- **D2 — Invariant `__DEV__ ⇒ __OBSERVE__`.** Dev builds replace both true;
  observe builds `__DEV__: false, __OBSERVE__: true`; prod both false.
  Asserted where the flags are consumed (`dev.ts`) so a misconfigured build
  fails at module init, not silently.
- **D3 — Compile-time gating everywhere; observe flavors only where wiring
  exists.** Measured 2026-09-08: Rollup and Rolldown fold an
  `if (OBSERVE)` site against signals' prod `const OBSERVE = undefined` to
  zero bytes; **esbuild does not**, for any literal shape. The size-cap
  harness (`scripts/size/`, size-limit's esbuild preset) would therefore
  charge runtime-gated wiring on every PR, and esbuild/webpack users would
  pay it — abandoning the #2883 invariant the caps defend. So no runtime
  gates: `"_SOLID_OBSERVE_"` is a replaced literal like `"_SOLID_DEV_"`, and
  packages ship an observe flavor only for entries that contain wiring:
  - `@solidjs/signals`: `dist/observe/` (per-module tree like `prod/`,
    mangled) and `dist/node.observe.cjs`.
  - `solid-js`: `dist/solid.observe.{js,cjs}` — the component root + label
    and the flow-control memo names (`<For>`, `<Repeat>`, `<Show>`'s
    "condition value"/"condition"/"value", `<Match>`'s, `children`); and
    `dist/server.observe.{js,cjs}`, which today differs from prod only in
    exporting a live `OBSERVE` — it exists so `import { OBSERVE } from
"solid-js"` agrees with `@solidjs/signals` when both resolve under
    `observe` in one process. P1's server labels give it content.
  - `@solidjs/web`: `dist/web.observe.{js,cjs}` (3 `withInteraction` sites).
  - `@solidjs/universal`: `dist/universal.observe.{js,cjs}` (renderer-effect
    fallback names, "renderer render").
  - frames, server-functions, storage, serialization, h, html, element: no
    wiring → no flavor; under `observe` they fall through to prod (pinned by
    the exports-resolution test).
- **D4 — `_name` is reserved from property mangling** in observe (and prod,
  harmlessly). It is the one cross-package field: `solid-js` writes it on
  signals' owners for component labels. Every other `_`-field stays private
  to signals. Server owners (`SSROwner`) are not signals' owners, so the
  server never relies on signals walking its `_parent`: `emit` accepts an
  explicit `ownerPath`, and the server computes its own (P1).
- **D5 — Split, don't extend.** `OBSERVE` = `{ diagnostics: { subscribe,
capture, emit }, attribution: { install, installed, withInteraction },
subjectOf }`; `DEV` = `{ hooks, getChildren, getSignals, getParent,
getSources, getObservers, report, setConsoleFooter }`.
- **D6 — The engine is an entry, not a member.** `OBSERVE.attribution` is the
  core's side only: the hook slot (`install(hooks)`, `installed`) and the
  interaction frame (`withInteraction`, which the web runtime calls on every
  dispatch and which is `fn()` with no engine installed). The engine —
  `enable/disable/history/why/costs/waterfalls/holds/feedback/markFlight/
format/formatOrigin` — is `@solidjs/signals/attribution` (re-exported as
  `solid-js/attribution`). Nothing reachable from the core index may import
  `core/attribution.ts`. Measured 2026-09-08: with the engine referenced
  statically from `OBSERVE.attribution` the observe CSR scenario was 23.79 KB
  against prod's 12.91; as an entry it is 14.20 KB (+1.29 KB, the wiring
  itself), and enabling the engine costs 9.7 KB more — paid only by builds
  that import it. Prod resolves an inert twin (`src/attribution.prod.ts`)
  with the same `Attribution` surface, so the import needs no per-tier guard.
  Every signals build therefore has two entries sharing one module instance:
  the trees via `preserveModules`, the flat dev/CJS builds via code
  splitting (`<name>.<ext>`, `<name>.attribution.<ext>`, `<name>-shared.<ext>`,
  mangled as one domain). `InteractionRef` moved to `attribution-hooks.ts`;
  the hooks gained `interactionStart(ref)`/`interactionEnd()`.

## PR A (this plan) — flags, split, flavors, caps, engine entry

### `@solidjs/signals`

Build: `globals.d.ts` declares `__OBSERVE__`. Rollup adds `dist/observe/`
(`__DEV__: "false", __OBSERVE__: "true"`, `preserveModules`, no prettier,
mangled) and `dist/node.observe.cjs`; `dev.js`/`node.dev.cjs` get
`__OBSERVE__: "true"`; `prod/`/`node.cjs` get `"false"`. `mangle-props.mjs`
reserves `_name`. `build:clean` covers the new outputs. Exports: `observe`
after `development` on both `import` and `require`.

`dev.ts`: construct `OBSERVE` under `__OBSERVE__`, `DEV` under `__DEV__`;
`emitDiagnostic` (channel) is observe-tier; `reportDiagnostic`,
`setConsoleFooter`, `assertInvariant` stay dev-tier. `registerGraph` splits:
`_owner` stamp (observe — `ownerPath` for signal subjects) vs `_signals`
list + `hooks.onGraph` (dev). `noteGraphLink`/`unnoteGraphLink` are observe.

Site migration `__DEV__` → `__OBSERVE__` (everything not listed stays
`__DEV__`):

| File                                                           | Sites                                                                                 | Why wiring                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------- |
| `core/core.ts`                                                 | 223, 426, 547, 1445, 1623 (`attrHooks`); 672, 763, 871–872, 941–942 (`_name`)         | hooks; labels                     |
| `core/async.ts`                                                | 355, 450, 481, 524, 537                                                               | hooks                             |
| `core/scheduler.ts`                                            | 223, 488, 1259, 1290                                                                  | hooks                             |
| `core/action.ts`                                               | 140, 144, 147                                                                         | hooks                             |
| `core/effect.ts`                                               | 210                                                                                   | hooks                             |
| `core/graph.ts`                                                | 18, 194                                                                               | edge counters (`WIDE_WRITE`)      |
| `boundaries.ts`                                                | 334, 372                                                                              | hooks                             |
| `map.ts`                                                       | 281, 290, 331 (hooks); 76, 102, 370 (name plumbing)                                   | hooks; labels                     |
| `signals.ts`                                                   | 373, 1085 (`registerGraph` → `_owner` half); 515, 557, 612, 677, 1189 (name defaults) | labels                            |
| `store/next/store.ts`                                          | 290 (`_name`), 1019 (`reportReplacedContainers`), 2117 (`registerGraph` half)         | labels; attribution-gated finding |
| `store/next/projection.ts` 198, `store/next/optimistic.ts` 314 | name plumbing                                                                         | labels                            |
| `core/dev.ts`                                                  | `OBSERVE` object, `emitDiagnostic`, `noteGraphLink`, `_owner` stamp                   | the channel                       |
| `index.ts`                                                     | export `OBSERVE`; `DEV` unchanged in meaning                                          |                                   |

Not wiring, stays `__DEV__` (spot-checked): `scheduler.ts:863`
`lastStagedNodeName` (infinite-loop message detail), all `DEV.hooks.on*`
calls, `devTrack*`/`devCheck*`, strict-read state, `Symbol(__DEV__ ? … : 0)`
descriptions, `__DEV__ ? "message" : ""` error text, `verdict.ts:662`
invariant hook install.

### `solid-js`

- `client/core.ts`: `IS_OBSERVE = "_SOLID_OBSERVE_"`. Component wrapper:
  under `IS_OBSERVE`, a transparent root with `owner._name = "<Name>"`
  (today's `devComponent` minus the non-function check, which stays
  `IS_DEV`). Prod path unchanged (`untrack(() => Comp(props))`).
- `index.ts` / `server/index.ts`: `export const OBSERVE = IS_OBSERVE ?
_OBSERVE : undefined` beside `DEV`. Server `IS_OBSERVE` exists but no
  server wiring yet (P1).
- Rollup: `replaceDev(isDev, isObserve)`; add `dist/solid.observe.*`;
  `observe` condition nested under `browser` after `development`.

### `@solidjs/web`

- `client.ts`: the three `withInteraction` wraps gate on `IS_OBSERVE`
  (`"_SOLID_OBSERVE_"`) and call `OBSERVE.attribution.withInteraction`.
- Rollup: `dist/web.observe.*`; `observe` under `browser` for `.`.

### Consumers

`@solidjs/diagnostics` `capture.ts`/`browser.ts` → `OBSERVE` (they only
touch `diagnostics` and `attribution`); `@solidjs/universal` label site;
skills and README text `DEV.attribution` → `OBSERVE.attribution`;
`solid/test/dev.spec.ts`, `universal/test/diagnostic-names.spec.js`.

### Tests

- Signals dist: `OBSERVE`/`DEV` per artifact — prod `(undefined, undefined)`,
  observe `(defined, undefined)`, dev `(defined, defined)`; observe artifact
  has no `console.` calls from `reportDiagnostic` paths (string scan is fine
  here — the function itself must be absent).
- Exports resolution (extend `exports-server-conditions.spec.tsx`):
  `browser+observe` → `solid.observe.js`, `web.observe.js`, signals
  `observe/index.js`; frames/server-functions fall through to prod;
  `browser+development` still wins over `observe` when both are present
  (dev ⊃ observe, so `development` must be listed first).
- `solid-js` client under observe: component label appears in `ownerPath`
  of an emitted event; prod artifact has no `_name` write (string scan).

### Size and perf

- `scripts/size/.size-limit.js`: new "CSR, observe tier" scenario aliasing
  the three observe artifacts, own cap. Existing prod scenarios did not move
  (measured 2026-09-08: prod `web.js`/`universal.js` byte-identical;
  `solid.js` and signals `prod/index.js` differ only by
  `const OBSERVE = undefined` + its export).
- Measured observe cost: 14.20 KB vs prod CSR 12.91 KB (+1.29 KB — the
  wiring, labels, edge counters with their two warning texts, the channel,
  the interaction frame, solid-js's labelled component root). A second
  scenario, "observe tier + attribution engine enabled", imports
  `solid-js/attribution` and measures 23.91 KB: the engine is 9.7 KB brotli,
  opt-in. Before D6 the observe scenario alone was 23.79 KB.
- Signals bench: `SIGNALS_TIER=observe pnpm bench` compiles the source as
  the observe tier (`__DEV__` false, `__OBSERVE__` true, hooks not
  installed) — the idle wiring cost. `SIGNALS_TIER=prod` for the floor.
  Informational until there is a baseline to cap against.

## PR B — serializable events, origin, engine diet

The engine entry landed in PR A (D6). What remains is the engine's public
record shape: `RerunEvent` drops the live `node` (`OBSERVE.subjectOf`-style
lookup for in-process consumers), events gain `ts` and `origin`, and `origin`
unifies client interaction and server request as the external cause of work
— which is what lets the same records leave the process. The 9.7 KB engine
should also shed what a production consumer never calls (console formatters
ride along with `enable()` today). Details in the sketch §4–§5; specified
alongside server-dev-build-plan P1, which supplies the request half of
`origin`.

## Open questions

- **Client CJS.** Every client entry ships a `.cjs` twin (and its dev/observe
  siblings) for one consumer: Jest with `solid-jest`. Everything Solid 2
  documents or ships is Vitest/ESM, `require(esm)` is unflagged on 20.19+,
  and Svelte 4, Vite 7, Angular and Lit are ESM-only. Dropping client CJS —
  or all CJS, with `engines.node >= 20.19` — would delete roughly a third of
  the build matrix and the whole dual-types pipeline. Its own PR, after this
  lands.

## Out of scope here

Compiler-emitted component names (sketch §6), per-package code tables
(§7), devtools port. Server emit sites (P1) and code conversion (P2) follow
on top of PR A.
