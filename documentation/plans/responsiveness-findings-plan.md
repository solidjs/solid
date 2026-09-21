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

- **D1 — Does an interaction stay open across its handler's returned
  promise?** (↔ Tracks: the Interactions track's settle span ends at
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
- **D2 — Are cost findings on by default in the observe build?**
  `HOT_SCOPE_RERUNS`, `UNSTABLE_MEMO_OUTPUT` and the rest fire "only while
  attribution is enabled". Item 6 adds a production-shaped one. Decide
  whether enabling the engine implies the cost checks (today's behavior) or
  whether a production consumer opts into them (`enable({ costs: true })`),
  since a finding nobody subscribes to still pays for its accounting.

## Items

### 1. Close the `await` escape in interactions

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

### 4. Promote the feedback-table facts to findings

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

### 6. Wasted recomputation, measured

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

### 7. Graph growth as a leak detector

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

### 8. Client recovery from `render/client`

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
