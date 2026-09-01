# RFC: Dev-mode diagnostics and errors

**Start here:** If you're migrating an app, read the migration guide first: [MIGRATION.md](MIGRATION.md)

## Summary

Solid 2.0 introduces a structured diagnostics system that catches common mistakes at development time. Every diagnostic has a code, severity (error or warning), and actionable message. Errors throw and halt execution; warnings log to the console. All diagnostics are stripped from production builds via `_SOLID_DEV_` / `__DEV__` guards.

Diagnostics can also be programmatically observed via `DEV.diagnostics.subscribe()` and `DEV.diagnostics.capture()` for tooling and testing.

## Diagnostic reference

### Errors (throw in dev)

These halt execution immediately. They indicate bugs that will cause incorrect behavior.

#### `REACTIVE_WRITE_IN_OWNED_SCOPE`

**Messages:**

- "Writing to reactive state inside an owned scope (component, computation) is not allowed. Move the write outside or set the `ownedWrite` option if this is intentional."
- "Calling refresh() inside an owned scope (component, computation) is not allowed. Move the invalidation outside pure computation."

Writing to reactive state or invalidating a reactive source inside a reactive scope (effect compute, memo, component body) throws. This prevents feedback loops and ensures the reactive graph is predictable.

```js
// Throws in dev
createMemo(() => setCount(count() + 1));
createMemo(() => refresh(user));

// Fix: derive instead of writing back
const doubled = createMemo(() => count() * 2);

// Fix: write/invalidate from an event handler
button.onclick = () => setCount(c => c + 1);
button.onclick = () => refresh(user);

// Escape hatch: mark as ownedWrite (internal signals only)
const [ref, setRef] = createSignal(null, { ownedWrite: true });
```

#### `PENDING_ASYNC_UNTRACKED_READ`

**Message:** "Reading a pending async value directly in [context]. Async values must be read within a tracking scope (JSX, a memo, or an effect's compute function)."

Reading an async value that hasn't resolved yet outside a tracked scope (e.g. in a component body or effect callback) throws. The system can't route an untracked read through `Loading` or retry it.

```jsx
// Throws if user() is async and pending
function Bad() {
  const name = user().name;
  return <div>{name}</div>;
}

// Fix: read in JSX (tracked by the compiler)
function Good() {
  return <div>{user().name}</div>;
}
```

#### `ASYNC_OUTSIDE_LOADING_BOUNDARY`

**Message:** "An async value was read outside a Loading boundary. The root mount will be deferred until all pending async settles."

**Severity:** `warn` (non-halting)

A render effect read pending async with no `Loading` ancestor catching it. The runtime handles this correctly — `render()` installs its top-level insert as a post-render effect, so the root DOM attach is withheld until all uncaught async settles, then attaches atomically. On the no-async happy path, `render()` still attaches synchronously via an internal tail `flush()`.

The diagnostic is an FYI, not an error: while async is pending the mount container will simply stay empty (or show its existing content, e.g. a static shell). Place a `Loading` boundary when you want explicit fallback UI or partial progressive mount — otherwise the permissive default is fine.

```jsx
// Warns (non-halting): no Loading ancestor
// Container stays empty until asyncUser() resolves, then mounts atomically.
render(() => <Profile user={asyncUser()} />, root);

// Explicit fallback UI: wrap in Loading
render(() => (
  <Loading fallback={<Spinner />}>
    <Profile user={asyncUser()} />
  </Loading>
), root);
```

**Debugging tip:** if your app doesn't mount, check the console for `ASYNC_OUTSIDE_LOADING_BOUNDARY` — it names the render effect whose pending async is holding the root.

**Scope:** the diagnostic only fires during the synchronous body of `render()` / `hydrate()`. Post-mount route transitions (including lazy route changes) run under their own transitions with the guard off, so they do not emit this warning.

#### `CLEANUP_IN_FORBIDDEN_SCOPE`

**Message:** "Cannot use onCleanup inside createTrackedEffect or onSettled; return a cleanup function instead"

`onCleanup` cannot be used inside `createTrackedEffect` or `onSettled` because these scopes manage cleanup through return values.

```js
// Throws
onSettled(() => {
  onCleanup(() => /* ... */);
});

// Fix: return cleanup
onSettled(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
});
```

#### `SETTLED_CLEANUP_UNOWNED`

**Message:** "onSettled returned a cleanup in an unowned scope; a cleanup can only be honored under an owner. Call your setup helper from an owned scope (e.g. the component body) instead of from inside an event handler, tracked effect, or another onSettled."

A returned cleanup is only honored when `onSettled` runs in an **owned** scope (a component body), where it fires on owner disposal. When `onSettled` fires out of band — from an event handler (no owner), a tracked effect, or another `onSettled` (a children-forbidden owner) — there is no owner lifecycle to bind a cleanup to. Returning one is a dev-mode error (the cleanup is dropped in production); the out-of-band fire itself is fine for one-shot work.

```js
// Throws (in dev): the inner onSettled fires out of band, so its cleanup
// has no owner lifecycle to attach to.
onSettled(() => {
  useSubscription(); // internally: onSettled(() => { sub(); return unsub; })
});

// Fix: call setup-with-teardown directly from an owned scope. A plain owned
// onSettled already waits for settle AND ties cleanup to disposal.
useSubscription();

// Out-of-band, one-shot work (no cleanup) stays fine:
const handleClick = () => {
  save();
  onSettled(() => toast("Saved!"));
};
```

#### Cannot create nested primitives in forbidden scope

**Message:** "Cannot create reactive primitives inside createTrackedEffect or owner-backed onSettled"

`createTrackedEffect` and `onSettled` run as leaf owners — you cannot nest `createSignal`, `createMemo`, `createEffect`, or other reactive primitives inside them.

```js
// Throws
onSettled(() => {
  const [s, setS] = createSignal(0);
});

// Fix: create primitives in the component body, use them in onSettled
const [s, setS] = createSignal(0);
onSettled(() => {
  console.log(s());
});
```

#### Invalid cleanup return value

**Message:** "[name] callback returned an invalid cleanup value. Return a cleanup function or undefined."

Effect, tracked effect, reaction, and `onSettled` callbacks must return either a cleanup function or `undefined`. Returning anything else (e.g. a number, string, or object) throws.

```js
// Throws
createEffect(
  () => count(),
  (value) => {
    return value; // not a function!
  }
);

// Fix: return a function or nothing
createEffect(
  () => count(),
  (value) => {
    console.log(value);
    return () => {}; // cleanup function
  }
);
```

#### `flush()` inside forbidden scope

**Message:** "Cannot call flush() from inside onSettled or createTrackedEffect. flush() is not reentrant there."

Calling `flush()` from inside `createTrackedEffect` or `onSettled` would cause re-entrancy. Schedule work outside instead.

#### Potential infinite loop

**Message:** "Potential Infinite Loop Detected."

The flush cycle exceeded 100,000 iterations. This usually means a reactive write triggers a re-read that triggers another write, endlessly.

### Warnings (console.warn in dev)

These log a warning but don't halt execution. They indicate patterns that will lose reactivity or cause subtle bugs.

#### `STRICT_READ_UNTRACKED`

**Message:** "Reactive value read directly in [context] will not update. Move it into a tracking scope (JSX, a memo, or an effect's compute function)."

Reading a signal, signal-backed prop, or store property at the top level of a component body (or in an effect callback) will not track. The value is captured once and never updates.

```jsx
// Warns: top-level read won't track
function Bad(props) {
  const n = props.count;
  return <div>{n}</div>;
}

// Fix: read in JSX
function Good(props) {
  return <div>{props.count}</div>;
}

// Fix: explicit one-time read
function AlsoGood(props) {
  const n = untrack(() => props.count);
  return <div>{n}</div>;
}
```

This also fires for store property access in the same contexts.

#### `PENDING_ASYNC_FORBIDDEN_SCOPE`

**Message:** "Reading a pending async value inside createTrackedEffect or onSettled will throw. Use createEffect instead which supports async-aware reactivity."

Warns that an async value read inside `createTrackedEffect` or `onSettled` will throw if it's ever pending, because these scopes can't route not-ready reads through `Loading`. Use `createEffect` (which supports async-aware reactivity) instead.

#### `NO_OWNER_EFFECT`

**Message:** "Effects created outside a reactive context will never be disposed"

An effect (`createEffect` or `createTrackedEffect`) was created without a parent owner. It will run indefinitely and never be cleaned up. Usually means the effect was created at module scope or after disposal.

```js
// Warns: no owner
createEffect(() => count(), (v) => console.log(v));

// Fix: create inside a component or createRoot
createRoot(() => {
  createEffect(() => count(), (v) => console.log(v));
});
```

#### `NO_OWNER_CLEANUP`

**Message:** "onCleanup called outside a reactive context will never be run"

`onCleanup` was called with no active owner. The cleanup function will never execute.

#### `NO_OWNER_BOUNDARY`

**Message:** "Boundaries created outside a reactive context will never be disposed."

A `Loading` or `Errored` boundary was created without a parent owner.

#### `RUN_WITH_DISPOSED_OWNER`

**Message:** "runWithOwner called with a disposed owner. Children created inside will never be disposed."

The owner passed to `runWithOwner` has already been disposed. Any reactive primitives created inside will leak.

#### `HUGE_FAN_OUT`

**Message:** "Signal [name] has N subscribers. Each will re-run when it changes. …"

One source has grown an unusually large number of live subscribers (first warning at 2000, repeated every additional 500). This is the signature of many independent computations reading the same value — for example, every row of a list comparing itself against one `selectedId` signal. Prefer a per-key store or a projection so only the items whose result actually flipped re-run.

Always on in dev; maintained by the graph's link/unlink operations, so the counts reflect live edges (disposed subscribers don't count against the threshold).

Related: `WIDE_WRITE` (below) fires at **write** time from a much lower threshold, but only while the attribution engine is enabled — static fan-out that never writes is harmless, so the write-time check can afford to be far more sensitive. `HUGE_FAN_OUT` is the always-on backstop for structure large enough to warn about even if it never changes.

#### `HUGE_FAN_IN`

**Message:** "Computation [name] has N sources. It will re-run when any of them change. …"

One computation subscribes to an unusually large number of sources (same thresholds as `HUGE_FAN_OUT`). This is the coarse-read signature — e.g. a helper that touches a whole store, or one memo derived from everything. Narrow the read or split the derivation so each computation tracks only what it needs.

Related: `WIDE_SCOPE_DEPS` (below) fires at a much lower threshold, but only while the attribution engine is enabled — it names the offending sources. `HUGE_FAN_IN` is the always-on backstop for the pathological case.

#### `HOT_SCOPE_RERUNS`, `HOT_SCOPE_TIME`, `WIDE_SCOPE_DEPS`

Perf-kind warnings emitted by the **attribution engine** — they only fire while `DEV.attribution.enable()` is active (see the next section). Defaults:

- `HOT_SCOPE_RERUNS`: one scope re-ran 120+ times within 1000ms (above animation-frame cadence, so a legitimate rAF-driven scope doesn't cry wolf). The message names the most recent cause chain. When many scopes go hot from the *same* root cause (a selection write re-running every row), only the first warns per-node; the rest fold into `HOT_SCOPE_FANOUT` (below) so one culprit can't bury the console in victim warnings.
- `HOT_SCOPE_TIME`: one scope's summed self-time exceeded 8ms within 1000ms — half a frame in one scope. Catches the few-but-expensive runs that counts miss.
- `WIDE_SCOPE_DEPS`: a scope's dependency count reached 30 (re-warns after another 50% growth), with the source names listed.

All three thresholds are configurable (or disable-able) through `enable()` options.

#### `WIDE_WRITE`

**Message:** "write to [name] reached N subscribers — every one re-runs this flush. …"

A committed root invalidation — a signal or store write, a `refresh()`, or an async landing — reached a node with an unusually large number of live subscribers (default 250). Where the per-scope warnings above blame the *reader*, this one blames the *write*: it is the fan-out actually happening, priced at the moment it happens. The classic shape is many consumers asking keyed questions of one value (every row comparing against one selected id); the fix is inverting the subscription with `createSelector` or `createProjection` so only the keys whose answer flipped re-run.

Attribution-engine only, like the trio above. Specced together with `HUGE_FAN_OUT` so the two never double-fire on one node: `HUGE_FAN_OUT` is always-on and fires at *link* time from 2000 subscribers up — structure so large it warns even if never written — while `WIDE_WRITE` fires at *write* time from a much lower bar, once per node, re-warning only after the subscriber count doubles. Unchanged writes never fire it (the source equality gate commits nothing and notifies no one). The check reads the same live `_subCount` the graph-size warnings maintain, so disposed subscribers don't count.

Threshold configurable (or disable-able) via `enable({ wideWrites })`.

#### `HOT_SCOPE_FANOUT`

**Message:** "N scopes have gone hot (M re-runs) within [window]ms, all driven by [cause] — one hot cause is re-running a large part of the graph. …"

The per-cause aggregate of `HOT_SCOPE_RERUNS`. Hot-scope warnings blame the victim scope; when one hot cause drives many scopes, the first scope to go hot for that root-cause key warns normally and subsequent ones are counted silently, with scope-count milestones (5, then 10×) emitting one escalating fan-out warning that names the shared cause. A genuinely single hot scope behaves exactly as before.

#### `ASYNC_WATERFALL`

**Message:** "N sequential async flights — 'story' (120ms) → 'author' (80ms) — 200ms serialized: each began only after the previous resolved. …"

Attribution-engine only. An async flight (a promise or async iterable entering the system) formed a sequential chain behind an upstream flight. A chain link is asserted only on double proof: the flight's recompute was **caused** by the upstream's landing (graph causality — create runs inherit the enclosing recompute's causes, which covers boundary reveals and lazy first pulls), and the flight's **origin** post-dates the upstream's landing. Origin is the earliest provable start of the work: a `DEV.attribution.markFlight(promise, startedAt)` stamp (preloaders and request caches declaring their kickoff), first-seen object identity, else registration time — so preloaded work already in the air alongside its upstream is parallel and never chains.

The verdict is duration-gated (each link ≥ `waterfalls.minFlightMs`, default 50ms — a settled cache hit resolves fast and never warns). Depth-2 chains emit at `info` severity on the structured channel only: a dependent fetch is sometimes intrinsic, and an *unmarked* external preload is indistinguishable from a real waterfall, so the console stays quiet. Depth-3+ escalates to a console `warn`. Once per node, re-warning only when the chain grows. Every graph-provable chain — warned or not — is queryable via `DEV.attribution.waterfalls()`.

If a preloading layer hands out wrapper promises (e.g. `.then()` chains over a cached flight), it must call `markFlight` on the wrapper it returns, with the original kickoff time — wrapping defeats identity tracking otherwise.

## Programmatic diagnostics API

In dev mode, `DEV.diagnostics` provides two methods for tooling:

### `DEV.diagnostics.subscribe(listener)`

Registers a callback that fires for every diagnostic event. Returns an unsubscribe function.

```js
import { DEV } from "solid-js";

const unsub = DEV.diagnostics.subscribe((event) => {
  console.log(`[${event.severity}] ${event.code}: ${event.message}`);
});
// later: unsub();
```

### `DEV.diagnostics.capture()`

Returns a capture object for collecting diagnostics in a scoped region (useful in tests).

```js
const capture = DEV.diagnostics.capture();

// ... code that may emit diagnostics ...

const events = capture.stop();
// events: DiagnosticEvent[]
```

Each `DiagnosticEvent` has:

| Field | Type | Description |
|-------|------|-------------|
| `sequence` | `number` | Monotonically increasing counter |
| `code` | `DiagnosticCode` | Machine-readable code (e.g. `"STRICT_READ_UNTRACKED"`) |
| `kind` | `DiagnosticKind` | Category: `"strict-read"`, `"async"`, `"write"`, `"lifecycle"`, `"owner"`, `"perf"`, `"graph"` |
| `severity` | `"info" \| "warn" \| "error"` | `error` throws, `warn` logs; `info` is advisory (structured channel only — budget/assertion consumers should not fail on it) |
| `message` | `string` | Human-readable message |
| `ownerId` | `string?` | ID of the reactive owner where the diagnostic occurred |
| `ownerName` | `string?` | Debug name of the owner |
| `nodeName` | `string?` | Debug name of the signal/node involved |
| `data` | `object?` | Additional context |

## Diagnostic codes (quick reference)

| Code | Severity | Category | Trigger |
|------|----------|----------|---------|
| `REACTIVE_WRITE_IN_OWNED_SCOPE` | error | write | Reactive write/invalidation inside component/computation |
| `PENDING_ASYNC_UNTRACKED_READ` | error | async | Reading pending async outside tracking scope |
| `ASYNC_OUTSIDE_LOADING_BOUNDARY` | warn | async | Async computation outside Loading boundary (non-halting; root mount is deferred) |
| `CLEANUP_IN_FORBIDDEN_SCOPE` | error | lifecycle | `onCleanup` inside trackedEffect/onSettled |
| `SETTLED_CLEANUP_UNOWNED` | error | lifecycle | `onSettled` returned a cleanup in an unowned (out-of-band) scope |
| `STRICT_READ_UNTRACKED` | warn | strict-read | Untracked reactive read in component/effect body |
| `PENDING_ASYNC_FORBIDDEN_SCOPE` | warn | async | Pending async read in trackedEffect/onSettled |
| `NO_OWNER_EFFECT` | warn | lifecycle | Effect created without reactive owner |
| `NO_OWNER_CLEANUP` | warn | lifecycle | `onCleanup` called without owner |
| `NO_OWNER_BOUNDARY` | warn | lifecycle | Boundary created without owner |
| `RUN_WITH_DISPOSED_OWNER` | warn | owner | `runWithOwner` with disposed owner |
| `HUGE_FAN_OUT` | warn | graph | One source reached 2000 live subscribers (always on) |
| `HUGE_FAN_IN` | warn | graph | One computation reached 2000 live sources (always on) |
| `HOT_SCOPE_RERUNS` | warn | perf | 120+ re-runs of one scope in 1s (attribution enabled) |
| `HOT_SCOPE_FANOUT` | warn | perf | 5+/50+/500+ scopes hot from one root cause (attribution enabled) |
| `HOT_SCOPE_TIME` | warn | perf | 8ms+ self-time in one scope in 1s (attribution enabled) |
| `WIDE_SCOPE_DEPS` | warn | perf | Scope subscribed to 30+ sources (attribution enabled) |
| `WIDE_WRITE` | warn | perf | Committed write reached 250+ subscribers (attribution enabled) |
| `ASYNC_WATERFALL` | info/warn | perf | 2+/3+ origin-proven sequential async flights (attribution enabled) |

## Run attribution — "why did this run"

Beyond the always-on diagnostics above, dev builds ship an opt-in **attribution engine** that explains every re-run. The runtime already knows the full dependency graph; enabling attribution stamps each value commit with a change record (a write, an async landing, a `refresh()` invalidation, or a derived change chaining back to its causes), so each re-run reports the chain down to the originating write:

```
[why-run] effect "docTitle" ran (run 4)
  ← memo "userLabel" changed (#6)
    ← signal "notifications" write (#5) 2 → 3
```

### API (`DEV.attribution`)

```js
import { DEV } from "solid-js";

DEV.attribution.enable({
  log: true,          // pretty-print each re-run (default true)
  stacks: false,      // capture write stacks — slow (default false)
  historyLimit: 200,  // ring buffer size
  hotRuns: { count: 120, windowMs: 1000 },   // or false
  hotTime: { budgetMs: 8, windowMs: 1000 },  // or false
  wideDeps: 30,                               // or false
  wideWrites: 250,                            // or false
  waterfalls: { minFlightMs: 50 }             // or false
});

DEV.attribution.history();          // ring buffer of RerunEvents
DEV.attribution.why(someMemo);      // re-run history for one node
DEV.attribution.subscriptions(fn);  // current dep names of one scope
DEV.attribution.costs();            // { scopes, writes } ranked cost tables
DEV.attribution.waterfalls();       // graph-provable sequential flight chains
DEV.attribution.subscribe(fn);      // live RerunEvent feed
DEV.attribution.disable();

// Callable anytime (even while disabled): preloaders/caches declare the true
// kickoff of promises they hand out, so dependents that pick them up later
// are never misread as waterfalls.
DEV.attribution.markFlight(promise, startedAt?);
```

`costs()` aggregates since `enable()`: `scopes` ranked by self-time with `wastedMs` (time in runs whose value didn't change — the equality cutoff absorbed them), and `writes` ranked by the total downstream re-run time each root write caused. Overlay work (optimistic-lane and transition-replay runs) is accounted separately as `overlayMs` and never blamed as waste.

### Architecture

The engine is decoupled from the core through a narrow dev-only hook surface (`attribution-hooks.ts`): the core's only obligation is to report true facts (recompute start/end with lane and transition posture, committed writes, async landings, refreshes) at the moments they happen. All semantics — stamps, cause chains, timings, thresholds — live in the engine. Disabled cost is one null check per hook site; production builds fold every site out entirely (the size guard enforces byte-parity).

The same hook surface is the intended substrate for external devtools: install your own `AttributionHooks` implementation instead of the built-in engine — one mechanism, two front-ends.

Naming: attribution output uses debug names from the `name` option on primitives (`createSignal(0, { name: "count" })`); store nodes are named `store.path` automatically while the engine is active. Unnamed nodes fall back to their owner id.
