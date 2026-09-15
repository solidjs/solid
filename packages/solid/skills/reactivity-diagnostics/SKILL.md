# Repairing Solid reactivity from diagnostic codes

Solid's dev builds emit structured diagnostics with stable codes. When you see
a code — in the console, in a test failure, or in a captured artifact from
`@solidjs/diagnostics` — this guide maps it to the repair. Each entry says
what the runtime observed and what to change. Do not suppress a diagnostic
you do not understand; every one of these is a real defect or a real cost.

Severity `error` codes indicate broken behavior; `warn` codes indicate code
that works but is structurally wrong or expensive.

## Locating a finding

Every console report is one entry: the message, then an `in` line naming the
owners that enclose the subject, root first — component roots as `<Name>`,
computations by their `name` option or the `effect`/`computed` default:

```
[HOT_SCOPE_TIME] effect "effect" spent 12.4ms of compute inside one 1000ms window ...
  in <App> › <TodoList> › <TodoRow> › effect
```

Read it as the component tree down to the scope. In captured artifacts the
same chain is `event.ownerPath` (a string array). No `in` line means the
subject has no named owner — a top-level scope, or an unowned primitive,
which for the `NO_OWNER_*` codes is the finding itself. Naming your memos and
effects (`{ name }`) turns the trailing `effect` into something you can grep.

In a browser, a report about a compiled JSX binding effect (an attribute,
class, style, or insert) also carries the element it writes as a second
console argument — hover to highlight it on the page, click to jump to it in
the Elements panel. That is the fastest way from a `HOT_SCOPE_*` warning to
"which row on screen." Why-chains (`attribution.enable()` from `solid-js/attribution`) print as
collapsed console groups: one headline per run, the causes inside.

The first report of each code ends with a footer pointing here — the
installed copy (`node_modules/solid-js/skills/...`) for tooling in the repo,
and the same file on GitHub with an anchor to the code's section for a human
reading the console.

With attribution enabled, every root write also carries WHO performed it
(`ChangeRecord.origin`): the user event and element (`click on button#next
"Next →"`), the effect or action it ran inside (`effect "syncTitle"`,
`action "save"`), the async landing, or `outside the reactive system`
(timers, sockets, post-`await` code in an action — the documented escape).
Why-chains print it after the write; re-runs and holds expose the
interaction they trace back to (`event.interaction`, `hold.interaction`), so
a cost or a wait can be read as "what did the user do to pay for this."

## Tracking mistakes (reads in the wrong place)

### STRICT_READ_UNTRACKED

A reactive value was read outside any tracking scope (e.g. destructured props
or a signal called in the component body). The read got the current value
once and will never update. Move the read into a tracking scope: JSX, a
memo, or an effect's compute function. If you intentionally want a one-time
snapshot, wrap the read in `untrack()` to say so explicitly.

### PENDING_ASYNC_UNTRACKED_READ

Same shape as above but the value was a pending async computation, so there
is nothing to read yet at all. Async values must be read where tracking can
suspend and resume: JSX, a memo, or an effect's compute function.

### PENDING_ASYNC_FORBIDDEN_SCOPE

A pending async value was read inside `createTrackedEffect` or `onSettled`,
which cannot suspend — it throws. Use `createEffect` (separate compute and
effect phases) which is async-aware: put the async read in the compute
function.

## Write/imperative-code placement mistakes

### REACTIVE_WRITE_IN_OWNED_SCOPE

A signal/store write (or `refresh()`) executed during an owned scope — a
component body or a computation. Pure scopes must not cause state changes.
Move the write to an event handler or effect phase. If the write is genuinely
intentional initialization, pass the `ownedWrite` option on the setter call.

### ACTION_CALLED_IN_OWNED_SCOPE

An action was invoked during a component body or computation. Actions are
imperative entry points — call them from event handlers or other imperative
code.

### FLUSH_IN_EFFECT_CALLBACK

`flush()` was called inside an effect callback, where it is a no-op (the
flush running effects is already in progress). Writes made there are handled
in the same flush's continuation. If you truly need a drain afterwards,
defer it: `queueMicrotask(() => flush())`. Usually the right fix is deleting
the call.

### FLUSH_IN_ACTION

`flush()` was called inside an action body (the synchronous slice between
`yield`s). Thrown in DEV; in prod the drain is skipped. An action's writes are
held by its transaction until the action settles, so a flush can't reveal them
— imperative reads in the body seeing committed (pre-action) values is the
intended semantics, not staleness to work around. Draining there would also
detach the writes that follow from the transaction, committing them mid-action.
Delete the call; observe results after the action resolves.

## Ownership/lifecycle mistakes (leaks)

### NO_OWNER_EFFECT / NO_OWNER_BOUNDARY

An effect or boundary was created outside any reactive context (no root, no
component). It will never be disposed — a leak. Create it under a component
or `createRoot`, or use `runWithOwner` to attach it to an existing owner.

### NO_OWNER_CLEANUP

`onCleanup` was called outside a reactive context; the callback will never
run. Same fix: register it under an owner.

### CLEANUP_IN_FORBIDDEN_SCOPE

`onCleanup` inside `createTrackedEffect` or `onSettled` is not supported —
return a cleanup function from the callback instead.

### SETTLED_CLEANUP_UNOWNED

`onSettled` returned a cleanup while running in an unowned scope, so the
cleanup cannot be honored. Call the setup helper from an owned scope (the
component body), not from an event handler, tracked effect, or another
`onSettled`.

### RUN_WITH_DISPOSED_OWNER

`runWithOwner` received an owner that was already disposed; anything created
inside leaks. This usually means a stale owner captured across an await or
stored past its lifetime — re-capture the owner at call time or guard with
`isDisposed()`.

## API misuse

### MISSING_EFFECT_FN

`createEffect(compute)` with a single argument is not supported. Split the
work: `createEffect(() => signal(), value => doWork(value))`. For a derived
value use `createMemo`; for a one-shot side effect just call the function.

### PRIMITIVE_IN_FORBIDDEN_SCOPE

Reactive primitives cannot be created inside `createTrackedEffect` or
owner-backed `onSettled`. Hoist the primitive to the component body.

### INVALID_REFRESH_TARGET

`refresh()` expects a Solid source accessor or refreshable store — not a
wrapper function or a derived property read. Pass the original source.

### INVALID_AFFECTS_TARGET

`affects()` expects a Solid source accessor or store node, with at most one
optional key (keys only valid on store targets). Fix the target or drop the
extra keys.

### SYNC_NODE_RECEIVED_ASYNC

A computed/effect created with `sync: true` returned a Promise or
AsyncIterable; the value would be stored as-is, never awaited, in
production. Remove `sync: true` to use async-aware behavior, or unwrap
before returning.

## Hard failures

### REACTIVITY_HALTED

An earlier uncaught error halted the reactive system; subsequent updates are
ignored. Do not treat this code as the bug — find the original error above
it (or add an error boundary via `createErrorBoundary`/`<Errored>`) and fix
that.

### INVARIANT_VIOLATION

The reactive system contradicted itself — an internal bug, not user error.
Report it upstream with a reproduction; do not work around it silently.

## Performance pathologies (from the attribution engine)

These fire only while attribution is enabled and describe cost, not
incorrect behavior. The numbers in the message are measurements, not
guesses.

### HUGE_FAN_OUT / WIDE_WRITE

One value has very many subscribers, so a single change re-runs all of them.
Classic signature: every row of a list comparing against one selected id.
Invert the question: keep the answer in a store used as a map keyed by id
(`selected[row.id]` instead of `row.id === selectedId()`), so each consumer
reads its own key and only the keys that flipped update. When that map is
derived from other state, `createProjection` builds it.

### HUGE_FAN_IN / WIDE_SCOPE_DEPS

One computation reads very many sources, so it re-runs when any of them
change. Narrow its reads or split it into smaller memos that each track only
what they need. The message lists the sources — start with those.

### HOT_SCOPE_RERUNS

A scope re-ran far more often than any UI cadence justifies — a hot signal
(often per-frame or per-event) is leaking into it. The message names the
latest cause; either move that read out of the scope or derive a slower
value (e.g. a memo with an equality gate) between them.

### HOT_SCOPE_FANOUT

Many scopes went hot from ONE root cause (named in the message) — the
aggregate form of HOT_SCOPE_RERUNS, emitted so a single culprit doesn't
produce one warning per victim. Fix the cause, not the scopes: if consumers
ask keyed questions of it (every row vs. one selected id), invert it into a
store used as a map keyed by id; if it's a per-frame value, gate it behind a
slower derivation.

### HOT_SCOPE_TIME

A scope's summed compute time blew its per-window budget — a
few-but-expensive scope that run counts miss. Profile what it computes;
usually the fix is memoizing sub-derivations or moving work off the reactive
path.

### UNSTABLE_MEMO_OUTPUT

A memo keeps producing referentially-new but shallowly-equivalent
objects/arrays, so its equality gate never closes and every subscriber
re-runs on every upstream change. Return stable references or pass an
`equals` option.

### ASYNC_WATERFALL

Async flights ran in sequence when they might have run in parallel: each
named flight provably could not start until the previous one resolved, and
each took real time (the per-link durations are in the message/data). Read
the chain from `attribution.waterfalls()` if you need more than the
warning shows. Repairs, in order of preference:

1. If a later request does not need the earlier response, derive both from
   the same inputs so they start together (in one scope, read ALL async
   sources before using any — a not-ready throw at the first read stops the
   later ones from even starting).
2. If the dependency is intrinsic, preload the dependent data (route
   preloaders, hover preloads) or join the requests server-side.
3. False positive only if the work was ALREADY started by a layer the graph
   cannot see (a preloader or request cache handing out wrapper promises):
   that layer should call `attribution.markFlight(promise, startedAt)` (from `solid-js/attribution`)
   on what it hands out; the chain then breaks on origin proof. Depth-2
   chains are `info` severity for exactly this reason — treat them as leads,
   not verdicts.

### EFFECT_WRITES_OWN_SOURCE

An effect re-ran because of a write it made itself: its callback wrote a
value that its own inputs depend on (directly, or through the memos the
message names), so the flush settled in two passes and the screen rendered
the pre-write value in between. The effect converged — an infinite loop
throws on its own — which is exactly why nothing else reports it. Typical
shapes: clamping (`if (page() > max()) setPage(max())`), resetting one
signal when another changes, filling a default, normalizing input. The
written value is a function of what the effect reads, so it is a memo:
`const page = createMemo(() => Math.min(rawPage(), max()))`, or normalize
where the source is _written_ (in the setter/handler) instead of correcting
it afterwards. The `info` form names a cycle relayed across several effects
(`A` writes `x`, `B` reads `x` and writes `y`, `A` reads `y`) — same repair:
derive every relayed value from the original inputs and drop the writes.
The walk follows graph edges only; a write fed back through untracked
indirection is not claimed.

### EFFECT_RELAY_TEAR

Derived state kept in sync by an effect: `createEffect(() => f(a()), v =>
setS(v))`. The message names a reader that ran twice for ONE write of `a` —
once in the flush where `a` changed (against the stale `S`), once after the
effect's write landed — so its first frame was inconsistent. That double run
is proven from the cause chain; the rest of the message is confidence:

- "The written value is the effect's compute output" — by Solid's contract
  the compute half is a pure function of its tracked reads, so the value is
  derivable. Repair: `const s = createMemo(() => f(a()))`, delete the
  effect and the signal. This form warns on its own once it has repeated
  (`data.copy: true`), even with no double-running reader — everything
  reading the copy paints a flush behind everything reading the source.
- "The written value is `a` itself" (`data.passthrough`) — the prop-to-state
  port. Repair: read `a` where `S` was read; a memo only if a stable
  derivation is genuinely needed.
- "Nothing else writes `S`" (`data.soleWriter`) — derived state without the
  identity proof; same memo repair.
- "`S` has other writers — editable state reset from a source" (`copy` true,
  `soleWriter` false; `info` until it repeats) — the controlled-input shape.
  If resetting local editable state when the source changes is the intent,
  the tear is its cost; if `S` only ever mirrors the source, drop the copy.
- Neither (`info` until it repeats) — the written value is not the compute
  output and the signal has other writers. If the effect reads something
  outside the graph (layout, `Date.now()`, a ref), the tear is the cost of
  measuring and the finding is a fact to accept; if the value is computed
  from what the effect reads, it is still a memo.

### IMMUTABLE_UPDATE_IN_STORE

A store setter replaced a container with a fresh object/array whose leaves are
mostly the same values: `draft.user = { ...draft.user, name }`,
`draft.items = [...draft.items, x]`, `draft.items = draft.items.filter(…)`.
The store tracks leaves; a fresh container makes every reader of the
container's path (anything under `user`) re-run for the one leaf that moved.
Repair: mutate the draft — `draft.user.name = name`, `draft.items.push(x)`,
`draft.items.splice(i, 1)` — so only readers of the touched key or index
re-run. Data arriving from outside (a fetch result for the same records)
merges with `reconcile(data, "id")(draft.items)`, which keeps identity for
records that did not change. Once per store path; `data.unchanged/total`
says how much of the container was carried over.

### UNSTABLE_LIST_IDENTITY

A `mapArray`/`<For>` update disposed and recreated most rows while the
entering items were field-for-field equivalent to the ones they replaced:
a re-fetch (or a spread-copy, see above) handed back fresh objects for the
same records, and identity keying treated each as a new row — DOM, state,
focus, and scroll position thrown away and rebuilt. Repairs: key the list by
a stable field (`<For each={rows()} keyed={r => r.id}>`), or merge the
data into a store with `reconcile(data, "id")` so the same records keep the
same identity. If a key function is already in use (`data.keyed: true`) it
is returning unstable keys (the object itself, or something that changes
with the fetch) — return the stable field. Once per list.

## Responsiveness (from the attribution engine)

The runtime did the correct thing; the user saw nothing while it did. These
fire only while attribution is enabled.

### SILENT_HOLD

A write landed on async work, so the runtime held it (and everything derived
from it) until the data came back — that hold is correct; it is what keeps the
screen from tearing. But for the whole wait nothing on screen acknowledged it:
no `isPending()`/`latest()` reader downstream of the write or its blocker, no
optimistic value, no `affects()` mark, and no effect ran at all. From the
user's side the click was dead for the duration in the message — which, when
the write came from a JSX event handler, starts with what they did (`click on
button#next "Next →" wrote "page" (1 → 2)`) and is measured from that event.
The fix is ALWAYS to add feedback, never to remove the hold:

- Show the wait: read `isPending(() => blocker())` (the blocker is named in
  the message) or `isPending(() => derivedFromIt())` in the affected UI and
  render a busy state from it.
- Reveal the input immediately: `latest(source)` shows the NEW value of the
  held write (a page number, a filter, a query string) while the data catches
  up, so the control the user touched reflects the touch.
- Predict the outcome: `createOptimistic`/`createOptimisticStore` written
  alongside the real write (or inside the action) shows the expected result
  now and reverts on failure. For actions this is the primary repair — the
  message says "an action held" when the hold came from one.
- Do NOT: move the write off the async path, wrap it in `untrack`, or split
  the read so the write commits "faster" — that trades the hold for a torn
  screen (old data under new controls).

Thresholds sit at the strict end of the band on purpose: the engine measures
to the commit, not the paint, so every number is a floor on what the user
saw. From `holds.infoMs` (default 100ms — past "feels instant") the event is
`info`-severity, structured channel only; from `holds.warnMs` (default 200ms —
the INP "good" ceiling) it reaches the console. `attribution.holds()`
lists every hold (acknowledged or not) with what was held, what blocked it,
and which affordances answered it. When the silent hold's tail also crossed
the long-hold threshold (`data.long: true`) the message carries the
`LONG_HOLD` repair as well — the fallback is the honest UI at that length.

### LONG_HOLD

The hold WAS acknowledged — an `isPending()` spinner, a `latest()` header, an
optimistic value — and still ran on: the time from the user's last input to
the commit (`data.tailMs`; `holdMs` is the whole wait when input kept
arriving) reached `longHolds.infoMs` (default 500ms), `warn` from
`longHolds.warnMs` (default 1000ms, where the user loses the thread). A hold
is the stale-while-revalidate tool: right when the old screen stays useful
for the wait (tab switch, sort toggle, a fast page turn). At this length the
old screen has stopped being useful and started being a lie; "loading" glued
over it reads as broken. Show a fallback instead:

- Put the reader behind a `Loading` boundary keyed on what changed:
  `<Loading on={page()} fallback={<Skeleton />}>`. With `on`, the write
  commits at once and the fallback shows where the data lands. Without it a
  boundary that has already revealed keeps the old content — that IS the
  hold, so wrapping alone changes nothing.
- A boundary that has not revealed yet (a fresh route segment, a keyed
  subtree) takes the wait the same way; `on` is the switch for one that has.
- If the data itself is the problem, preload it (`markFlight` the kickoff so
  it is not misread as a waterfall) or cache it so the tail never gets there.

Do NOT remove the acknowledgement to "fix" this, and do not move the write
off the async path. The measure is the tail, not the lifetime, so a hold
that keeps taking input (typing) is judged by each wait, not by the sum.
`feedback().sources[].long`/`longMs` counts these at the table level,
acknowledged or not.

### Where to start: `attribution.feedback()`

Before chasing individual `SILENT_HOLD` events, read the ranked tables — the
same fold over holds and re-runs that `costs()` is over scopes and writes:

- `sources` — one row per set of async sources that held writes, ranked by
  silent time. `holds`, `heldMs`, `worstMs`, `silent`/`silentMs`,
  `acknowledgedBy` (which affordance answered, in how many holds),
  `latestOnly` (answered only by `latest()`: the input showed, nothing said
  "loading" — fine for short waits, a second UX problem for long ones),
  `interactions` (which user events were held here), `writes`, `actions`. A
  row like `posts: 6 holds, 4 silent, acknowledgedBy isPending:posts ×2` says
  the affordance exists on one screen and is missing on another — add it
  where the silent holds happen; do not touch the screen that already works.
- `interactions` — one row per user event (type + target; repeated dispatches
  fold together), ranked by total cost. `runs`/`selfMs`/`worstDispatchMs` is
  the synchronous re-run work one dispatch caused (the long-flush hazard —
  fix with `costs()`: fan-out, waste, unstable memos); `holds`/`heldMs`/
  `silentMs`/`worstHoldMs` is the time its writes spent held (the silent-hold
  hazard — fix with the affordances above). Two INP failure modes, one row.
  On `sources`, `long`/`longMs` counts holds whose tail ran past
  `longHolds.infoMs`, acknowledged or not: the spinner is not the whole
  answer there — a `Loading` keyed with `on`, a preload, a cache, or a faster
  source is (see `LONG_HOLD`).
- `navigations` — one row per route pattern (`/users/:id`), present when the
  router declares its navigations via `OBSERVE.attribution.withOrigin`:
  `navigations` settled, `settledMs`/`worstMs`, the `held` subset with
  `heldMs` and how many were `silent`, `superseded` (the user navigated
  again before it landed), and `redirected` (a guard or loader sent it
  elsewhere; the row is the route it ended up on). A route that is held and
  silent needs the affordances above where the route's data renders; a route
  with many superseded navigations is one users give up on — make its data
  fast or preload it on hover/intent; a route that is always `redirected`
  into is paying a hop the link could skip. `attribution.navigations()`
  lists each navigation with its `outcome`, its `redirects` (the abandoned
  destinations) and, when held, the `HoldEvent` itself.
- `flights` — one row per async source: `flights` started, `landed`,
  `abandoned` (superseded by a newer flight before landing), `landedMs`,
  `worstMs`. A source with many abandoned flights is re-asking on every
  keystroke; put a debounced or equality-gated derivation between the input
  and the fetch so only settled inputs ask.
- `fallbacks` — one row per loading boundary (named by owner path): `shows`,
  `shownMs`, `worstMs`, and `flashes` (shows under 150ms — a spinner that
  appeared and vanished, the other end of the SILENT_HOLD spectrum). Remove a
  flash by preloading, caching, or lifting the fetch above the boundary so
  the wait never reaches it; do not add artificial delay.

Every hold, flight and show counts here at any duration; `SILENT_HOLD` and
`LONG_HOLD` are the thresholded verdicts over the hold records.

## Server rendering

The server runtime reports on the same channel, with the same `in <App> ›
<Page>` line. Two groups. **Findings** (`SSR_*`, `LATE_HEADER_WRITE`,
`SERVER_FN_ERROR_SANITIZED`, `SSR_ERROR_SANITIZED`, `FRAME_MARKER_CORRUPTED`) are facts about a
render that exist in observe builds too — an APM sees them in production; in
dev they print. **Checks** (the rest) are dev-only guidance. A captured
artifact from a server render carries both.

### SSR_RENDER_ERROR_CONTAINED

A component threw during a server render and a boundary routed the error;
`data.handling` says how. `fallback` — an `<Errored>` rendered its fallback
(the response was a 200 showing the fallback; if this fires on every request
the fallback is the page). `client` — the enclosing `<Loading>` fragment
rejected and the client re-rendered the subtree after hydration (the user
paid a client render and a flash). `failed` — nothing contained it and the
request failed. In every case the repair is the error in `data.error`, in the
component `ownerPath` names; then consider whether an `<Errored>` closer to
the throw would contain it more narrowly.

### SSR_SUBTREE_ABANDONED

A fragment failed with descendants still pending, and their work (fetches,
serialized values — the counts are in `data`) was thrown away; the client
rebuilds the subtree. Find the failure (`data.error`), and give the failing
read its own `<Loading>` so its siblings ship independently.

### SSR_STREAM_ABANDONED

The client went away (`data.reason: "consumer"`) or the sink failed
(`"sink"`) while `data.pendingFragments` were still rendering; the render was
torn down. Not an app bug. At volume it is the cost of renders nobody waited
for: make the pending data faster or move it behind navigation.

### LATE_HEADER_WRITE

A response header was written after the head was sent; the write was
dropped (dev throws instead). `data.method`/`data.name` say which. Move the
write before the first flush — before any `<Loading>` fallback can ship — or
before the handler returns; a cookie set from inside a late-streaming
component never reaches the browser.

### SERVER_FN_ERROR_SANITIZED

A server function threw and the production wire replaced the error with the
generic message; `data.error` is the original. Fix the failure it names. If
the client is meant to see this error, brand it with `markSafeError` or map
it in `wrapInvocation`; do not turn sanitization off.

### SSR_ERROR_SANITIZED

A render failure reached the client — an `<Errored>` record, a rejected async
source in the stream, a fragment's rejection, a frame's error chunk — and the
production wire replaced it with the generic `Error`; `data.error` is the
original. Advisory: the failure itself is the `SSR_RENDER_ERROR_CONTAINED`
finding beside it — fix that. If the client is meant to see this error, brand
it with `markSafeError`; do not turn sanitization off. A fallback that prints
`err().message` shows "Internal Server Error" in production by design.

### FRAME_MARKER_CORRUPTED

(Client.) A frame's slot start marker has no end marker among its siblings:
invalid HTML nesting split the range when the browser parsed it (a block
element inside `<p>`, a `<tr>` outside a table), or a CDN/minifier stripped
the comment. Fix the nesting in the server component's markup; serve frame
documents with `Cache-Control: no-transform`.

### SERVER_WRITE

A signal, store or optimistic setter ran during a server render. Server
render is pure — state enters through async sources, never setters — so the
write landed as inert data and will throw in a later release. Derive the
state (`createStore(fn, seed)`, a memo over the promise); if the write bridges
a subscription, make the subscription the async source itself.

### REVEAL_IN_RENDER_TO_STRING

Nested `<Reveal>` with `collapsed`/`together` needs a stream to coordinate
on; `renderToString` has none. Use `renderToStream`, or drop the ordering.

### ASYNC_WATERFALL (server)

`data.side: "server"`. A `<Loading>` boundary rendered in `data.passes`
passes — discovery, then one per wait — and each pass past the first is a
read that could only start once the previous pass's async answered:
`passes - 1` sequential flights, `data.sequentialMs` end to end. Unlike the
client's verdict this proof is exact (the pass structure IS the chain), so
there is no `markFlight` false positive to rule out; the same repairs apply,
in the same order: derive both reads from the same inputs so they start
together (read ALL async sources before using any), or, if the dependency is
intrinsic, preload the dependent data or join the requests. Two flights are
`info` — a lead; three or more `warn`. The boundary is `data.boundary`; a
captured artifact has its record in `artifact.records.boundary` (same
`id`) and the server-function calls under it in `artifact.records.invocation`
(`boundary` field).

### SSR_CLIENT_CONTENT_MASKED

A `<Loading>` boundary's content turned out to be client-only (a
`ssrSource: "client"` read) but only after `data.passes - 1` real server
waits: an async read on an earlier pass masked it. The server did the work
(`data.durationMs`), streamed the fallback, then handed the whole subtree to
the client anyway — the work was discarded and the user saw the fallback
for the wait, then a client render. Give the client-only read its own
`<Loading>` so it hands off with the shell while the async data streams, or
read it before the async data so the boundary hands off on its first pass
(no finding for that case).

### LAZY_ASSET_UNMAPPED

A `lazy()` component's client chunk could not be resolved for the page
(`data.reason`: the resolver threw, or the module has no `$$moduleUrl`), so it
is not preloaded and loads late during hydration. This is bundler-plugin
configuration — the plugin injects `$$moduleUrl` and provides the resolver;
check the module is under its scope.

### PRELOAD_DESCRIPTOR_INVALID

A `registerAsset("preload")` descriptor broke a field rule (`data.field`
names it — a missing `as`, a non-string `href`, a malformed `imagesrcset`)
and the link was dropped or the field ignored. Fix the descriptor at its
source; the values are usually the bundler manifest's.

### HEAD_TAG_INVALID

A `useHead` registration the render could not honor; `data.reason` names the
rule. `non-head-tag`/`invalid-attribute`: only head elements and their
attributes; `props-error`/`group-error`: the props function threw — fix the
throw; `after-shell-flush`: register the tag before the first flush (above
the `<Loading>` whose fallback shipped); `outside-render`: call `useHead` from
a component body; `duplicate-title`: one `<title>` per group, the last wins.

### UNRECOGNIZED_INSERT_VALUE

A value the renderer cannot render (a plain object, a symbol —
`data.type`) sat at an insert position and was skipped, on either platform.
Usually a component function inserted where its call was meant, or an object
where one of its properties was.

### BEHAVIOR_CLAIM_DROPPED

A behavior position (an event handler) on a server-rendered element got
something the wire cannot carry: a client prop through a spread
(`data.reason: "spread"` — write the position out, `onClick={props.x}`) or a
function that exists only on the server (`"server-local"` — pass it from the
client through the server component's props, or bind a mutation to
`action=`).

## Verifying a fix

If you are working with `@solidjs/diagnostics`, re-run the capture after the
repair: the code should disappear from `artifact.diagnostics`; for the
performance codes, `expectRerunBudget`/`expectNoWaste` should now pass; for
`SILENT_HOLD`, `expectNoSilentHolds` (budget `maxSilentHoldMs: 0`) should —
and it checks every hold, not only the ones long enough to have warned. See
the `agent-loops` skill in `@solidjs/diagnostics` for the full loop.
