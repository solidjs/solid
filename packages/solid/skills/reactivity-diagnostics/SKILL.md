# Repairing Solid reactivity from diagnostic codes

Solid's dev builds emit structured diagnostics with stable codes. When you see
a code — in the console, in a test failure, or in a captured artifact from
`@solidjs/diagnostics` — this guide maps it to the repair. Each entry says
what the runtime observed and what to change. Do not suppress a diagnostic
you do not understand; every one of these is a real defect or a real cost.

Severity `error` codes indicate broken behavior; `warn` codes indicate code
that works but is structurally wrong or expensive.

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
Invert the question with `createSelector` or a per-key store/projection so
only the keys whose answer flipped update.

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
ask keyed questions of it (every row vs. one selected id), invert with
`createSelector`/`createProjection`; if it's a per-frame value, gate it
behind a slower derivation.

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
the chain from `DEV.attribution.waterfalls()` if you need more than the
warning shows. Repairs, in order of preference:

1. If a later request does not need the earlier response, derive both from
   the same inputs so they start together (in one scope, read ALL async
   sources before using any — a not-ready throw at the first read stops the
   later ones from even starting).
2. If the dependency is intrinsic, preload the dependent data (route
   preloaders, hover preloads) or join the requests server-side.
3. False positive only if the work was ALREADY started by a layer the graph
   cannot see (a preloader or request cache handing out wrapper promises):
   that layer should call `DEV.attribution.markFlight(promise, startedAt)`
   on what it hands out; the chain then breaks on origin proof. Depth-2
   chains are `info` severity for exactly this reason — treat them as leads,
   not verdicts.

## Verifying a fix

If you are working with `@solidjs/diagnostics`, re-run the capture after the
repair: the code should disappear from `artifact.diagnostics`, and for the
performance codes, `expectRerunBudget`/`expectNoWaste` should now pass. See
the `agent-loops` skill in `@solidjs/diagnostics` for the full loop.
