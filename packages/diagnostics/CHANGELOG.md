# @solidjs/diagnostics

## 2.0.0-rc.9

### Patch Changes

- eaa7e33: The attribution engine's folds, queries and formatters are named exports of `@solidjs/signals/attribution` (and `solid-js/attribution`), not methods of `attribution`.
  - `costs()`, `feedback()`, `why(target)`, `subscriptions(target)`, `formatRerun(event)`, `formatOrigin(origin)` — import them by name. `attribution` keeps `enable`, `disable`, `subscribe`, `markFlight` and the record ring buffers (`history`, `holds`, `interactions`, `navigations`, `waterfalls`). `attribution.format` is `formatRerun`.
  - Why: the fold tables (`costs`, `feedback`) are the dev/agent view of the records and the part of the engine that grows; a production adapter consumes records and never calls them. Each fold's module registers its accounting with the engine's fold seam when it is imported, so under the package's `sideEffects: false` a consumer that only subscribes to records ships neither the tables nor the work of filling them — importing `costs` or `feedback` is what turns them on. Measured: −1,150 B brotli for a records consumer (the size scenario's cap ratcheted to 27.25 KB); tree-shake tests pin it from source and from the built observe artifact.
  - New types `AttributionCostTables`; `ScopeCost`/`WriteCost` and the feedback types move with their modules and are still exported from the entry. The prod tier's inert twin exports the same named surface, typed against the real one.
  - `@solidjs/diagnostics`: `AttributionCosts`/`AttributionFeedback` are aliases of `AttributionCostTables`/`AttributionFeedbackTables`; the capture and the browser bridge import the folds by name. Artifact shape unchanged.

- ebedb44: Attribution re-run records are serializable as emitted, and the observe tier's idle cost is a cap.
  - `RerunEvent` no longer carries the live `node`. It names its scope by `nodeId` — the engine's per-node id, stable across the scope's runs in the process and distinct between scopes (so runs of unnamed effects still fold to one scope after the record has left the process). In-process consumers that want the node ask `OBSERVE.subjectOf(event)`, which now answers for re-run records as it did for diagnostic events, for as long as the caller holds the record object. `attribution.why(target)` and `subscriptions(target)` are unchanged.
  - `@solidjs/diagnostics` artifact format v7: re-runs are stored verbatim (`RerunRecord` is now an alias of `RerunEvent`), and the artifact gains `timeOrigin` — the capturing process's `performance.timeOrigin` — so every relative `at` in it (re-runs, holds, records, diagnostic `data`) is convertible to absolute time after the fact, and a server capture lines up with the browser session it served. The JSONL meta line carries it too; the browser bridge payload includes it.
  - New tripwire in the signals suite: the built observe artifact runs a graph-heavy workload within 1.25× of the built prod artifact with no hooks installed (measured 1.03–1.09). The idle wiring cost was informational before; it is capped now.

- 3ae9e92: `OBSERVE.records` — one records channel on both platforms (observe/dev tiers); frame records from both ends; the client `"call"` record; `observeServerFunctionCalls` removed
  - **`@solidjs/signals`**: `OBSERVE.records` — `subscribe(type, listener)`, `observed(type)`, `emit(type, event, live)` — the channel every runtime record rides, created once per process and registered on `globalThis` under `Symbol.for("@solidjs/signals/observe/records")` so a second copy of the core (a bundled server build instrumented through `--import`) and wire layers bundled without a framework import reach the same listener sets. Listeners are snapshotted per emit; a throwing listener is reported and the rest run. Types: `Records`, `RecordTypes` (extends `HostRecordTypes`; both declared empty, for the runtimes to augment — one augmenter per interface), `RecordType`, `RecordEvent`, `RecordLive`, `RecordListener`. Folds out of prod. New **`OBSERVE.attribution.currentOrigin()`** (and the `currentOrigin` hook on `AttributionHooks`): the provenance a root write performed now would be stamped with — the interaction whose handler is running, the navigation/effect/action frame open, or inside a recompute the origin of the change that caused it — as the engine's own `ChangeOrigin` object, `undefined` when external or with no engine; for a runtime stamping a record of its own. The installed hooks are also registered on `globalThis` under `Symbol.for("@solidjs/signals/observe/attribution")`, the same reach-without-an-import the channel has.
  - **`solid-js`**: the `"boundary"` record moves from `OBSERVE.server.records` to `OBSERVE.records` (augmenting the core's `RecordTypes`). `OBSERVE.server` keeps only the `trace` slot; `ServerRecords` is gone.
  - **`@solidjs/web`**: the `"invocation"` and `"frame"` records move to `OBSERVE.records` (augmenting `HostRecordTypes` through `solid-js`). New **`"call"` record** (`CallEvent`, `CallLive`, `CallListener`): one per server-function call made from the browser, at the caller's settle — `{ id, at, durationMs, method: "GET" | "POST", outcome, status?, origin?, deferred? }` with `{ args, response?, result? | error? }` beside it; joins the server's `"invocation"` by `id`, and — through `origin`, the engine's own interaction/navigation object read at dispatch via `currentOrigin()` — the attribution engine's `InteractionEvent` / `NavigationEvent` / `HoldEvent` by identity, so an observer files the call under the click that made it without a time join. The **`"frame"` record now has a client half**: `FrameEvent` is `FrameProducedEvent | FrameAppliedEvent`, discriminated by `side`, same census on both; the client half (`applyFrameResponse`, one per stream in a response) adds `address` (the `as` remap) and `outcome: "truncated"` for a body that ended before `complete`, with `live.response`. Server census fix: `regions` counts `html` chunks addressed to a child frame id (the former count read a chunk type that does not exist), and `shellMs` is set by the stream's own shell only. The emitters and their wrappers fold out of the prod client artifacts behind the observe literal (prod `applyFrameResponse` and the server-function dispatch are the pre-existing functions, no extra frame or promise hop). The server-functions and frames **client** entries gain `observe` and `development` builds and export conditions (`server-functions/dist/client.{observe,dev}.js`, `frames/dist/client.observe.js`); the server-functions client is now built with its flags replaced in every tier (before, `_SOLID_DEV_` there was an unreplaced truthy string).
  - **Removed**: `observeServerFunctionCalls` and the `ServerFunctionCall` / `ServerFunctionRequestCall` / `ServerFunctionResponseCall` types, from both server-function entries. Subscribe to `OBSERVE.records` `"call"` (client) or `"invocation"` (server) instead.
  - **`@solidjs/diagnostics`** (format v6): `artifact.server` is replaced by `artifact.records: { boundary, invocation, frame, call }` — always present, captured on both platforms including the browser bridge; types `BoundaryRecord`, `InvocationRecord`, `FrameRecord` (`FrameProducedRecord | FrameAppliedRecord`), `CallRecord` (with `origin?: ChangeOrigin`), `ArtifactRecords` replace the `Server*Record` / `ArtifactServer` names. JSONL: one line per record with `type` naming its table; the meta line's `boundaryCount`/`invocationCount`/`frameCount` become `recordCounts: { boundary, invocation, frame, call }`.

- 0d8347a: Server records reach the diagnostics artifact and the dev checks (server-dev-build-plan P4)
  - `@solidjs/diagnostics` artifact format **v5**: `artifact.server: { boundaries, invocations } | null` folds `OBSERVE.server.records` when the scenario runs under the server runtime — `captureArtifact(() => renderToStream(…))` — one row per `<Loading>` boundary that waited and per server-function execution; `null` for client captures and the browser bridge. New exported types `ArtifactServer`, `ServerBoundaryRecord`, `ServerInvocationRecord` (mirrors of the runtime's `BoundaryEvent`/`InvocationEvent`; the package still depends on `@solidjs/signals` alone). JSONL egress adds `boundary` and `invocation` lines and the header counts.
  - `InvocationEvent.boundary`: a direct server-function call made during a `<Loading>` boundary's render pass carries that boundary's hydration id, the `"boundary"` record's `id` — the join between a boundary's wait and the calls under it.
  - Two dev checks derived from the boundary facts in `ssrLoadingBoundary`: `ASYNC_WATERFALL` with `data.side: "server"` (`passes - 1` sequential flights; 2 → `info`, structured only; 3+ → console `warn`) and a new code `SSR_CLIENT_CONTENT_MASKED` (`warn`, `ssr`) for client-only content that surfaced only after a real server wait — the server's work discarded, the fallback shown for the wait. Dev tier only; the boundary clock now runs in dev without a listener.
  - `solid-js`'s server `emitFinding` keeps `info` findings off the console (structured channel only), matching the core.

- Updated dependencies [8ff4803]
- Updated dependencies [e9c464b]
- Updated dependencies [0da94f9]
- Updated dependencies [8bf04ea]
- Updated dependencies [eaa7e33]
- Updated dependencies [ebedb44]
- Updated dependencies [a8a8949]
- Updated dependencies [d80cd1f]
- Updated dependencies [d826cd3]
- Updated dependencies [cc0396b]
- Updated dependencies [d2a36f5]
- Updated dependencies [50323b4]
- Updated dependencies [53280e7]
- Updated dependencies [d7cb456]
- Updated dependencies [a0d6dd2]
- Updated dependencies [c3ae310]
- Updated dependencies [6095955]
- Updated dependencies [e80f241]
- Updated dependencies [84adf0b]
- Updated dependencies [5c1f01f]
- Updated dependencies [a5d8eae]
- Updated dependencies [14ded24]
- Updated dependencies [25c5064]
- Updated dependencies [1ce0f85]
- Updated dependencies [05c7e21]
- Updated dependencies [9da7f0a]
- Updated dependencies [62b0a22]
- Updated dependencies [27b24aa]
- Updated dependencies [549f482]
- Updated dependencies [d80cd1f]
- Updated dependencies [76230f9]
- Updated dependencies [347a5ca]
- Updated dependencies [a8a8949]
- Updated dependencies [632e45c]
- Updated dependencies [75c5113]
- Updated dependencies [899c2c4]
- Updated dependencies [ca05917]
- Updated dependencies [3ae9e92]
- Updated dependencies [328580f]
- Updated dependencies [0bffee2]
- Updated dependencies [f329a26]
- Updated dependencies [c827758]
- Updated dependencies [6e9243c]
- Updated dependencies [7a09cd9]
- Updated dependencies [61a114c]
- Updated dependencies [0d8347a]
- Updated dependencies [7623ce1]
- Updated dependencies [af94f67]
- Updated dependencies [e87d694]
- Updated dependencies [dd19e9e]
- Updated dependencies [c245532]
- Updated dependencies [34287d8]
- Updated dependencies [64f9266]
- Updated dependencies [0148d58]
- Updated dependencies [765a656]
- Updated dependencies [9db33cf]
- Updated dependencies [bfd6f6c]
- Updated dependencies [2054045]
- Updated dependencies [c410709]
- Updated dependencies [f555ec2]
- Updated dependencies [d8e35a3]
- Updated dependencies [5f7da9d]
- Updated dependencies [7f5f902]
- Updated dependencies [31adfce]
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
