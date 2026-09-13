# @solidjs/diagnostics

## 2.0.0-rc.9

### Patch Changes

- Updated dependencies [d7cb456]
- Updated dependencies [6095955]
- Updated dependencies [9da7f0a]
- Updated dependencies [632e45c]
- Updated dependencies [ca05917]
- Updated dependencies [af94f67]
  - @solidjs/signals@2.0.0-rc.9

## 2.0.0-rc.8

### Patch Changes

- 0961d97: Observe tier: first-class interaction records and a typed record channel.
  - `attribution.interactions()` and `InteractionEvent`: one record per `withInteraction` dispatch with `at`, `handlerMs`, `writes`, `runs`, `created` (computations built in its runs), `runMs`, the `holds` and `navigations` attached, and `settledMs`/`outcome` (`idle` | `committed` | `held`) once everything it caused is through.
  - `attribution.subscribe(type, listener)` for `"rerun" | "interaction" | "hold" | "navigation"`, delivered synchronously as each record completes; the bare `subscribe(listener)` form is unchanged.
  - `RerunEvent.at` and `HoldEvent.at` — absolute times on the `performance.now()` clock beside the existing durations.
  - `HoldEvent.acknowledgements` replaces `acknowledgedBy`: one `{ kind, source, reader? }` per affordance, `reader` the owner path of the effect that painted it. `feedback().sources[].acknowledgedBy` still ranks by `kind:source`. `@solidjs/diagnostics` artifact format version 4 (holds carry `acknowledgements`; assertion evidence likewise).
  - `NavigationRef.params` values may be `undefined` (an optional segment left unbound).
  - `OBSERVE.exclude(owner)` / `OBSERVE.isExcluded(subject)` — an observer rendering inside the app it watches marks its own subtree; diagnostics about it are suppressed and the engine records none of its runs.
  - `solid-js` re-exports the tier types from its root: `InteractionRef`, `NavigationRef`, `OriginRef`, `DiagnosticEvent` and friends, and the engine's record types (`ChangeOrigin`, `RerunEvent`, `HoldEvent`, `NavigationEvent`, `InteractionEvent`, …).

- 1807f7f: Observe tier: split dev-only checks from production-legal observability wiring.

  **Breaking (pre-release):** `DEV.diagnostics` moved to a new `OBSERVE` export
  — `OBSERVE.diagnostics.{subscribe,capture,emit}`, `OBSERVE.subjectOf(event)`.
  `DEV` keeps the devtools surface (`hooks`, `getChildren`/`getSignals`/
  `getParent`/`getSources`/`getObservers`) and gains the console face
  (`DEV.report`, `DEV.setConsoleFooter` — formerly
  `DEV.diagnostics.setConsoleFooter`). Both are exported from `@solidjs/signals`
  and `solid-js` (client and server).

  **Breaking (pre-release):** the attribution engine is its own entry.
  `DEV.attribution.enable()` and friends are now
  `import { attribution } from "solid-js/attribution"` (or
  `@solidjs/signals/attribution`) — `enable/disable/subscribe/history/why/
subscriptions/costs/waterfalls/holds/feedback/markFlight/format/formatOrigin`,
  plus the record types (`RerunEvent`, `ChangeRecord`, `ChangeOrigin`,
  `HoldEvent`, …) which were previously unexported. The runtime keeps only the
  core's side as `OBSERVE.attribution`: `install(hooks)`/`installed` (the hook
  slot an engine — built-in or a devtools' own — installs into) and
  `withInteraction(ref, fn)` (the frame the web runtime opens around every event
  dispatch; `fn()` when no engine is installed). A build that never imports the
  engine never ships it: the observe tier costs ~1.3 KB brotli over prod on the
  CSR scenario, the engine 9.7 KB more when enabled. The import is legal in
  every tier — prod resolves an inert engine with the same surface.
  `@solidjs/diagnostics` requires `OBSERVE` and imports the engine itself; it now
  works against observe builds.

  **New build tier.** Every package with wiring ships `<entry>.observe.{js,cjs}`
  beside its prod and dev artifacts, selected by a new `observe` export condition
  (listed after `development`, so dev still wins when both are set): signals
  `dist/observe/` + `dist/node.observe.cjs` (each with an `attribution` entry
  beside `index`; the flat dev/CJS builds are code-split so both entries share
  one module instance), solid-js `solid.observe.*` and
  `server.observe.*`, web `web.observe.*`, universal `universal.observe.*`.
  Observe builds keep attribution hook sites, owner labels (`_name`, flow-control
  memo names, component roots), graph edge counters and the diagnostics channel;
  they fold out strict-read checks, invariants, forbidden-scope guards, devtools
  brands and all console output. Entries without wiring (frames, server-functions,
  storage, h, html, element) fall through to prod under `observe`. Signals gates
  on `__OBSERVE__` (dev implies observe; asserted at init), solid-js/web/universal
  on the `"_SOLID_OBSERVE_"` literal. Default prod artifacts are unchanged apart
  from the new `OBSERVE = undefined` export; `_name` is reserved from property
  mangling so the cross-package label survives in the observe tree.
  `OBSERVE.diagnostics.emit` accepts an explicit `ownerPath` for hosts whose
  owners are not signals' owners (the SSR runtime).

- Updated dependencies [21c5460]
- Updated dependencies [711b557]
- Updated dependencies [1354a53]
- Updated dependencies [ae0ec3f]
- Updated dependencies [1c9e9e7]
- Updated dependencies [b5bd6fb]
- Updated dependencies [b5bd6fb]
- Updated dependencies [b5bd6fb]
- Updated dependencies [b5bd6fb]
- Updated dependencies [b5bd6fb]
- Updated dependencies [b5bd6fb]
- Updated dependencies [05725e8]
- Updated dependencies [27aee36]
- Updated dependencies [fe3ab92]
- Updated dependencies [51c201f]
- Updated dependencies [2fa7539]
- Updated dependencies [0961d97]
- Updated dependencies [1807f7f]
- Updated dependencies [645ec0d]
- Updated dependencies [12c3be9]
- Updated dependencies [3a5fe8c]
- Updated dependencies [a39415c]
- Updated dependencies [dd1d4ed]
- Updated dependencies [4e730a9]
- Updated dependencies [4935c7d]
- Updated dependencies [0f14430]
  - @solidjs/signals@2.0.0-rc.8

## 2.0.0-rc.7

### Patch Changes

- 6c8c956: Attribution: `feedback()` gains the fact tables that have no verdict of their own. `flights` counts, per async source, flights started, landed, and abandoned (superseded by a newer flight before landing — the re-ask-on-every-keystroke signature) with landed wall time. `fallbacks` measures, per loading boundary (named by owner path), how many times and for how long its fallback was shown and how many shows were sub-150ms flashes — the other end of the SILENT_HOLD spectrum. `sources` rows gain `late`/`lateMs`: acknowledged holds that still ran past `holds.infoMs`, where the affordance is not the whole answer. New `AttributionHooks.boundaryFallback` hook point at the boundary's source-set transitions. `@solidjs/diagnostics` exports the `FlightStats` and `FallbackStats` types; artifacts and the bridge carry the new tables through the existing `feedback` field.
- d5aba4b: `WIDE_WRITE` and `HOT_SCOPE_FANOUT` diagnostics, and the reactivity-diagnostics and agent-loops skills, now prescribe a projection (`createProjection`, or a `createStore(fn)` keyed by id) as the fan-out repair. They previously named an API that is not part of 2.0 (#3304).
- 1a1e2f2: Diagnostics: the responsiveness gate — holds and feedback in the artifact, `expectNoSilentHolds`, and Loop 4.

  The artifact (format v2) now carries `attribution.holds` — every transition hold the scenario caused, with the held writes, the blockers, the wait measured from the interaction, and which affordances acknowledged it — and `attribution.feedback`, the ranked `sources`/`interactions` tables folded from them. JSONL egress emits `hold` and `feedback` records; the browser bridge and the `/__solid/diagnostics` protocol gain `holds()` and `feedback()` live queries.

  New gates: `expectNoSilentHolds(artifact, { maxSilentMs })` fails on any hold the screen never acknowledged (no `isPending()`/`latest()` reader, no optimistic value, no `affects()` mark, nothing painted) with the interaction, held write, blocker, and duration as evidence; `expectHoldBudget(artifact, ms, { source })` bounds hold latency regardless of acknowledgment. `ScenarioBudget` gains `maxSilentHoldMs` and `maxHoldMs`; Vitest gains `toHaveNoSilentHolds()` and `toStayWithinHoldBudget(ms)`. The agent-loops skill gains "Loop 4 — Responsiveness": read `feedback.sources` first, repair by shape (`isPending` → `latest` → `createOptimistic`), and the explicit anti-repair — never make the gate pass by moving the write off the async path. Types `HoldEvent`, `ChangeOrigin`, `AttributionFeedback`, `FeedbackSource`, `FeedbackInteraction` are exported.

- f4d3c87: Responsiveness thresholds and the LONG_HOLD diagnostic.
  - `SILENT_HOLD` defaults tighten to `holds: { infoMs: 100, warnMs: 200 }` (from 300/500): RAIL's "feels instant" ceiling and the INP "good" ceiling. The engine measures to the commit, not the paint, so every number is a floor on what the user saw; the console's thresholds now sit at the strict end of the band.
  - New `LONG_HOLD` (`responsiveness` kind): an acknowledged hold whose quiescent tail — from the last write to join it to the commit — reached `longHolds.infoMs` (default 500ms), `warn` from `longHolds.warnMs` (1000ms). Measured from the last join so a hold that keeps taking input is judged by each wait, not its lifetime. The repair is a fallback: a `Loading` boundary keyed with `on` (a revealed boundary without `on` keeps the old content — that is the hold), a fresh boundary, or making the data fast. A silent long hold stays one `SILENT_HOLD` with the same repair appended and `data.long: true`.
  - `HoldEvent.tailMs` added; `holdMs` now runs from the interaction dispatch or the first parked flush, whichever is earlier (a node rewritten mid-hold keeps only its latest record, so the flush clock keeps the first wait from being forgotten). `ChangeRecord.at` stamps root writes.
  - `feedback().sources[].late/lateMs` replaced by `long/longMs`: holds whose tail reached the long-hold threshold, acknowledged or not.
  - `@solidjs/diagnostics` artifact format version 3 (`tailMs` on holds, `long`/`longMs` on sources); hold evidence in assertion failures includes `tailMs`.
  - `RerunEvent.phase` value `"transition"` renamed to `"held"` (`"plain" | "held" | "optimistic"`) — the dev surface uses one word for the state.

- Updated dependencies [215de3b]
- Updated dependencies [6c8c956]
- Updated dependencies [1a1e2f2]
- Updated dependencies [7c14e23]
- Updated dependencies [ef2b02c]
- Updated dependencies [c6c415b]
- Updated dependencies [6c8c956]
- Updated dependencies [d5aba4b]
- Updated dependencies [3ae0ca0]
- Updated dependencies [ae46c92]
- Updated dependencies [6c8c956]
- Updated dependencies [1a1e2f2]
- Updated dependencies [f98bd77]
- Updated dependencies [fc7e626]
- Updated dependencies [d50e855]
- Updated dependencies [8f9f369]
- Updated dependencies [c531e2a]
- Updated dependencies [aed21ac]
- Updated dependencies [b3c94be]
- Updated dependencies [0653673]
- Updated dependencies [6c8c956]
- Updated dependencies [94fe5b4]
- Updated dependencies [23477ae]
- Updated dependencies [f4d3c87]
- Updated dependencies [067e3bc]
- Updated dependencies [8a65e5e]
- Updated dependencies [f24e53d]
- Updated dependencies [fa568d3]
- Updated dependencies [d601119]
- Updated dependencies [ac5159a]
- Updated dependencies [de1c8b5]
- Updated dependencies [c07a044]
- Updated dependencies [01e3a57]
- Updated dependencies [e346e61]
- Updated dependencies [713a910]
- Updated dependencies [e346e61]
- Updated dependencies [0255729]
- Updated dependencies [6c8c956]
  - @solidjs/signals@2.0.0-rc.7

## 2.0.0-rc.6

### Patch Changes

- Updated dependencies [e13ca05]
- Updated dependencies [432b089]
- Updated dependencies [aa03f76]
- Updated dependencies [fb5061c]
- Updated dependencies [6b743c6]
- Updated dependencies [989579e]
- Updated dependencies [1012859]
- Updated dependencies [bf97b8a]
- Updated dependencies [71acf62]
- Updated dependencies [32bc013]
- Updated dependencies [3e36d6d]
- Updated dependencies [202ee53]
- Updated dependencies [e767ebd]
  - @solidjs/signals@2.0.0-rc.6

## 2.0.0-rc.5

### Patch Changes

- Updated dependencies [51ffcb9]
- Updated dependencies [28a1eaf]
- Updated dependencies [ca16891]
- Updated dependencies [751f991]
- Updated dependencies [ed2fb43]
- Updated dependencies [893b8f9]
- Updated dependencies [2023daa]
- Updated dependencies [3e3676b]
- Updated dependencies [09bbe24]
- Updated dependencies [88fa9d6]
- Updated dependencies [fa13761]
- Updated dependencies [90603c5]
- Updated dependencies [a536e29]
- Updated dependencies [4ee9e3b]
- Updated dependencies [1ece086]
- Updated dependencies [0c02d42]
  - @solidjs/signals@2.0.0-rc.5

## 2.0.0-rc.4

### Patch Changes

- Updated dependencies [8d249c7]
- Updated dependencies [f0c3692]
- Updated dependencies [8d249c7]
- Updated dependencies [505c73d]
- Updated dependencies [de9e3cb]
- Updated dependencies [0e37f90]
- Updated dependencies [8d249c7]
- Updated dependencies [b96d7ce]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [ba6c0b6]
  - @solidjs/signals@2.0.0-rc.4

## 2.0.0-rc.3

### Minor Changes

- a85c889: New package `@solidjs/diagnostics`: agent-consumable diagnostics harness. `captureArtifact()` runs a scenario with the dev-mode diagnostic and attribution channels open and folds both into a serializable artifact; assertion helpers (`expectNoDiagnostics`, `expectDiagnostic`, `expectRerunBudget`, `expectNoWaste`) and scenario budgets (`assertBudget`, checked-in budget files) gate correctness, update granularity, and wasted recomputes; Vitest matchers via `@solidjs/diagnostics/vitest`; a browser bridge (`@solidjs/diagnostics/browser`) plus a structurally-typed Playwright adapter (`@solidjs/diagnostics/playwright`) capture the same artifacts from real pages, with live `whyDidRun`/`costs` queries against an open session; `@solidjs/diagnostics/protocol` publishes the wire types for the vite-plugin dev-server endpoint; `artifactToJSONL()` provides line-oriented egress for offline/agent analysis. `solid-js` now ships a `skills/reactivity-diagnostics` repair guide mapping every diagnostic code to its fix.

### Patch Changes

- Updated dependencies [6717398]
- Updated dependencies [bbcce0a]
  - @solidjs/signals@2.0.0-rc.3
