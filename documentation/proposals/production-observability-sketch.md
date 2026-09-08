# SKETCH: Production observability on the attribution substrate

Status: SKETCH ONLY. Nothing here is implemented. Drafted 2026-09-06 to give a
concrete shape to the "observability-vendor consumption" track that
`documentation/plans/agent-diagnostics-plan.md` deliberately keeps separate
from `@solidjs/diagnostics`. The intended first external consumer is Sentry;
the design must not depend on that.

Related work this builds on (all dev-only today):

- `next`: `packages/signals/src/core/attribution.ts` (engine),
  `attribution-hooks.ts` (the core's hook surface), `dev.ts`
  (`DEV.diagnostics`, `DiagnosticEvent`), `packages/diagnostics/` (artifact,
  budgets, assertions).
- `diagnostics-expansion` branch (in flight, not yet on `next`): write
  provenance (`ChangeOrigin`, `InteractionRef`, `withInteraction`), transition
  holds (`HoldEvent`, `SILENT_HOLD`), `feedback()` tables
  (`FeedbackSource`, `FeedbackInteraction`), `ownerPath` on every event.
  Types referenced below are that branch's; expect drift until it lands.

---

## 1. The claim

Every vendor framework integration today is lifecycle-shaped: React
`ui.react.mount/render/update`, Vue `ui.vue.mount/update`, Svelte
`ui.svelte.init/update`, Angular `ui.angular.init`. Plus framework-agnostic
INP attribution via Long Animation Frames ("this script blocked N ms"). The
ceiling is _which component / which script_. None of it can say _why_, whether
the work changed anything, or what the user did to pay for it.

Solid's runtime is the dependency graph, so the attribution engine reads
causality off structure rather than inferring it:

- **Per re-run**: cause chain down to the root write, self/total time,
  `changed: false` (waste), dependency delta, posture (plain / transition /
  optimistic) so speculative work is never blamed.
- **Per root write**: provenance — `click on button#next "Next →"`, `effect
"syncTitle"`, `action "save"`, an async landing, or `external` — with nested
  frames inheriting the interaction.
- **Per hold**: a write parked behind async, measured from the user's event,
  with a _proof_ of whether the screen acknowledged it (`acknowledgedBy`,
  `paintedDuringHold`). `SILENT_HOLD` is a responsiveness verdict no RUM tool
  has.
- **Verdicts with prescribed repairs**: `ASYNC_WATERFALL` (graph-proven
  sequential flights), `WIDE_WRITE`, `HOT_SCOPE_FANOUT`, `UNSTABLE_MEMO_OUTPUT`,
  `WIDE_SCOPE_DEPS`, `SILENT_HOLD` — stable codes, `ownerPath`, and message
  text that names the fix.

The narrative: **observability that explains, not measures.** One vocabulary
from the dev console, to CI budgets (`@solidjs/diagnostics`), to a production
issue — the same code, the same repair text.

This doc is about the third leg: what it takes to get these facts out of a
production build and into a vendor, without coupling the runtime to any vendor.
§3.0 measures how much of the wiring is shared between dev and prod; §9 covers
the server side (where the vendor gap is server actions and streaming
boundaries); §10 catalogs new diagnostics the exercise surfaced, tagged by
whether they need dev checks or ride the observe wiring.

---

## 2. Hard constraints (from the code as it stands)

1. **Everything is dev-gated.** `DEV` is `undefined` in `dist/prod`
   (`packages/signals/src/core/dev.ts`); `attrHooks` call sites sit behind
   `__DEV__` and fold out of prod, verified byte-identical by the size
   scenarios (`scripts/size/.size-limit.js`). `@solidjs/web`'s interaction
   wrapping at the two dispatch sites is behind `"_SOLID_DEV_"`.
   `captureArtifact` throws on a prod build by design.
2. **Bundle size is budgeted and ratcheted.** Any prod-resident byte needs an
   audit note. The established win is relocation into pay-for-use modules,
   not golf (`signals.mdc`).
3. **Hook calls may not sit inside `try`** (rollup `tryCatchDeoptimization`
   re-couples the engine into prod — `attribution-hooks.ts` header, #2883).
   Any new prod-facing site inherits this rule.
4. **Names are the weak link.** Chains and `ownerPath` are only as good as
   `_name` population; the plan already flags compiler name emission as a
   pre-P3 risk. Prod adds minification on top. Internal fields are mangled
   (`scripts/mangle-props.mjs`).
5. **Vendor-neutral by policy.** The plan: "Event/wire formats are
   vendor-neutral (OTel-shaped where spans make sense). Observability-vendor
   consumption is a separate track and must not appear in this package."
   `attribution.ts` states the pattern: _one mechanism, N front-ends_ — a
   vendor SDK is one more implementer of `AttributionHooks` / subscriber to
   the event feeds, never a fork of the engine.

---

## 3. Where the facts can leave the process

### 3.0 How much wiring is shared (measured 2026-09-06)

The runtime gate already exists: `attrHooks` is `null` until `enable()`
installs an engine, and every core site is the same one-liner,
`if (__DEV__ && attrHooks !== null) attrHooks.x(...)`. So dev and any prod
observability share **100% of the hook surface**; the only question is whether
the sites survive the build. The surface is small and well-delineated:

- **Core hook sites (`@solidjs/signals`)**: 16 on `next` (`core.ts` 8,
  `async.ts` 6, `store.ts` 2); **29 on `diagnostics-expansion`** (adds
  `scheduler.ts` 6 — holds/settle/merge, `action.ts` 4 — step start/end,
  `effect.ts` 3 — effect run start/end). All outside `try` per the #2883 rule.
- **Names**: 5 `_name` assignment sites (`core.ts` ×4, `store.ts` ×1) —
  needed for anything to be legible.
- **Edge counters**: 2 sites (`graph.ts` `noteGraphLink` / `unnoteGraphLink`)
  maintaining `_subCount`/`_depCount` — needed by `WIDE_WRITE` and the
  always-on fan-out warnings.
- **Web runtime (`@solidjs/web`)**: 3 `withInteraction` wrap sites
  (`attachDelegatedEvent`, and the two `addEvent` branches) behind
  `"_SOLID_DEV_"`.
- **Component labels (`solid-js`)**: 1 site (`client/core.ts` sets
  `owner._name = "<Name>"`), the source of `ownerPath`.

Total: **~40 sites** that constitute the observability wiring. Contrast with
the **~140 `__DEV__` sites** in signals (`core.ts` 31, `scheduler.ts` 19,
`signals.ts` 15, `async.ts` 10, `effect.ts` 10, …) — the rest are dev
_checks_ (strict reads, owner-scope writes, invariants, forbidden scopes,
console reporting) that prod observability does not need and must not ship.

So the split is not "dev vs prod"; it is **wiring vs checks**. Today both
hide behind one flag (`__DEV__`). Separating them is a two-flag change
(`__DEV__` for checks, a second flag for wiring) touching ~40 lines, not an
architecture change.

Size estimate for keeping the wiring in a bundle (to be measured, not
trusted): each site minifies to roughly `X!==null&&X.f(a,b)` — ~25–40 bytes
pre-compression; 29 sites + 5 name writes + 2 counter calls ≈ 1–1.5 KB
minified, plausibly **300–500 bytes brotli** given how compressible the
repeated shape is. Plus one string field per node (`_name`) at runtime. Small,
but not zero, and the prod cap is ratcheted for a reason.

### 3.1 Gating strategies

Three ways to decide whether the ~40 sites exist in what an app runs:

**(i) Compile-time constant, separate published build** (`__OBSERVE__`
replaced by rollup like `__DEV__` today; export condition selects it). Default
`dist/prod` stays byte-identical. Cost: one more build flavor to maintain and
size-track; apps must opt in at the bundler.

**(ii) Runtime gate only, single build** — the sites ship in `dist/prod`
guarded by the existing `attrHooks !== null` check; `enable()` installs the
engine (lazily imported so unobserving apps never load `attribution.ts`).
This is the "enable call with a gating global" shape. No opt-in friction; but
tree-shaking cannot remove a runtime check, so every app pays the bytes above
and the #2883 "prod folds every site out" invariant is abandoned.

**(iii) App-defined constant, single build** — ship the sites guarded by an
_unreplaced_ global (`__SOLID_OBSERVE__`) that the app's bundler `define`s,
the way `process.env.NODE_ENV` worked for React. Folds out when the app
defines it `false`; present when `true`. Problems: an app with no `define`
gets a `ReferenceError` unless every site is `typeof __SOLID_OBSERVE__ !==
"undefined" && ...`, which no longer folds without the define and costs a
`typeof` per site; and it moves a library build decision into every app's
bundler config, which is the failure mode export conditions were adopted to
avoid.

**Verdict:** (i) unless measurement shows (ii) is noise. (iii) is not
recommended. Rationale beyond bytes: (i) keeps the checks/wiring split
explicit in the build matrix and lets the observe flavor grow (e.g. keep
`ownerPath` labeling, keep `reportDiagnostic` for a console fallback) without
re-litigating the prod cap each time. If (ii) is ever chosen, the runtime
gate is already there — nothing about the engine changes; only the flag on
the sites.

### Option A — Instrumented production build (recommended starting point)

A third build flavor alongside `dist/dev` and `dist/prod`: `dist/profiling`
(name TBD; React's `react-dom/profiling` is the precedent users already know).

- `__DEV__: false` (no strict-read checks, no owner-scope errors, no
  invariants, no console reporting) but a new `__OBSERVE__: true` flag that
  keeps exactly: the `attrHooks` call sites, `noteGraphLink`/`unnoteGraphLink`
  counters (needed by `WIDE_WRITE`), the `_name` field, and `emitDiagnostic`
  with `DiagnosticEvent` typing. The engine itself (`attribution.ts`) stays
  pay-for-use: not loaded unless a consumer calls `enable()`.
- `@solidjs/web` mirrors it: the `withInteraction` wrappers at
  `attachDelegatedEvent` and `addEvent` gate on `__OBSERVE__ || _SOLID_DEV_`.
- Resolved by an export condition (`"profiling"` / `"observe"`), the same
  mechanism that already selects `development` vs `default`. Vite/Vinxi
  config opts in; the default prod build is untouched and stays byte-identical
  to today.
- Size: the observe build gets its own size-limit scenario and its own cap.
  The regular prod cap does not move. This is the whole point of the flavor.

Cost when enabled is the engine's real cost (frames per recompute, cause
collection, dep snapshots). That is why sampling is the prod posture (§5),
not "always on."

### Option B — Promote the hook sites into the base prod build

Strategy (ii) above. Simplest for consumers (no build opt-in), but every
Solid app pays the bytes and the checks, and the "prod folds every site out"
invariant that #2883 fought for is abandoned. Ruled out for a first cut;
revisit only if A proves the demand and the measured cost is noise. The
measurement is cheap: a scratch worktree that swaps `__DEV__` for a second
flag on the ~40 wiring sites and runs `scripts/size/` against both flavors.

### Option C — No runtime change; vendor consumes `DEV` in dev only

What exists today. Useful for the "dev console → Sentry local issues" demo but
does not touch production and so does not deliver the claim. Listed for
completeness.

---

## 4. The wire: vendor-neutral event shapes

Three feeds already exist as in-process subscriptions. The proposal is to
define serializable projections of each and let a vendor adapter translate
them. Shapes below are projections of the branch's types, not new concepts.

### 4.1 Interaction span (from `FeedbackInteraction` + `HoldEvent`)

The unit Sentry's INP module and Web Vitals UI already reason about. One span
per dispatch, children as below.

```
name:        "click on button#next \"Next →\""      // InteractionRef type+target
op:          "ui.solid.interaction"
start/end:   InteractionRef.at → last effect that traces back to it
attributes:
  solid.interaction.type       "click"
  solid.interaction.target     "button#next \"Next →\""
  solid.runs                   340        // re-runs caused, synchronous
  solid.self_ms                22.4       // summed self-time of those runs
  solid.wasted_ms              21.9       // runs whose value did not change
  solid.held_ms                712        // time its writes sat behind async
  solid.silent_ms              712        // held with no acknowledgment
  solid.owner_path             ["<App>", "<Pager>"]   // of the handler's owner
children:
  op "ui.solid.hold"           one per HoldEvent (see 4.2)
  op "ui.solid.rerun"          only for runs above a per-span threshold
                               (selfMs ≥ N or changed === false ∧ selfMs ≥ M);
                               never every run — that is the noise vendors
                               already tell React users to turn off.
```

The two INP failure modes are two attribute groups on one span: long flush
(`runs`/`self_ms`/`wasted_ms`) and silent wait (`held_ms`/`silent_ms`). This
is the row `feedback().interactions` already computes; the span is its
per-dispatch form.

### 4.2 Hold span (from `HoldEvent`)

```
name:        "held: page (1 → 2) on posts"
op:          "ui.solid.hold"
start/end:   interaction.at (or first parked flush) → transition completion
attributes:
  solid.hold.writes            [{ name: "page", prev: "1", value: "2" }]
  solid.hold.blockers          ["posts"]
  solid.hold.acknowledged_by   ["isPending:posts"]   // [] = silent
  solid.hold.painted           0                     // paintedDuringHold
  solid.hold.action            false
  solid.hold.flushes           3
```

### 4.3 Finding (from `DiagnosticEvent`)

A finding is an _issue_, not a span: it has a stable identity and recurs.

```
code:         "SILENT_HOLD"                // DiagnosticCode — the fingerprint root
kind:         "responsiveness"
severity:     "warn"
message:      "...the repair text as emitted..."
owner_path:   ["<App>", "<Pager>", "effect"]
node_name:    "page"
data:         { ...code-specific structured fields, already on the event }
interaction:  ChangeOrigin | undefined      // when the finding traces to one
```

Fingerprint: `code + ownerPath.join("›") + nodeName`. That groups every
occurrence of "the pager holds silently" into one issue regardless of session
or minified identifiers, which is exactly what vendors' issue grouping wants
and what LoAF script attribution cannot give.

Severity mapping is the engine's own tiering: `info` never becomes an issue
(advisory only; depth-2 waterfalls, sub-`warnMs` holds); `warn` opens a
performance issue; `error` codes are dev-only and do not exist in the observe
build.

### 4.4 Rerun record (from `RerunEvent`)

Serialized as `Omit<RerunEvent, "node">` — `@solidjs/diagnostics` already
defines exactly this projection (`RerunRecord`). Attached to the interaction
span only above thresholds (4.1); otherwise folded into the span's aggregates.

### 4.5 Cause chain (from `ChangeRecord`)

Kept as a nested structure on the finding/rerun (`causes[]` with
`origin`), depth-capped at the engine's 10. The `prev`/`value` previews are
the PII surface — see §6.

---

## 5. Sampling and cost posture

- **Per-session enable/disable**, decided by the consumer: the adapter calls
  `attribution.enable({ log: false, ... })` for the sampled fraction and never
  touches it otherwise. Unsampled sessions pay one null check per site. This
  maps 1:1 onto `tracesSampleRate` / `interactionsSampleRate` on the vendor
  side.
- **Per-interaction cost cap**: the adapter drops rerun children above a
  count and keeps aggregates. Findings are never dropped (they are rare and
  already deduped once-per-node by the engine).
- **Thresholds are the engine's** (`hotRuns`, `hotTime`, `wideWrites`,
  `holds: { infoMs, warnMs }`, `waterfalls.minFlightMs`). The adapter may
  raise them for prod; it must not lower them below dev defaults, or prod
  reports things dev never showed the developer.
- **Stacks stay off** (`stacks: false`) in prod. `ownerPath` is the
  location; stacks are the dev affordance.

Overhead measurement is part of the deliverable, not an afterthought: the
observe build needs a benchmark scenario with the engine enabled (frames,
cause collection, dep snapshots) so the "sampled fraction" recommendation is
a number, not a vibe.

---

## 6. Names and PII

**Names.** Three sources, in order of preference: the `name` option on
primitives, `store.path` (automatic while the engine is active), and the
`<ComponentName>` labels the dev component wrapper puts on owner roots. In the
observe build the component wrapper must keep labeling (today it is dev-only);
the compiler must emit `name` for user memos/effects/signals it can see (open
pre-P3 item in the plan). Minification: `name` values are string literals
and survive; the _component function_ name does not unless the wrapper
captures it at definition time — which is what the label does. If that is not
enough, the answer is a name map emitted at build time, which is the same
shape as source maps and vendor component-annotate plugins; do not invent a
second mechanism.

**PII.** Two fields carry user data: `ChangeRecord.prev/value` (and
`HeldWrite.prev/value`) previews, and `InteractionRef.target` text content
(`describeEventTarget` includes up to 30 chars of `textContent`). Posture:

- The engine keeps producing them (they are what makes dev output readable).
- The _adapter_ owns scrubbing, with a documented default: previews of
  strings are dropped or hashed unless the consumer opts in; numbers,
  booleans, and type/length previews (`Array(12)`, `[Object]`) pass. Target
  text is kept for `button`/`a` (labels), dropped for anything else.
- Vendors already have this control surface (`dataCollection`,
  `beforeSend`); the adapter plugs into it rather than duplicating it.

---

## 7. The adapter contract (vendor side)

What a vendor package (`@sentry/solid` or anyone) implements. Deliberately
small; everything else is the engine's.

```ts
interface ObservabilityAdapter {
  // Called by the app at startup on an observe build, after the vendor SDK
  // is initialized. Decides sampling, calls attribution.enable/disable.
  install(dev: Dev, opts: { sample: () => boolean }): () => void;
}
```

Inside `install`, the adapter subscribes to the three feeds:

- `dev.attribution.subscribe(rerun => ...)` — aggregate into the current
  interaction span (keyed by `rerun.interaction`), emit rerun children above
  thresholds.
- `dev.diagnostics.subscribe(event => ...)` — `warn` → finding (4.3).
- Holds: today only via `dev.attribution.holds()` polling; a `holdEnd`
  subscription (`subscribeHolds`) is a small engine addition and should be
  made before the first adapter exists rather than after.

Interaction boundaries: the web runtime's `withInteraction` already brackets
dispatch. The adapter does not wrap events itself — doing so would double-count
and would miss the branch's inheritance rules (post-`yield` action steps,
caused effects, launched flights all carry the interaction). It reads
`RerunEvent.interaction` / `HoldEvent.interaction` and groups.

Anything the adapter needs that isn't on those feeds is an engine gap to
fix once, for every consumer — not something to compute vendor-side.

---

## 8. What is Solid's to build vs. the vendor's

Solid (this repo):

0. **Server dev build first** — `documentation/plans/server-dev-build-plan.md`.
   There is no server dev build today: `solid-js`'s server entry has no
   `_SOLID_DEV_` replace and fires its warnings unconditionally in prod;
   `@solidjs/web`'s server entry has 26 dev gates that are stripped in the
   only artifact that ships. Every server item below needs a dev channel to
   exist before a prod one can.
1. Observe build flavor + export condition for `@solidjs/signals`, `solid-js`,
   `@solidjs/web` (§3A). Size scenario and cap for it.
2. `subscribeHolds` on the engine; confirm every feed is subscribable, not
   poll-only.
3. Component-root labeling in the observe build; compiler `name` emission for
   user primitives (already a plan item).
4. Serializable projections as exported types (`RerunRecord` exists in
   `@solidjs/diagnostics`; the finding/hold/interaction projections should
   live next to it — the plan already says protocol types publish from
   there).
5. An enabled-engine overhead benchmark.
6. A reference adapter that writes JSONL / OTel spans to stdout — proves the
   contract with zero vendor code and doubles as the test fixture.
7. Server side (§9.4): trace context on the request event + `Server-Timing`
   emission; default `wrapInvocation` span for server functions; boundary
   spans on streaming SSR; a server-side `emitDiagnostic` channel so the
   §10.2/10.3 findings have somewhere to go.
8. The dev-only codes in §10 that pay off before any observe build exists
   (§12 last bullet).

Vendor (e.g. `@sentry/solid`):

1. `install()` per §7, sampling wired to their rates.
2. Span/issue mapping per §4, fingerprinting on `code + ownerPath + nodeName`.
3. Scrubbing defaults per §6 hooked into their existing data-collection
   controls.
4. Product side: new performance-issue detectors for `SILENT_HOLD`,
   `ASYNC_WATERFALL`, `HOT_SCOPE_FANOUT`, `WIDE_WRITE` with the engine's
   repair text as the "how to fix" body; per-interaction cost/hold rows in the
   INP/Web Vitals view. Their autofix/agent surface can consume the
   `reactivity-diagnostics` skill directly — the repairs are already written
   for an agent.

---

## 9. Server side

### 9.1 What vendors offer today

- **Request-level auto-instrumentation** for meta-frameworks: SvelteKit
  `load` + `handle`, Nuxt server routes, Remix loaders, Next.js API routes and
  Server Components. One span per request; child spans for outgoing fetch/DB
  via OTel auto-instrumentation.
- **Distributed tracing** across the SSR boundary by header: `sentry-trace` +
  `baggage` (optionally W3C `traceparent`) in on requests; out to the browser
  via `<meta>` tags in the HTML or the `Server-Timing` header (Remix moved to
  `Server-Timing` in 10.45; Vercel's CDN stopped stripping `Server-Timing` on
  2026-08-10; Grafana Faro reads `traceparent;desc=` from it). The browser SDK
  parents its `pageload` span under the server transaction.
- **Server actions are the acknowledged gap.** Next.js server actions emit no
  OTel span; Sentry requires manual `withServerActionInstrumentation(name,
{ headers, formData })` per action and has said auto-instrumentation would
  need a Turbopack-level transform they will not build. Unwrapped actions show
  up as anonymous POSTs with no trace continuity.
- **Framework-native server diagnostics**: React 19.2 Performance Tracks add
  "Server Components" and "Server Requests" lanes in Chrome DevTools — dev
  builds only, not in profiling builds, visual only (no verdicts). Waterfall
  detection is "look for the stair-step."
- **Server-side performance-issue detectors** (Sentry): N+1 DB queries,
  consecutive DB queries, slow DB query, endpoint/function regressions. All
  span-arrangement heuristics over the trace; none know what a streaming SSR
  boundary is.

### 9.2 What Solid's server runtime already exposes

Verified against `next` (file:line as of 2026-09-06):

- **Request context**: `provideRequestEvent` (`@solidjs/web/storage`,
  `storage/src/index.ts:34`) on `AsyncLocalStorage`; `getRequestEvent()` /
  `peekRequestEvent()` (`server.ts:4510–4537`); augmentable
  `RequestEventLocals` (`server.ts:257`) — the natural carrier for a trace id.
  **No trace id or header propagation exists today.**
- **Server functions** (`server-functions/src/server.ts`): a config-level
  `wrapInvocation` hook (`:272`, `:469`) around every invocation with
  `{ id, args, event, request?, direct }` — direct SSR calls share it with
  `direct: true`. Plus `transformResult`, `collectFlightData`, CSRF, codec.
  Per-call identity is the _function id_, not a request/trace id. This is the
  seam that makes server-function spans automatic, where Next.js needs manual
  wrapping: the runtime owns dispatch, decode, invoke, encode.
- **Streaming SSR** (`server.ts`): `onError` (`:1449`, `:1656–1660`),
  `onCompleteShell` (`:2359`), `onCompleteAll` (`:1768`); sink methods
  `shell/fragment/reveal/data/asset` are single call sites for boundary
  flush/reveal; `context.hold()` for live work keeping the response open;
  fragment registry with `abandonSubtree` on errored fragments (`:1958`).
- **HTTP head**: `StatusLedger` / header ledgers (`index.server.ts:247–379`)
  with declare/retract semantics until commit; late header write after the
  head flushed is a dev throw / prod `console.error` + no-op
  (`server.ts:4588–4594`, #2982); header value cap
  `RESPONSE_HEADER_VALUE_LIMIT = 4096` (`response.ts:149`).
- **Server reactive facade** (`packages/solid/src/server/`): per-`Loading`
  boundary discovery → await → settle/reveal (`hydration.ts:176–317`);
  `[SERVER_WRITE]` once-per-category warnings for signal/store/optimistic
  writes on the server (`signals.ts:677–696`). **No exported waiting-count or
  per-boundary timing.**
- **Frames** (`packages/web/frames/`): `renderToFrameStream` /
  `renderServerComponent` wrap `renderToStream` (inherit `onError`, shell,
  settle); client applies records and runs marker-integrity checks in dev
  (`frame-client.ts:2469` `devCheckRange` — missing end markers, CDN/minifier
  stripped comments).
- **Hydration** (`packages/web/src/client.ts`): mismatch throw (`:1787`),
  tag/structure warnings (`:1795–1870`), orphaned nodes (`:1716`), preload
  failure → client fallback (`:1763`), `createElement`-during-hydration
  (`:278`). Asset gate `$dfc` releases on load _or_ error with no timeout
  (`:1062`). Multi-root pending-boundary registry (`solid/client/hydration.ts`
  `:204–258`, #2917). **No time-to-hydrate measurement.**

### 9.3 Detected internally, not surfaced

Failure modes the server runtime already handles but reports nowhere
structured — each is a candidate finding (§10):

- `await renderToStream(...)` **never rejects**; render errors go to
  `onError` and the promise still resolves HTML (`server.ts:1579–1584`).
- Stream **disconnect/abandon** → silent wind-down (`:1634–1644`,
  `:1698–1714`).
- `abandonSubtree`: descendants resolve with `undefined` data so the client
  re-renders — no signal that a subtree was abandoned or why (`:1950–1970`).
- Seroval **post-flush writes silently dropped** (`:1893–1919`).
- Server-function encode failure after head commit → in-band error trailer,
  status unchanged (`server-functions/src/server.ts:2759–2786`); prod
  **sanitizes plain throws** (message lost unless the app maps it in
  `wrapInvocation`).
- Late header write in prod: `console.error` + dropped header — the response
  went out wrong and nothing records it.

### 9.4 What to build server-side

Ordered by leverage:

1. **Trace id on the request event.** Read `traceparent` (W3C) and, if
   present, `sentry-trace`/`baggage` in `provideRequestEvent` or a tiny
   `@solidjs/web/storage` helper; stash on `event.locals`; expose
   `getTraceContext()`. Emit it out via `Server-Timing:
traceparent;desc="00-…"` at head commit (`commitResponseStub` /
   `createSSRResponse`) — the header, not a `<meta>` tag, because frames and
   server-function responses have no `<head>`. This is the one piece that
   turns every span below into one trace with the browser's interaction span
   (§4.1 gains `trace_id`).
2. **Server-function spans for free.** A default `wrapInvocation` in the
   observe build that opens a span `rpc.solid.server_function` named by
   function id, tagged `direct`, with decode/invoke/encode phases as
   attributes, and links to the incoming trace. Errors captured with the
   _unsanitized_ message on the server side (sanitization is for the wire, not
   for telemetry). This is the "Next.js can't, Solid does" headline.
3. **Boundary spans on streaming SSR.** One span per `Loading` boundary from
   discovery to reveal (`hydration.ts` settle → sink `reveal`), attributes:
   depth, number of async sources awaited, bytes flushed, whether it was
   shell or streamed. Server-side waterfalls become visible as nested boundary
   spans whose _starts_ are serialized — the same `ASYNC_WATERFALL` verdict
   the client engine already makes, run over server flights (see §10).
4. **Response head facts**: at commit, record status, header count, whether
   any declaration was retracted, and any _late_ declaration as a finding
   (`LATE_HEADER_WRITE`, §10) instead of a `console.error`.
5. **Frame lifecycle spans**: produce (`renderToFrameStream` → settle) on the
   server; apply/bind/dispose on the client, parented to the interaction that
   requested the frame. Marker-integrity failures become findings with the
   frame id and the stripped marker, so "the CDN rewrote our HTML" is an issue
   with a fingerprint, not a support ticket.
6. **Hydration timing**: `render()`/`hydrate()` start → last pending boundary
   hydrated (the #2917 registry already tracks the count) as a client span
   parented to `pageload`, attributes: roots, boundaries, mismatch findings.

---

## 10. Diagnostics catalog: additions surfaced by this exercise

Vocabulary: **dev** = check that needs `__DEV__` (throws/warns, may be
expensive, may be wrong in prod); **wiring** = fact the observe build can
carry with the ~40-site surface (§3.0) plus the server hooks in §9.2;
**prod verdict** = engine-side verdict computable from wiring alone. Codes
are proposals; thresholds follow the engine's tiering (`info` advisory,
`warn` issue).

### 10.1 Client / reactive

- `INTERACTION_LONG_FLUSH` — _prod verdict, new._ One dispatch's synchronous
  re-run self-time exceeded a budget (default 50ms — the INP long-task bar).
  The engine already computes `worstDispatchMs` per interaction; this is the
  thresholded verdict over it, the client-side twin of `SILENT_HOLD`. Message
  names the interaction, the top three scopes by self-time, and the
  `wastedMs` share. Repair text points to `costs()`.
- `INTERACTION_NO_EFFECT` — _prod verdict, new._ A user interaction performed
  root writes and caused **zero** effect runs and no hold: every write was
  equality-swallowed or wrote to nothing observed. Not necessarily a bug
  (idempotent toggles), so `info`. But repeated dispatches with no effect are
  the rage-click precursor Sentry currently detects only from replay after the
  fact; the graph sees it at the first click.
- `HOLD_LATEST_ONLY` — _prod verdict, promote from data._ `feedback()`
  already tracks `latestOnly` (input showed, nothing said loading). Above
  `warnMs` this deserves its own code rather than hiding in a table: the fix
  is different from `SILENT_HOLD` (add `isPending`, not `latest`).
- `EFFECT_WRITE_CASCADE` — _dev check + prod verdict, new._ A write whose
  `origin.kind === "effect"` caused a re-run of the effect that made it
  (self-loop through the graph) or a chain of ≥3 effect-origin writes in one
  flush. The provenance branch makes this cheap to detect; today it surfaces
  only as the 100k-iteration infinite-loop throw.
- `ACTION_ESCAPED_TRANSACTION` — _dev check, new._ A write with
  `origin.kind === "external"` whose enclosing frame is an action iterator's
  microtask continuation — the documented `await`-not-`yield` escape. The
  branch already classifies these as `external`; naming them is the missing
  step. Message: "write to X inside action Y ran after an `await`; use
  `yield` to re-enter the transaction."
- `STALE_OPTIMISTIC` — _prod verdict, new._ An optimistic value stayed
  visible longer than a budget (default 10s) because its action neither
  settled nor failed. Rides on `holdStart`/`transitionSettled` + the action
  step hooks. This is the "stuck spinner" class no vendor sees as anything but
  an eventual rage click.
- `ORPHANED_HOLD` — _prod verdict, new._ A transition held writes, then was
  disposed (owner unmounted) before settling — the user navigated away
  waiting. `holdStart` without `transitionSettled`/`transitionMerged` before
  disposal. Attribute: `holdMs` at abandonment. Feeds "how long do users
  wait before giving up" without a session-replay product.

### 10.2 Server / SSR

- `SSR_BOUNDARY_WATERFALL` — _prod verdict, new._ The client engine's
  `ASYNC_WATERFALL` logic (causal chain + origin post-dates upstream landing +
  duration gate) applied to server flights within one request. Server flights
  are already per-boundary awaits (`hydration.ts:176–317`); the server facade
  needs `flightStart`/`asyncEnd`-equivalent hooks. This is exactly what
  React's Server Requests track shows visually and does not judge.
- `SSR_RENDER_ERROR_CONTAINED` — _wiring, new._ `onError` fired and the
  response still completed (the `renderToStream` never-rejects contract).
  Today the app learns this only if it wired `onError` itself; in the observe
  build it is a finding with `ownerPath` of the failed boundary and whether a
  fallback rendered or the subtree was abandoned.
- `SSR_SUBTREE_ABANDONED` — _wiring, new._ `abandonSubtree` ran: fragment id,
  descendant count, the error that caused it, and that the client will
  re-render from scratch (a cost the server just shifted to the user).
- `SSR_STREAM_ABANDONED` — _wiring, new._ Sink threw (client disconnected /
  proxy reset) mid-stream: bytes flushed, boundaries pending, hold count.
  Distinguishes "user left" from "we were slow" when aggregated with
  time-to-shell.
- `LATE_HEADER_WRITE` — _wiring, promote._ Already detected (`server.ts:4588`,
  #2982); today a dev throw / prod `console.error`. Becomes a finding with the
  header name and the `ownerPath` of the declaring scope. Prod behaviour
  (drop) unchanged.
- `HEADER_DECLARATION_RETRACTED` — _wiring, new, `info`._ A status/header
  declared in one scope was retracted before commit (the ledger's own
  semantics). Advisory: it is legal, but a retract-heavy request is usually a
  boundary doing HTTP work it shouldn't.
- `SERVER_FN_ERROR_SANITIZED` — _wiring, new._ A server function threw a
  plain error that prod sanitized before encoding. The telemetry side keeps
  the original message + stack (server-only), the wire keeps the sanitized
  form. Closes the "prod errors are opaque" gap without weakening the wire.
- `SERVER_FN_LATE_FAILURE` — _wiring, new._ Encode failed after head commit
  → in-band error trailer with a 200 status. Vendors see a 200; the finding
  says it was a failure.
- `SERVER_FN_PAYLOAD_LARGE` — _prod verdict, new._ Encoded response or
  decoded args over a budget (default 256 KB). The runtime already sits at the
  encode/decode seam; Sentry has "Large HTTP Payload" for fetch but cannot
  attribute it to a function id.
- `SERIALIZATION_POST_FLUSH_DROPPED` — _wiring, promote._ Seroval writes
  after the stream closed are dropped silently (`server.ts:1893–1919`). Name
  the node and the boundary; this is data the client never got.
- `SERVER_WRITE` — _dev check, exists._ Keep; add `ownerPath` (it currently
  has none, so the offending component is unknown).

### 10.3 Hydration / frames

- `HYDRATION_MISMATCH` — _wiring, promote._ The throw at `client.ts:1787` and
  the tag/structure warnings at `:1795–1870` become one structured finding:
  expected/actual tag, `ownerPath`, marker id. Sentry's "Hydration Error"
  issue type is React-shaped and reconstructs the diff from replay because
  React gives it nothing structured; Solid can hand it the node.
- `HYDRATION_CLIENT_FALLBACK` — _wiring, promote._ Preload failure led to
  client render (`:1763`): the asset URL and boundary. This is the
  "hydration silently became CSR" event that currently shows only as a slower
  LCP.
- `HYDRATION_ROOT_TIMING` — _span, new._ Per §9.4.6: roots, boundaries,
  duration. Not a finding; the base measurement.
- `ASSET_GATE_STALLED` — _prod verdict, new._ `$dfc` gate not released within
  a budget (default 10s): stylesheet neither loaded nor errored. Today the
  boundary waits forever (`client.ts:1062`, no timeout). Attribute: href.
- `FRAME_MARKER_CORRUPTED` — _wiring, promote._ `devCheckRange` findings
  (`frame-client.ts:2469`) with frame id and which marker is missing;
  message already says "CDN/minifier/translator". In prod today the frame
  fails with no attribution.
- `FRAME_STALE_DISCARDED` — _wiring, new, `info`._ A frame version arrived
  after a newer one was applied and was discarded. Legal, but a high rate is
  a request-ordering or caching problem.

### 10.4 Always-on dev, unrelated to prod

Surfaced while reading, worth adding to the dev catalog regardless of the
observe track:

- `ASYNC_OUTSIDE_LOADING_BOUNDARY` on the server — the client warns; the
  server facade's equivalent (`ssrSource: "client"` outside `<Loading>`,
  `signals.ts:519`) is a bare `console.warn` with no code.
- `LAZY_ASSET_UNMAPPED` — the dev messages at `server.ts:~548` and
  `component.ts:123/284–298/380` about lazy modules missing from the asset
  map / missing `$$moduleUrl` are three message texts for one condition.
- Frames/server `console.warn` sites generally: every one should route
  through `emitDiagnostic` so `@solidjs/diagnostics` budgets can see them.
  `emitDiagnostic` does not exist on the server side today (§9.2); the
  server facade needs the same `DiagnosticEvent` channel, dev-gated the same
  way.

---

## 11. What this is not

- Not component tracking. Solid components run once; mount/update spans
  would be empty or wrong, and vendors already tell React users to disable
  update spans for noise. The unit is the interaction, not the component.
- Not a devtools GUI. Same substrate, separate front-end (plan non-goal).
- Not a change to `dist/prod`. Option A leaves the default production bundle
  byte-identical; opting in is a build decision, like source maps.
- Not vendor-specific. The Sentry mapping in §4/§8 is worked as the first
  consumer because that is where the access is; the shapes are OTel-ish
  spans and structured findings that any backend can take.

---

## 12. Open questions

- **Build posture decision (§3.1)**: separate observe flavor (i) vs. wiring in
  base prod (ii). Blocked on one measurement: brotli delta of the ~40 wiring
  sites in a scratch worktree. If it is under ~300 bytes the argument for (i)
  is purely the #2883 invariant and build-matrix hygiene; if it is over ~1 KB
  the argument is closed.
- Flag/condition naming: `__OBSERVE__` / `"observe"` vs `"profiling"` (React
  familiarity) vs folding into `development` with the dev checks disabled by
  an option. The last is tempting but makes "prod" mean two things.
- Whether hold spans should nest under the interaction span or be siblings
  linked by id — depends on how the vendor's INP view attributes child time.
- **Server-side engine**: the server facade (`packages/solid/src/server/`) has
  no `emitDiagnostic`, no `attrHooks`, and no `DEV` object. §9.4 and §10.2
  assume a server-side hook surface shaped like the client's. Whether that is
  the same `attribution-hooks.ts` interface with a server engine, or a smaller
  request-scoped one, is undecided — the server has no re-runs, so most of
  `AttributionHooks` does not apply; flights, holds/settle per boundary, and
  writes do.
- **Trace header policy**: read `traceparent` only (W3C), or also
  `sentry-trace`/`baggage`? Reading vendor headers in the runtime is a
  coupling; the alternative is `provideRequestEvent` accepting a
  `traceContext` the host adapter extracted. Leaning: W3C in the runtime,
  vendor headers in the adapter.
- Whether the reference adapter (§8.6) lives in `@solidjs/diagnostics` or a
  new `@solidjs/observe`. Leaning diagnostics until a second consumer exists,
  mirroring the plan's extraction triggers.
- Which of the §10 codes are worth doing _before_ the observe build exists,
  as pure dev additions: `ACTION_ESCAPED_TRANSACTION`, `EFFECT_WRITE_CASCADE`,
  `INTERACTION_LONG_FLUSH`, server `emitDiagnostic` routing (§10.4) all pay
  off in dev alone.
