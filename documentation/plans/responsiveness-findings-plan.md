# Responsiveness Findings Plan — the facts worth emitting through the observe tier

_Drafted 2026-09-18. Status: BACKLOG, worked against RCs as time allows.
Successor to `observe-tier-plan.md` (the wiring, shipped in rc.9) and
`sentry-integration-plan.md` (the first consumer, `@sentry/solid-2`, in
review). Sibling of the **Chrome Performance Tracks** plan
(`chrome-performance-tracks-plan.md`, shipped through its Stage 4), which
owns the DevTools panel adapter and the engine records it needs; the two
meet at the points marked "↔ Tracks" below. Owner: Ryan._

## Why this list exists

The observe tier ships the channel; this is the backlog of things worth
putting on it. The shape of the list follows from one observation: a
component-rerendering framework's failure modes are about rendering too
much, so its tooling counts renders. Solid does not re-run components, and
its failure modes are about **waiting** — a write that landed behind async
work, and whether the screen said so. Everything below is in that family,
or is a consumer that shows the family to a developer where they already
look. Each item is something only a runtime that owns the write can say.

Every item carries the same four fields so it can be picked up alone:

- **Known** — the hook or record that already carries the fact, so nobody
  re-derives it.
- **Shape** — a finding (code, severity, fingerprint fields) or a record
  (type, fields). Findings are issues: stable identity, recur, counted.
- **Idle cost** — what the observe build pays when nothing subscribes.
  Several are one integer. Anything more than a field on an existing record
  needs a size-cap measurement before it lands (`scripts/size/`).
- **Proof** — the test, as a sentence.

Ordered by value per effort. Items 1 and 2 are the pair that turns an INP
number, which every tool reports, into a cause, which only this runtime can
report.

## Decide first

Two items change a contract; settle them before their code.

- **D1 — DECIDED (2026-09-22): yes, same record.** A thenable return keeps
  the `InteractionEvent` open until it settles (cap 10s); `settledMs` covers
  the wait and `continuationMs` names it; `outcome` is unchanged (writes in
  the continuation are not attributed — no frame). The finding is
  `UNTRACKED_ASYNC_HANDLER`, on the hold thresholds; an `action()` step or a
  write before the `await` clears it. `@sentry/solid-2`'s `after_settle`
  path is now dead and should go. Original question: (↔ Tracks: the Interactions track's settle span ends at
  `settledMs`; D1 lengthens it. Decide before Stage 1 of that plan ships a
  shape.) Today `withInteraction` closes the frame when the synchronous
  handler returns; `onClick={async () => set(await save())}` settles as
  `idle` at once and the wait the user experiences is invisible. Item 1
  proposes observing the returned promise. That changes `settledMs` and
  `outcome` for existing consumers: `@sentry/solid-2` currently parents a
  late `"call"` record under the ended interaction span and marks it
  `after_settle`; with D1 that path becomes dead and should be removed, not
  kept as a second route. Decide whether the continuation is the same
  record (one interaction, longer) or a second phase on it
  (`continuationMs`), and whether a handler that returns a promise which
  never settles caps the frame (a timeout) or leaves it open.
- **D2 — DECIDED by #3580:** `checks?: boolean` on `enable()` (default
  `true`), combined most-demanding across holds; a records-only consumer
  passes `checks: false`. Item 6 lands under that switch. Original question:
  `HOT_SCOPE_RERUNS`, `UNSTABLE_MEMO_OUTPUT` and the rest fire "only while
  attribution is enabled". Item 6 adds a production-shaped one. Decide
  whether enabling the engine implies the cost checks (today's behavior) or
  whether a production consumer opts into them (`enable({ costs: true })`),
  since a finding nobody subscribes to still pays for its accounting.

## Items

### 1. Close the `await` escape in interactions — LANDED

Shipped as `interactionEnd(returned)` + `InteractionEvent.continuationMs` +
`UNTRACKED_ASYNC_HANDLER` (see RFC 08). The finding requires _no_ write
before the await rather than "no acknowledged reader for what it wrote":
any pre-await write opens the hold path, which `SILENT_HOLD` judges.

- **Known:** `withInteraction(ref, fn)` in the web runtime's event dispatch
  opens the frame; the handler's return value is discarded. Writes after
  the first `await` carry no origin (the same escape `CallEvent.origin`
  documents: "read at dispatch").
- **Shape:** per D1, the interaction record keeps the frame open until the
  handler's returned promise settles; writes, holds and `"call"` records
  made in the continuation attribute to it. New finding
  `UNACKNOWLEDGED_ASYNC_HANDLER` (warn; fingerprint `ownerPath` of the
  handler's owner + `ref.type`): the handler awaited ≥ `holds.infoMs` with
  no `isPending`/`latest`/optimistic reader for anything it wrote, and no
  write at all before the await. This is the dead click that is not a hold.
- **Idle cost:** a `then` on the returned value when it is thenable; zero
  for a synchronous handler.
- **Proof:** a handler that awaits 300 ms then writes fires the finding
  once and its interaction record's `settledMs` covers the await; the same
  handler with `isPending(source)` read in JSX fires nothing.

### 2. Stamp the browser's `interactionId` on the interaction

- **Known:** the web runtime is inside the event dispatch when it opens
  the frame; Event Timing (`PerformanceEventTiming.interactionId`) assigns
  every user interaction an id, and INP is the worst of those entries.
- **Shape:** `InteractionRef.interactionId?: number`, carried onto
  `InteractionEvent`. No finding. A consumer joins the browser's INP entry
  (and its Long Animation Frame `scripts[]`) to the runtime's explanation
  — the held write, the blocker, the acknowledgement — by id rather than
  by time.
- **Idle cost:** one property read per dispatch where the API exists.
  Confirm the id is readable synchronously during dispatch (it is set on
  the `PerformanceEventTiming` entry, not the event; the join may need the
  entry's `target`/`startTime` instead — measure before promising the
  field). ↔ Tracks: that plan passes `at: e.timeStamp` into
  `dispatchAsInteraction` at the same call site; land the two stamps
  together.
- **Proof:** a click whose Event Timing entry reports 480 ms produces an
  interaction record with the same id and a hold that names the blocker.

### 3. Optimistic reverts

- **Known:** the optimistic lane knows the shown value and the settled
  value; `asyncEnd`'s `prev`/`value` and the lane commit see both.
- **Shape:** finding `OPTIMISTIC_REVERTED` (info; fingerprint source name):
  the value a `createOptimistic`/optimistic store showed differed from the
  value that settled — the user saw one thing, then another. `data` carries
  the source and the two previews (subject to the 40-char preview rule in
  RFC 08's PII section).
- **Idle cost:** one equality check at settle.
- **Proof:** an optimistic write of `"saved"` whose action settles to
  `"queued"` fires once; one that settles to `"saved"` fires nothing.

### 4. Promote the feedback-table facts to findings — LANDED

Shipped as `ABANDONED_FLIGHTS` (warn, per-source window in the engine),
`FALLBACK_FLASH` (info, per flash, judged at hide on the same display
clock the `fallback` record uses) and `STACKED_HOLDS` (warn, count over the
open interactions at hold settle), with `abandonedFlights`,
`fallbackFlashes` and `stackedHolds` options merged most-demanding like the
others. `FALLBACK_FLASH_MS` is exported and shared with the feedback fold.

- **Known:** `feedback()` already counts `flights.abandoned` (started and
  superseded before landing — the request-per-keystroke signature),
  `fallbacks.flashes` (a `<Loading>` fallback shown under 150 ms) and
  `interactions.heldMs`; the accounting exists. ↔ Tracks: Stage 2 of that
  plan promotes the same `flight`/`fallback` fold facts to public
  attribution records. These findings are the counted, fingerprinted form
  of those records; build them on the record shapes that plan defines
  rather than a second set.
- **Shape:** `ABANDONED_FLIGHTS` (warn; fingerprint source; fires when
  abandoned/started crosses a ratio over a window), `FALLBACK_FLASH` (info;
  fingerprint boundary `ownerPath`; fires per flash, counted), and
  `STACKED_HOLDS` (warn; fingerprint source; N ≥ 3 interactions queued
  behind one in-flight source). Thresholds live beside `holds`/`longHolds`
  in `AttributionOptions`.
- **Idle cost:** zero beyond the fold that already runs when `feedback` is
  imported; per D2, the findings should not force the fold on.
- **Proof:** five keystrokes into a search box that each start a fetch and
  abandon the previous fire `ABANDONED_FLIGHTS` once with `abandoned: 4`.

### 5. Server waterfall and N+1, per request

- **Known:** `"invocation"` records carry `boundary` (the `<Loading>` whose
  pass made a direct call), `id`, `at`, `durationMs`; `"boundary"` records
  carry `at`, `durationMs`, `passes`. Both are on `OBSERVE.records` today.
- **Shape:** two options. (a) Runtime findings `SSR_BOUNDARY_WATERFALL`
  (boundary B's first call began after boundary A settled, A nested in B's
  ancestry) and `SERVER_FUNCTION_FAN_OUT` (one boundary's pass made ≥ N
  calls to the same function id). (b) Leave it to consumers: the records
  suffice, and an adapter computing it per request keeps the runtime free
  of a per-request join table. Default to (b) and document the recipe in
  the adapter guide; revisit (a) if two consumers implement the same join.
- **Idle cost:** (b) zero.
- **Proof:** (b) a documented snippet against the records that names the
  boundary and the function; a test in `@solidjs/diagnostics` server
  scenario asserting the join.

### 6. Wasted recomputation, measured — LANDED

Shipped as `WASTED_RECOMPUTE` (warn, perf), the sixth cost check under
`checks`, with `wastedRecompute: { minRuns, ratio, budgetMs, windowMs }`
(defaults 5 / 0.8 / 2ms / 1000ms). Plain runs only; the per-scope window is
an engine `WeakMap`.

- **Known:** `ScopeCost.wastedMs` — time spent on runs whose result
  compared equal — is accumulated by the costs fold; `UNSTABLE_MEMO_OUTPUT`
  fires in dev on a memo returning a new-but-equal object.
- **Shape:** `WASTED_RECOMPUTE` (warn; fingerprint `ownerPath`): a scope
  whose runs over a window were ≥ 80% no-ops and cost ≥ N ms. The fix is
  implied by the cause: an equality boundary upstream or a narrower read.
  This is "why did this render" with a stopwatch, in production. Gated by
  D2. ↔ Tracks: that plan paints `changed: false` runs as `warning` on the
  Effects/Memos tracks; this is the same fact as an issue.
- **Idle cost:** the costs fold, when imported; nothing otherwise.
- **Proof:** a memo over a store object that is replaced with an equal
  copy on every tick fires once after the window; the same memo reading
  one property fires nothing.

### 7. Graph growth as a leak detector — LANDED (with a correction)

The plan said the core "keeps node and edge counters"; it does not — the
`HUGE_FAN_OUT`/`HUGE_FAN_IN` counts are per-walk locals, and there is no live
node count. Rather than add one (an increment at every creation and
disposal, on the idle observe path), the observe core registers the
top-level roots weakly (`WeakRef` + `FinalizationRegistry`, one Set write per
root) and the engine walks from them at navigation settle — the owner tree, then
the reactive graph it reaches through dependencies and subscriptions (which
is how an ownerless effect is found) — zero per-node cost, a walk at
navigation cadence: 10k owners in 0.6ms, 50k in 3.6ms. Shipped as the
`graph` attribution record (`GraphEvent`/`GraphSize`: `roots`, `owners`,
`computations`, `signals`, `edges`), `graphSize()` on `solid-js/attribution`,
and `GRAPH_GROWTH` (warn) with `graphGrowth: { visits, ratio }`, judging
every series and naming which climbed. The count is the whole graph's, so
the first route to complete its climb reports and names the others
(`data.routes`), and the verdict resets for the graph.

- **Known:** the core keeps node and edge counters in the observe build
  (the graph-size checks `HUGE_FAN_OUT`/`HUGE_FAN_IN` read them); a router
  declares navigations with `withOrigin`.
- **Shape:** a `"graph"` record on `OBSERVE.records` at each navigation
  settle: `{ nodes, roots, at, navigation }`. A monotonic climb across
  navigations is a leaked root or an undisposed subscription. Finding
  `GRAPH_GROWTH` (warn; fingerprint route pattern) when the count after
  leaving a route exceeds the count on entering it by a ratio over K
  visits. A consumer can compute this from the record alone; the finding
  is a convenience.
- **Idle cost:** one integer per navigation.
- **Proof:** a route that creates a root in an effect without disposing
  it fires after three visits; the same route with `onCleanup` fires
  nothing.

### 8. Client recovery from `render/client` — LANDED

Shipped as the `"recovery"` record on `OBSERVE.records` (`RecoveryEvent`:
`id`, `at`, `waitedMs`, `renderMs`), emitted by the client hydration
runtime when a boundary's fragment rejected or the stream was cut and the
children rendered as fresh DOM; joins the server's `"boundary"` record by
`id`. Prod byte-identical (the branch and its helper fold on `IS_OBSERVE`);
the clock is read only when something is subscribed.

- **Known:** the server `"boundary"` record with `outcome: "client"` and
  the server error hook's `handling: "client"` say the server handed a
  rejected `<Loading>` fragment to the client; the client's hydration then
  renders the content itself.
- **Shape:** a field on the client's frame/hydration record (or a new
  `"recovery"` record) with the boundary's hydration `id`, `at`, and the
  time to first content — joinable to the server record by `id`. The
  question it answers: "this boundary fails on the server 4% of the time
  and costs users 900 ms when it does."
- **Idle cost:** a timestamp per recovered boundary; zero when none fail.
- **Proof:** a boundary whose server read rejects produces a server record
  (`client`) and a client record with the same id and a positive duration.

## Cost — observe has to work well in production

Measured 2026-09-23 (M-series, observe artifacts, 200 memos + 200 effects
re-running per write, best of 5, `flush()` per write), ns per re-run:

| Configuration                                         | ns/re-run |
| ----------------------------------------------------- | --------- |
| observe build, engine not enabled (idle)              | 55        |
| engine enabled, `checks: false`, holds/waterfalls off | 490       |
| engine enabled, `checks: false`                       | 490       |
| engine enabled, defaults (all six checks)             | 530–545   |

Three facts, in order of weight:

- **Items 1–8 are not the cost.** All six checks together are ~50 ns; item
  6 was ~15 of those as first written (a `WeakMap` get and a clock read on
  the re-run path) and ~2 after moving its window onto node fields and
  reusing `RerunEvent.at`. Nothing in 1–8 adds per-edge or per-read work;
  item 7 reads the edge counters the tier already keeps for
  `HUGE_FAN_OUT`/`HUGE_FAN_IN`. Idle is untouched by construction.
- **Every check that touches the re-run path is a field read and a compare,
  or it does not go there.** `hotRuns`, `hotTime`, `wastedRecompute` each
  keep their window on the node (`_dev*` fields); a per-run `WeakMap`,
  `now()` or allocation is the shape to refuse in review. The
  `attribution-engine-cost` tripwire (enabled/idle ratio, best-of-k,
  interleaved, cap 14 against a measured ~10) is what catches it.
- **The engine's fixed per-re-run cost is the number that matters**: ~435 ns
  above idle with every check off, ~9× idle. It is the `RerunEvent` — the
  `causes` array, `depsAdded`/`depsRemoved` name arrays, `preview()` strings
  on writes — plus the history ring buffer push, `recordSubject`, and
  `emitRecord`. A click that re-runs 1,000 scopes pays 0.5 ms; a 10k-row
  update pays 5 ms and the GC pressure of 10k records. It is paid by every
  adapter that holds the engine for interaction/hold tracing, whether or
  not it reads a re-run.

### Lean posture — proposal, needs a decision

Build the `RerunEvent` only when someone can read it. The engine knows at
`recomputeEnd` whether anyone can: a `rerun` subscriber, a registered fold
(`costs`/`feedback`/`why`/`subscriptions` import), `log: true`, or a
consumer that will call `history()`. When none holds, keep only what the
other records need — the frame's interaction for `runs`/`runMs` on
`InteractionEvent`, the cause→interaction link for holds and flights, the
per-node counters the checks read — and skip the record: no causes array,
no dep-name diffs, no previews, no ring-buffer push, no `recordSubject`.
Expected: enabled cost for a records-only consumer falls from ~9× idle
toward 3–4×; measure before promising.

What it changes, and therefore what to decide:

- `history()`, `why()`, `subscriptions()` on a lean engine return nothing
  for runs that happened before a consumer of them appeared. Either
  document that (they are dev-console tools; the observe consumer that
  wants them subscribes to `rerun` or imports a fold, which turns records
  on from that moment), or add an explicit `enable({ reruns: true })` that
  forces record-building — the most-demanding merge makes that compose.
- `subscribe("rerun", …)` must turn record-building on, the way the
  `create`/`effect`/`flush`/`flight`/`fallback` timeline records already
  work ("subscribing is what turns them on"). The bare-form `subscribe(fn)`
  is the same subscription.
- The checks that read the record today (`checkHotRuns` reads
  `event.causes` for its cause key and message; `checkWastedRecompute`
  reads `changed`, `selfMs`, `phase`, `at`) need those facts from the frame
  instead of the record — they are all on the frame before the record is
  built.
- `@sentry/solid-2` subscribes to `rerun` only to fold a per-interaction
  hot list; `InteractionEvent.runs`/`runMs` and the `HOT_SCOPE_*` /
  `WASTED_RECOMPUTE` findings cover that, so the adapter can drop the
  subscription and become a lean consumer. The Performance Tracks adapter
  needs re-run records by design and stays a full one.

Not a shortcut: the record is the engine's unit of truth for the
dev-console tools, and a lean engine must produce the identical record the
moment a consumer asks. The proof is the existing attribution suite run
twice — once with a `rerun` subscriber armed, once without — and the
engine-cost tripwire's ratio dropping, with its cap ratcheted to hold the
gain.

## Consumers — showing the facts where developers already look

These are not runtime changes; they are the places the records should
appear, and they shape which fields the records need.

- **Chrome DevTools performance tracks** — owned by the Chrome Performance
  Tracks plan: `@solidjs/web/performance-tracks`, `enablePerformanceTracks()`,
  a `Solid` track group (Interactions, Propagation, Effects/Memos, Async,
  Holds, Navigations, Server) emitted with `console.timeStamp` /
  `performance.measure` the way React 19.2's tracks are, staged adapter →
  engine records (`flush`, `create`, `effect`, `flight`, `fallback`) →
  Propagation track (each drain as a wave named by its root writes, the
  runs inside labelled `node ← cause`, flow-control internals folded into
  their tag; Solid's answer to React's component flame, since nothing
  re-renders here — the graph the write travelled is the picture) →
  compiler source names (binding effects by target, primitives by declared
  identifier) → dev enrichments (`performanceIssue`, `console.createTask`
  stacks). It is also the fastest way to _see_ what
  items 1–4 here change, and its Stage 4 `performanceIssue` mapping is
  where the findings on this page surface in Chrome's Insights.
- **React DevTools parity checklist**, for the docs and for gap-finding:
  "highlight updates" (we have re-run records with `nodeId` → element via
  `subjectOf`), "why did this render" (`why()`), owner stacks
  (`ownerPath`), the `<Profiler>` render durations (`costs().scopes`
  self-time). What React DevTools cannot show and we can: holds and their
  acknowledgements, the interaction behind a write, the server boundary
  behind a wait. Keep this list current as items land.
- **Sentry (`@sentry/solid-2`).** Items 1 and 2 are what the adapter is
  waiting on to replace `after_settle` and to join its INP span to a cause;
  item 4's findings become issues without adapter changes. The reviewer
  brief in `getsentry/sentry-javascript` (`docs/solid-2-observe.md`) points
  here from its open questions.

## Not a runtime job

Computable from today's records by any consumer; the plan does not grow
runtime code for them unless two consumers implement the same join:

- Server N+1 and waterfall per request (item 5b).
- Call ↔ invocation wire time (`"call".durationMs − "invocation".durationMs`
  by `id`).
- Frame produce ↔ apply latency (`"frame"` records by `id` + `version`).
- Per-route hold budgets (navigation records' `holds` against a threshold
  the app chooses).

## Out of scope here

- Dev-only checks and the console reporter (`agent-diagnostics-plan.md`).
- Changes to the record wire format beyond adding optional fields; the
  shapes shipped in rc.9 are what consumers built against.
