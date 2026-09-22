# Chrome Performance Tracks — Solid's records on the Performance panel

_Drafted 2026-09-18 as a Cursor plan; landed in the repo 2026-09-21 with the
work. Status: SHIPPED through Stage 4 on the `perf-tracks` branch; Stage 5
deferred. Sibling of `responsiveness-findings-plan.md` (the findings and the
interaction-contract decisions D1/D2; its "↔ Tracks" marks are the meeting
points) and second consumer, beside `@sentry/solid-2`, of the observe-tier
contract in `proposals/production-observability-sketch.md` §7. Owner: Ryan._

## Why

The human's role is shifting from writer to verifier, and humans do not
verify by reading JSONL artifacts; they verify on a timeline they already
trust. When an agent says "your click's write sat in a silent hold for 400ms
behind `getUser`" and the developer opens the Performance panel and sees the
same named span, same duration, same origin on a Solid track between
Chrome's main-thread and network tracks, the loop closes. Same records, two
renderings: the artifact for the agent, the track for the human, consistent
because they are one stream. Everyone else's track shows what rendered;
Solid's shows why.

Design constraint that follows: every label, tooltip and property on a
track comes from the shared formatters (`formatOrigin`, `formatRerun`) and
the same `ownerPath` the diagnostics artifact carries, never from
adapter-local strings, so the two renderings cannot drift.

## What shipped

`@solidjs/web/performance-tracks` — `enablePerformanceTracks(options?)`,
dev and observe tiers, a no-op in prod (the module folds to `() => noop`).
User documentation: `documentation/solid-2.0/08-dev-diagnostics.md`, "Chrome
Performance panel". Emission mirrors React's: `console.timeStamp(label,
start, end, track, group, color)` on the cheap path, `performance.measure`
with `detail.devtools` (+ batched `clearMeasures`) in rich mode (dev
default); every entry retroactive from the record's own `performance.now()`
stamps, so no hot path is bracketed. Tracks seeded with zero-length entries
at t=0.003 in a fixed order.

| Track          | Records                               | Reads as                                                                                                                     |
| -------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `Interactions` | `interaction`                         | input delay → handler → settle (`committed`/`held`); silent hold = `warning`                                                 |
| `Propagation`  | `flush` + `rerun`/`create`/`effect`   | one wave per drain (`count 0 → 1 — click on button#next · 5 runs, 1 unchanged`), the runs beneath it labelled `node ← cause` |
| `Effects`      | `rerun`/`create`/`effect` (effects)   | re-runs by owner path, `· create`, `· callback`; colour by self time; `warning` when `changed: false`                        |
| `Memos`        | `rerun`/`create` (memos)              | same                                                                                                                         |
| `Async`        | `flight`, `fallback`                  | kickoff → landing (`abandoned` = `warning`); fallback shown → hidden                                                         |
| `Holds`        | `hold`                                | the wait, by blockers; `warning` silent, `error` long (the engine's verdicts)                                                |
| `Navigations`  | `navigation`                          | request → settle, by route pattern                                                                                           |
| `Server`       | `call`, `frame` (web runtime records) | server-function calls; frame streams with a shell sub-span                                                                   |
| Timings        | `OBSERVE.diagnostics`                 | one marker per finding, `performanceIssue` at `warn`+ (Stage 4)                                                              |

Stages, as landed (one commit each on the branch):

- **Stage 0 — shared foundation** (`@solidjs/signals`, `@solidjs/web`):
  `attribution.enable()` as a hold returning its release (live state
  survives until the last hold; options layer in hold order and a released
  hold's layer goes with it; `disable()` is the full teardown; each
  `enable()` resets the aggregation windows, which is what a capture wants
  — the token form landed in review, replacing a counted `disable()`); `AttributionOptions.checks` (default `true`, D2
  proper still open); `isSilentHold`/`isLongHold` on the public entry;
  `dispatchAsInteraction` passes `at: e.timeStamp` and the record carries
  `inputDelayMs`; the INP join recipe documented (`entry.startTime ===
interaction.at`).
- **Stage 1 — adapter over existing data** (`@solidjs/web`): the subpackage,
  rollup dev/observe/prod entries, export conditions, `Interactions` /
  `Effects` / `Memos` / `Holds` / `Navigations` / `Server`, `minMs`, `rich`,
  `scrub`, `group`; vitest specs; verified in Chrome with a scratch page.
- **Stage 2 — engine records for parity** (`@solidjs/signals`): `flush`,
  `create`, `effect`, `flight`, `fallback` (below); `effectRunStart/End`
  moved from `__DEV__` to `__OBSERVE__`; a 27% regression on the enabled
  observe path (a `WeakMap.set` per effect callback in `pushFrame`) found
  and removed by registering effect frames lazily, only when a write uses
  one as its origin — enabled cost back at the `next` baseline. Re-run after
  the rebase over #3575 (the boundary run path rewritten): 2,000 effects on
  one signal, and 200 `<Loading>` boundaries each over a memo read by 10
  effects, disabled / enabled `checks: false` / enabled `checks: true`,
  min-of-5 medians of 200 flushes — every cell within ±6% of `next`, signs
  both ways (parity; the machine's noise band).
- **Stage 3 — Propagation track** (replaced the planned component record).
  Solid does not re-render components, so a per-component track answers the
  wrong question; what a developer wants to see is the graph the write
  travelled. `ChangeRecord.nodeId` on derived records links a run's causes
  to the memo runs that produced them; the adapter folds each drain into a
  wave and labels every run by its cause. Internal flow-control nodes were
  named (`conditions`, `children`, `boundary`, `value`, `reveal order`) so
  the adapter can fold them into their tag.
- **Stage 3.5 — compiler source names** (`@solidjs/compiler`,
  `@solidjs/babel-plugin`, `@solidjs/web`, `@solidjs/signals`): the option
  `componentNames` became `sourceNames: boolean | { components, bindings }`;
  `bindings` names every compiled binding effect by what it writes
  (`span.textContent`, `div.class:active`, `div.children`, `div.spread`);
  the new native pass `transformSourceNames` (`sourceNames.primitives`)
  names `createSignal`/`createMemo`/`createStore`/… after the identifier
  they are declared as, prefixed with the enclosing non-component function
  (`createCounter.value`), on `.ts`/`.js` modules too; stores honour
  `options.name` (`todos.title`, not `store.title`). Without this the
  Propagation track read `signal → computed → effect`.
- **Stage 4 — dev enrichments** (`@solidjs/web`, `solid-js`): diagnostics
  as Timings markers with `performanceIssue` at `warn`+ (`learnMoreUrl` =
  `diagnosticGuideUrl(code)`, the repair guide's section, now exported from
  `solid-js`; `info` stays a plain marker; under the scrub only code, kind
  and owner travel); `console.createTask(label)` on the dev component
  record (`_component.task`) and every span/marker emitted inside the
  nearest component's task so its stack in the panel is the JSX site;
  `Owner path` (unfolded), `Node`, `Node id` and root `Origin` properties on
  every node span.

## Engine records (Stage 2), in the responsiveness plan's four fields

- **`flush`** — Known: `flushStart()`/`flushEnd()` in `scheduler.ts`, outside
  every `try`, `__OBSERVE__`-gated. Shape: `{ at, durationMs, runs, created,
held, interaction? }`. Idle cost: one null-check per drain; the record is
  built only while a `flush` listener exists. Proof:
  `attribution-timeline.test.ts` — one record per drain with its counts; a
  drain under a transition is `held`.
- **`create`** — Known: `recomputeStart(el, create: true)`/`recomputeEnd`
  (the existing hooks; previously `recomputeEnd` skipped the record when
  `frame.causes === null`). Shape: `RerunEvent` minus causes. Idle cost:
  none new; built only while listened to; never enters `history()`/`costs()`.
  Proof: a memo created inside a render effect's body produces one `create`
  record counted in the enclosing `flush.created`.
- **`effect`** — Known: `effectRunStart/End(el)` in `effect.ts`, guard moved
  from `__DEV__` to `__OBSERVE__`. Shape: `{ at, durationMs, nodeId,
nodeName, run?, interaction? }`. Idle cost: one null-check per callback;
  the enabled cost audited (below). Proof: callback timing tests; the
  micro-benchmark.
- **`flight`** — Known: the fold facts `flightStart(el, superseded)` /
  `flightLanded(el, ms)` promoted to a record. Shape: `{ nodeId, nodeName,
ownerPath?, at, durationMs, outcome: "landed" | "abandoned",
interaction? }` — the fingerprint fields responsiveness item 4's
  `ABANDONED_FLIGHTS` needs. Idle cost: none new (the folds already ran).
  Proof: a superseded flight is `abandoned`; a landed one carries its
  duration.
- **`fallback`** — Known: `boundaryFallback(boundary, tree, shown,
transition)`. Shape: `{ ownerPath?, at, shownMs, interaction? }` (item 4's
  `FALLBACK_FLASH` reads `shownMs`). The show is the boundary's SWAP, a
  staged write that lands with its transaction (#3575: `on` follows the
  frame); the engine holds the open under that transaction and stamps `at`
  at the `flushEnd` of the drain that committed it — the display instant —
  and a hide before that drops the open: a swap the content outran, or one
  the commit's own sweep cleared before any effect ran, was never on
  screen and is no record (the feedback fold's `shows`/`flashes` agree).
  Idle cost: none new. Proof: display → hide produces one record with the
  boundary's owner path; the #3540 product page's "content lands first"
  shape produces none, and its "shell lands first" shape is timed from the
  commit, not the re-arm.
- **`ChangeRecord.nodeId`** (Stage 3) — Known: `stampWrite`/`stampDerived`.
  Shape: optional `nodeId` on every derived record. Idle cost: one field
  write on a path already stamping. Proof: `attribution.test.ts`, the chain
  through a memo carries the memo's id.

## Decisions, and where they landed

- Explicit opt-in; Start enables it in dev by default (Start repo, out of
  scope here). Package name `performance-tracks` on purpose: Chrome's
  feature is "custom performance tracks", React's is "React Performance
  Tracks"; the subpath stays on `@solidjs/web` because the adapter paints
  web records (`call`, `frame`) and inherits the dev/observe/prod tiering.
- Imports only `attribution`, `formatRerun`, `formatOrigin`, the hold
  verdicts, and now `diagnosticGuideUrl` — never `costs`/`feedback`, which
  would re-enable the fold tables the engine diet made optional.
- `minMs` is `0` in dev and `0.05` in observe builds; the vendor adapter keeps
  its own thresholds (sketch §4.1). The wave span is always painted and
  carries the counts, so a fan-out too small to paint still reads as
  `47 runs`.
- PII: observe builds apply the sketch §6 scrub by default (no value
  previews; element text only on a `button`/`a`; a finding's sentence
  dropped); dev shows everything.
- Clock quantization (08-dev-diagnostics): without cross-origin isolation
  many `Effects`/`Memos` spans are zero-width. Never dropped; the wall-clock
  tracks carry the meaning.
- The component record (original Stage 3) was cancelled, not deferred. A
  mount-only flame was React's shape, not Solid's; creation runs on
  `Effects`/`Memos` plus the Propagation wave describe a mount storm better
  (`InteractionEvent.created` counts it).
- Third-party composed primitives keep the labels their package chose: the
  primitives pass never runs inside `node_modules`.

## Coordination

- **Sentry (`@sentry/solid-2`, paused).** Unaffected by Stage 4 (adapter-side,
  dev-only). Benefits from Stages 0–3.5 on rebase: `enable()` as a hold with
  a release (it and this adapter can now coexist), `at`/`inputDelayMs` for the INP
  join, the timeline records, and source names in `ownerPath`. One caveat
  for its brief: its diagnostics fingerprint is `[code, ...ownerPath]`, and
  the renamed internal nodes (`computed` → `children`, `effect` →
  `span.textContent`) regroup existing issues once on upgrade.
- **D1** (interaction stays open across the handler's returned promise) is
  still the responsiveness plan's to decide; the adapter is D1-agnostic (the
  settle span is `at → at + settledMs`). Cheaper to settle before Sentry
  resumes than after.
- **`@solidjs/vite-plugin`** (`source-names` branch): `componentNames` →
  `sourceNames`, the primitives pass ahead of the JSX transform and alone on
  `.ts`/`.js` ids, `solid.sourceNames` per-kind overrides. Lockstep with the
  compiler release carrying `sourceNames` — the compiler rejects unknown
  options, so the plugin's `@solidjs/compiler` range must move with it.

## Stage 5 (deferred): server spans in the browser panel

Ride the existing `Server-Timing` carrier (`packages/web/src/trace.ts`,
`appendTraceServerTiming`) rather than a custom debug chunk: in dev/observe,
append `dur=` metrics per `invocation` and `boundary` to the document and
server-function responses. Chrome renders `Server-Timing` in the Network
track's request details with no client code, and the adapter can read them
via `PerformanceResourceTiming.serverTiming` and draw them on the `Server`
track beside the matching `call`, joined by function `id`. Server waterfall
/ N+1 per request stays a consumer-side join over `invocation`/`boundary`
records (responsiveness item 5b). Not part of this delivery; the record
shapes stay serializable and the header stays the one carrier.

## Where Solid beats React

- Runs in production observe builds, not only dev/profiling.
- Every span answers "why": the cause chain to the root write, deps
  added/removed, provable waste (`changed: false`) instead of prop-diff
  heuristics — and the Propagation track shows the graph the write
  travelled, node by node.
- Holds are first-class with acknowledgement verdicts (silent vs
  acknowledged) and INP-aligned interaction settle spans; navigations named
  by route; async flights and fallbacks as spans plus findings.
- Interaction → server call → hold → effect chain links by origin identity,
  not by time.
- Spans are the actual DOM-updating effects and memos, not whole-component
  re-renders.
