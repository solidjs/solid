# Server Dev Build Plan — step one of the observability track

_Drafted 2026-09-06. Status: AGREED 2026-09-06 (decisions D1–D3 below
resolved). **P0 implemented 2026-09-07** on branch `server-dev-build` (see the
P0 status note); P1–P4 not started. `diagnostics-expansion` merged to `next`
as #3302 on 2026-09-07, so D3's ordering constraint on P1/P2 is satisfied.
Precedes every server item in
`documentation/proposals/production-observability-sketch.md` (§9,
§10.2–10.4). Owner: Ryan._

## Objective

Give the server runtime the same dev/prod split the client has, so that
server-side diagnostics (a) exist, (b) run where developers can see them, and
(c) flow through the one structured channel (`DEV.diagnostics`) that the
console, `@solidjs/diagnostics` budgets, and agents already consume. Without
this, every server finding in the sketch has nowhere to go, and the
attribution work has no server foothold.

## The facts this plan turns on (verified against `next`, 2026-09-06)

1. **`solid-js` has no server dev build.** `packages/solid/rollup.config.js`
   builds `src/server/index.ts` once, with _no_ `_SOLID_DEV_` replace at all;
   `dist/server.{js,cjs}` is the only artifact for the `worker`/`deno`/`node`
   conditions. `packages/solid/src/server/` contains **zero** `"_SOLID_DEV_"`
   gates. Its 8 `console.warn`/`console.error` sites fire **unconditionally in
   production**: `[SERVER_WRITE]` (`signals.ts:696`), nested `<Reveal>` in
   `renderToString` (`flow.ts:357`), lazy asset resolution failures
   (`component.ts:123/284/296/380`), and the `failRender` fallbacks
   (`hydration.ts:183/190` — those two are error containment, not
   diagnostics, and stay).
2. **`@solidjs/web`'s server dev checks are dead in every deployment.**
   `packages/web/src/server.ts` has **26** `"_SOLID_DEV_"` gates (head/preload
   descriptor validation ×~15, `useHead` tag/attribute warnings ×~8,
   "Unrecognized value. Skipped inserting" ×2, the #2982 late-header throw).
   The only server artifact is built with `replaceDev(false)` — by design, per
   the rollup comment "SSR builds are production by convention" — so none of
   these ever run outside the test suite (which runs from source, where the
   string literal is truthy). `head.ts` and `cookies.ts` each have one more.
3. **The pattern already exists in the same package.**
   `@solidjs/web/server-functions` ships `server.dev.{js,cjs}` via
   `replaceDev(true)` and nests a `development` condition **inside**
   `worker`/`deno`/`node` in its exports — the correct shape, because at the
   top level `node` precedes `development` and would win. `./frames` server
   does not (its sink bundles `_SOLID_DEV_`-gated runtime code, all stripped).
4. **The server facade has no diagnostics channel.** `server/index.ts:130`:
   `export const DEV = undefined;`. It imports only `$REFRESH` from
   `@solidjs/signals`; `emitDiagnostic`, `DiagnosticEvent`, `DEV.diagnostics`,
   `attrHooks` do not exist on the server. It does have an owner tree
   (`getOwner`, `signals.ts:246`) and a component wrapper
   (`component.ts:65`) — the two things `ownerPath` needs.
5. **Behavioral gates are among the dead ones.** The late-header write is
   spec'd to _throw_ in dev and `console.error` + no-op in prod
   (`server.ts:4593`, #2982, pinned by
   `test/server/dist-server-artifact.spec.tsx`). Today developers never see
   the throw. Turning the dev build on changes what Vite dev SSR does on that
   bug — that is the point, and it is a visible behavior change to announce.

## Non-goals

- No production observability, no observe build, no `attrHooks` on the server
  (sketch §3, §9.4). This plan is the dev half only.
- No new server _verdicts_ (waterfalls, boundary timing). Those need the
  server hook surface (Phase 3 below is scoping only).
- No change to what `dist/server.js` (prod) does, except that `solid-js`'s
  prod server build gains the `replaceDev(false)` it should already have.

## Phases

### P0 — Build plumbing (the actual "server dev build")

**`solid-js`** (`packages/solid/rollup.config.js`, `package.json`):

- Add `dist/server.dev.{js,cjs}` from `src/server/index.ts` with
  `replaceDev(true)`.
- Add `replaceDev(false)` to the existing prod server build. Today it has no
  replace because the source has no gates; the moment P1 adds one, an
  un-replaced truthy string literal would take the dev branch in prod — the
  exact #2982 failure `@solidjs/web` already hit.
- Exports: nest `development` under `worker`, `deno`, `node` (copy the
  `./server-functions` shape). Do **not** rely on the top-level `development`
  key; `node` matches first.

**`@solidjs/web`** (`packages/web/rollup.config.js`, `package.json`):

- Add `dist/server.dev.{js,cjs}` from `src/index.server.ts` with
  `replaceDev(true)`; same external list as the prod server build.
- Add `frames/dist/server.dev.{js,cjs}` likewise; nest `development` under
  the server conditions of `./frames` and add it to `./frames/server`.
- `./storage`, `./serialization`: no gates today; leave until one appears.

**Guards**:

- Mirror `dist-server-artifact.spec.tsx` for the dev artifact: the late
  header write **throws** from `dist/server.dev.js`. This pins that the
  replace actually happened (a string scan cannot — folding erases the
  marker either way, as the existing comment notes).
- A resolution test: with conditions `["node", "development", "import"]`,
  `solid-js` and `@solidjs/web` both resolve to `*.dev.js`; with
  `["node", "import"]` both resolve to prod. Cheap to write with
  `import.meta.resolve` or `resolve.exports`, and it catches the
  key-ordering trap permanently.
- Size: server artifacts are not in `scripts/size/` scenarios (browser-only).
  No cap changes. Note it in the changeset anyway.

**Changeset**: `solid-js` + `@solidjs/web`, patch (prerelease). Call out the
dev-SSR behavior change from fact 5.

**P0 status (2026-09-07): done as specified**, with these notes:

- `packages/web/frames/package.json` (the nested subpath stub, not just the
  root `exports`) also needed the `development` condition; it was not in the
  list above. `server-functions/package.json` was the model.
- Resolution test spawns Node with `--conditions` and reads
  `import.meta.resolve` rather than reimplementing the exports algorithm —
  Node's resolver is the reference. It covers all five server entries
  (`solid-js`, `@solidjs/web`, `./frames`, `./frames/server`,
  `./server-functions`) under `node`, `worker`, and `deno`, with and without
  `development`, and requires the `link` build step (self-symlink) to have run.
- Not in the list above, and the first thing the dev artifacts needed to be
  _for_ anything: both server entries hard-coded their public dev flags
  (`solid-js` `export const DEV = undefined`, `@solidjs/web`
  `export const isDev = false`), so a dev artifact was internally dev and
  externally prod. Both now gate on `"_SOLID_DEV_"` like the client entries;
  `solid-js`'s server `DEV` re-exports signals' object, which is the channel
  P1 emits into. The export-parity test asserted the old `undefined`; it now
  asserts identity with the client's `DEV`.
- Artifact check: `@solidjs/web` `dist/server.dev.js` is +5.5 KB over prod
  (the 26 gates live; late header throws vs `console.error`s; `isDev` true).
  `solid-js` `dist/server.dev.js` differs from prod only in `DEV` — no other
  gates in `src/server/` until P1.
- Tests: web `test/server/dist-server-dev-artifact.spec.tsx` (late header
  throws, `isDev === true`), `dist-server-artifact.spec.tsx` (+`isDev ===
false`), `exports-server-conditions.spec.tsx`; solid
  `test/server/dist-server-artifact.spec.ts` (`DEV` undefined in prod, is
  signals' object in dev, same export surface). Full `@solidjs/web`
  (712/764/165), `solid-js` (588), and type tests green.
- Naming: the server dev builds made the legacy bare `dist/dev.js` names
  ambiguous (dev of which entry?), so the three remaining ones were renamed
  to the `<entry>.dev.*` convention the rest of the repo already used —
  `solid.dev.*`, `web.dev.*`, `universal.dev.*`. Signals keeps `dev.js` vs
  `prod/` (chunked dir for the mangle pass; a restructure, not a rename).
  The resolution test now pins the client pairing under `browser` too.
- `@solidjs/signals`' `require` branch had no `development` condition
  (`dist/node.cjs` is `__DEV__: false` only), so CJS hosts loading
  `server.dev.cjs` got signals' prod object and `DEV` came back `undefined` —
  a dev artifact lying about the one export P1 will emit through. Fixed in
  the same PR: `dist/node.dev.cjs` (unmangled twin of `dev.js`), selected by
  `require.development`. The resolution test walks the CJS hops
  (`@solidjs/web` → `solid-js` → `@solidjs/signals`) and pins all three
  flipping together; a signals dist test pins `DEV` per CJS artifact.
- `solid-js#test` now depends on `solid-js#build` in `turbo.json` — it had
  no dist-based tests until this work, so it was the one package whose test
  task didn't wait for its own build.

### P1 — A server diagnostics channel

Decision: **reuse `@solidjs/signals`'s channel, do not fork it.**

- The server facade imports `DEV` (and the `emitDiagnostic` /
  `DiagnosticEvent` types) from `@solidjs/signals`, every use behind
  `"_SOLID_DEV_"` so the prod server build folds it out and never touches
  `DEV` (which is `undefined` in signals' prod build). On node in dev,
  signals resolves to `dist/dev.js` via its top-level `development` condition
  (no `node` key ahead of it in signals' exports — verified), so the channel is
  live exactly when the server dev build is.
- Payoff: `DEV.diagnostics.subscribe/capture` and therefore
  `@solidjs/diagnostics`'s `captureArtifact` work around `renderToStream` /
  `renderToString` with **no new fixture code**. Server findings land in the
  same JSONL artifact and the same budgets as client ones. This is the
  "one mechanism, N front-ends" rule applied to the server.
- `server/index.ts` stops exporting `DEV = undefined` and re-exports the
  signals `DEV` under the same `_SOLID_DEV_` gate the client entry uses, so
  `import { DEV } from "solid-js"` means the same thing on both sides.
- `ownerPath`: the server component wrapper labels owner roots `<Name>` the
  way the client wrapper does on `diagnostics-expansion`
  (`packages/solid/src/client/core.ts:213`). Coordinate with that branch —
  land after it, reuse its label helper rather than duplicating.
- Server-side `reportDiagnostic` (console face): the branch introduces one in
  signals core; the server uses it as-is. Until the branch lands, emit +
  `console.warn` as the client does on `next`.

### P2 — Convert the existing sites to codes

Every server `console.warn` that is a diagnostic becomes
`emitDiagnostic({ code, kind, severity, message, ... })` + report, behind
`"_SOLID_DEV_"`. Proposed codes (kinds reuse the existing `DiagnosticKind`
set plus `"ssr"` and `"head"`; add both to the union):

| Today                                                                      | Code                             | Severity | Notes                                                                              |
| -------------------------------------------------------------------------- | -------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `[SERVER_WRITE]` (`signals.ts:677–696`)                                    | `SERVER_WRITE`                   | warn     | Text already has the bracket; make it real. Becomes dev-only (decision D1).        |
| `ssrSource: "client"` outside `<Loading>` (`signals.ts:519`)               | `ASYNC_OUTSIDE_LOADING_BOUNDARY` | warn     | Same code as the client; `data.side: "server"`.                                    |
| Nested `<Reveal>` in `renderToString` (`flow.ts:357`)                      | `REVEAL_IN_RENDER_TO_STRING`     | warn     |                                                                                    |
| lazy asset failures (`component.ts` ×4, `server.ts:~548`)                  | `LAZY_ASSET_UNMAPPED`            | warn     | Five message texts, one condition. `data.id`, `data.reason`.                       |
| `registerAsset("preload")` validation (`server.ts:656–752`)                | `PRELOAD_DESCRIPTOR_INVALID`     | warn     | `data.field`.                                                                      |
| `useHead` non-head tag / bad attribute / eval error (`server.ts:833–1306`) | `HEAD_TAG_INVALID`               | warn     | `data.reason`.                                                                     |
| "Unrecognized value. Skipped inserting" (`server.ts:4407/4471`)            | `UNRECOGNIZED_INSERT_VALUE`      | warn     | Client has the same text in `client.ts`; share the code.                           |
| Late header write (`server.ts:4588–4594`)                                  | `LATE_HEADER_WRITE`              | error    | Emit, then keep the existing dev throw / prod no-op. `data.header`.                |
| `onError` fired, response still completed (`server.ts:1656`)               | `SSR_RENDER_ERROR_CONTAINED`     | warn     | New. `ownerPath` of the failed boundary; `data.abandoned` if `abandonSubtree` ran. |
| `devCheckRange` (frames client)                                            | `FRAME_MARKER_CORRUPTED`         | error    | Client-side, but same table so the frames pair is complete.                        |

Not converted: `hydration.ts:183/190` `failRender ?? console.error` (error
containment; the structured face is `SSR_RENDER_ERROR_CONTAINED` above).

Update `documentation/solid-2.0/08-dev-diagnostics.md` (server section) and
`packages/solid/skills/reactivity-diagnostics/SKILL.md` with the new codes
and repairs. The `DiagnosticCode` union in signals `dev.ts` grows
accordingly — the server imports the type, so the codes live in one place.

### P3 — Scope the server hook surface (design only)

Not implementation. Answer the sketch's §12 question: the server has no
re-runs, so `AttributionHooks` mostly does not apply. What does:

- `flightStart` / `asyncEnd` per boundary await (`hydration.ts:176–317`) —
  substrate for `SSR_BOUNDARY_WATERFALL`.
- `holdStart` / `transitionSettled` analog: boundary discovered → settled →
  revealed (sink `reveal`).
- `write` — already the `[SERVER_WRITE]` site.

Output: a short section appended to the sketch choosing between (a) the same
`AttributionHooks` interface with a server engine that implements the
applicable subset, or (b) a smaller `ServerHooks` interface. Leaning (a) for
type/tooling reuse, with unused members no-op.

### P4 — `@solidjs/diagnostics` server scenario

One test: `captureArtifact(() => renderToStream(<App/>))` on the dev server
build asserts a seeded `HEAD_TAG_INVALID` and a seeded `SERVER_WRITE` appear
in `artifact.diagnostics` with `ownerPath`. Proves P1's promise end to end and
becomes the contract test for server codes.

## Decisions (resolved 2026-09-06)

- **D1 — Server diagnostics are dev-only.** The 8 `solid-js` server warnings
  fire in prod today by accident of having no gate, not by design. All
  diagnostics move behind `"_SOLID_DEV_"`, matching the client.
  `[SERVER_WRITE]`'s "will become an error" is a deprecation notice — a dev
  concern. Error containment (`failRender ?? console.error`) is not a
  diagnostic and stays as is.
- **D2 — Condition name is `development`**, nested under `worker`/`deno`/
  `node`, exactly as `./server-functions` already does.
- **D3 — Land order: P0 now, independent of `diagnostics-expansion`.** P1/P2
  land after that branch merges and reuse its `ownerPath`, `reportDiagnostic`,
  and component-label helper rather than duplicating them.

## Risks

- **Does the `development` condition reach server packages in Vite dev SSR?**
  Vite's `ssr.resolve.conditions` include `development|production`, but
  _externalized_ SSR deps are resolved by Node, which knows nothing of
  `development` unless `ssr.resolve.externalConditions` includes it or the
  packages are `noExternal`. `vite-plugin-solid` sets `noExternal` for the
  solid packages (to honor the `solid` condition) — verify this in the plugin
  repo before claiming the dev build is reachable. **Canary:**
  `@solidjs/web/server-functions` already has a dev variant; if it resolves to
  `server.dev.js` in a Vite dev SSR request today, the new ones will. If it
  does not, that is a pre-existing bug this plan surfaces, and the fix is in
  the plugin (externalConditions or noExternal), not here.
- **Non-Vite servers** (plain Node, Deno, workers in dev) need
  `--conditions=development` or the runtime equivalent. Document it; it is
  the same story as any dual-build package.
- **Mixed resolution**: `@solidjs/web` server externalizes `solid-js`; the
  host resolves each package independently. Both must get `development`
  together. The resolution test in P0 pins this for the two packages; the
  plugin is responsible for passing the condition.
- **Dev SSR behavior change** (fact 5): late header writes throw in dev after
  P0. Correct, but users who never saw the bug will see a crash. Changeset
  and migration note.
- **Test suite already runs dev branches** (source, truthy literal), so P0
  changes nothing about test coverage of the gates — but it also means the
  suite never exercised the _prod_ path of `solid-js`'s server entry either.
  The artifact tests are the only guard; write them.

## Related

- Sketch: `documentation/proposals/production-observability-sketch.md` §3.0
  (wiring vs checks), §9 (server), §10.2–10.4 (server codes), §12 (open
  questions this plan answers or scopes).
- Existing pattern: `packages/web/rollup.config.js` server-functions dev
  build (`server-functions/dist/server.dev.*`) and its nested `development`
  exports.
- #2982 and `packages/web/test/server/dist-server-artifact.spec.tsx` — the
  artifact-level guard this plan copies for the dev variant.
