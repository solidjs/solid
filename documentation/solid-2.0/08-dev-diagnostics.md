# RFC: Dev-mode diagnostics and errors

**Start here:** If you're migrating an app, read the migration guide first: [MIGRATION.md](MIGRATION.md)

## Summary

Solid 2.0 introduces a structured diagnostics system that catches common mistakes at development time. Every diagnostic has a code, severity (`error`, `warn`, or `info`), and actionable message. Errors throw and halt execution; warnings log to the console; `info` events are advisory leads that reach only the structured channel. All diagnostics are stripped from production builds via `_SOLID_DEV_` / `__DEV__` guards.

Diagnostics can also be programmatically observed via `OBSERVE.diagnostics.subscribe()` and `OBSERVE.diagnostics.capture()` for tooling and testing. The `@solidjs/diagnostics` package builds an agent-facing harness on that channel (captured artifacts, budgets, Vitest matchers, a browser bridge); the `reactivity-diagnostics` skill shipped in `solid-js` maps every code to its repair.

## Console addressability

Every console report is one entry built for a human to act on:

- The message, with the code in brackets and the repair in the text.
- An `in` line naming the owners enclosing the subject, root first — component roots as `<Name>`, computations by their `name` option or the `effect`/`computed` default (`in <App> › <TodoList> › <TodoRow> › effect`). The same chain is `event.ownerPath` on the structured event. A component's name is the tag as written in source when the compiler's `componentNames` option is on (`createComponent(Home, props, "Home")` — the Vite plugin enables it for the dev and `observe` postures, so minified observe builds still read `<Home>`), otherwise the function's `.name`, which a minifier rewrites and a `lazy()` wrapper hides. Components a library invokes by value rather than by tag (a router rendering a route's `component`) carry only the function name.
- For a compiled JSX binding effect (attribute, class, style, property, spread, insert), the element it writes as a second console argument — hover highlights it on the page, click jumps to it in the Elements panel. The web runtime tags binding effects with their element in dev; the core prints whatever the subject knows.
- The first report of each code ends with a footer registered by `solid-js` (`DEV.setConsoleFooter`): the installed repair skill path (`node_modules/solid-js/skills/reactivity-diagnostics/SKILL.md`) and the same file's stable GitHub URL anchored to the code's section. Perf, graph, and responsiveness codes add a second line pointing at `attribution.enable()` from `solid-js/attribution` and the `agent-loops` skill in `@solidjs/diagnostics`.

Attribution's own output (`[why-run]` chains) prints as collapsed console groups — one headline per re-run, the cause chain and dependency delta inside.

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
render(
  () => (
    <Loading fallback={<Spinner />}>
      <Profile user={asyncUser()} />
    </Loading>
  ),
  root
);
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
  value => {
    return value; // not a function!
  }
);

// Fix: return a function or nothing
createEffect(
  () => count(),
  value => {
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
createEffect(
  () => count(),
  v => console.log(v)
);

// Fix: create inside a component or createRoot
createRoot(() => {
  createEffect(
    () => count(),
    v => console.log(v)
  );
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

**Message:** "Signal [name] changed with N subscribers — every one re-runs this flush. …"

A committed change (a write, a memo's new value, an async landing) reached an unusually large number of live subscribers (first warning at 2000; re-warns once the count has grown by another 500). This is the signature of many independent computations reading the same value — for example, every row of a list comparing itself against one `selectedId` signal. Prefer a per-key store or a projection so only the items whose result actually flipped re-run.

Always on wherever the diagnostics channel exists (dev and observe tiers). The count is taken by the notification walk the change makes anyway, so it is the live subscriber list at that moment — disposed subscribers don't count — and the core keeps no per-node counter for it (a live edge count was a post-construction field on every node, and forked node shapes). Fires on the change, not on subscription: a fan-out that is never written costs nothing, and one that is re-runs every subscriber right then.

Related: `WIDE_WRITE` (below) is the same finding from a much lower threshold, but only while the attribution engine is enabled; it hands over to `HUGE_FAN_OUT` at 2000, so one change never carries both.

#### `HUGE_FAN_IN`

**Message:** "Computation [name] tracked N sources. It will re-run when any of them change. …"

One recompute pass tracked an unusually large number of distinct sources (same thresholds as `HUGE_FAN_OUT`; the sources the pass actually tracked, counted once at the end of the pass — repeat reads of the same source excluded). This is the coarse-read signature — e.g. a helper that touches a whole store, or one memo derived from everything. Narrow the read or split the derivation so each computation tracks only what it needs.

Related: `WIDE_SCOPE_DEPS` (below) fires at a much lower threshold, but only while the attribution engine is enabled — it names the offending sources. `HUGE_FAN_IN` is the always-on backstop for the pathological case.

#### `HOT_SCOPE_RERUNS`, `HOT_SCOPE_TIME`, `WIDE_SCOPE_DEPS`

Perf-kind warnings emitted by the **attribution engine** — they only fire while the attribution engine (`solid-js/attribution`) is enabled (see the next section). Defaults:

- `HOT_SCOPE_RERUNS`: one scope re-ran 120+ times within 1000ms (above animation-frame cadence, so a legitimate rAF-driven scope doesn't cry wolf). The message names the most recent cause chain. When many scopes go hot from the _same_ root cause (a selection write re-running every row), only the first warns per-node; the rest fold into `HOT_SCOPE_FANOUT` (below) so one culprit can't bury the console in victim warnings.
- `HOT_SCOPE_TIME`: one scope's summed self-time exceeded 8ms within 1000ms — half a frame in one scope. Catches the few-but-expensive runs that counts miss.
- `WIDE_SCOPE_DEPS`: a scope's dependency count reached 30 (re-warns after another 50% growth), with the source names listed.

All three thresholds are configurable (or disable-able) through `enable()` options.

#### `WIDE_WRITE`

**Message:** "write to [name] reached N subscribers — every one re-runs this flush. …"

A committed root invalidation — a signal or store write, a `refresh()`, or an async landing — reached a node with an unusually large number of live subscribers (default 250). Where the per-scope warnings above blame the _reader_, this one blames the _write_: it is the fan-out actually happening, priced at the moment it happens. The classic shape is many consumers asking keyed questions of one value (every row comparing against one selected id); the fix is inverting the subscription: keep the answer in a store used as a map keyed by id (`selected[row.id]` rather than `row.id === selectedId()`), so each consumer reads its own key and only the keys that flipped re-run; `createProjection` builds such a map when it is derived from other state.

Attribution-engine only, like the trio above. Specced together with `HUGE_FAN_OUT` so the two never double-fire on one change: `WIDE_WRITE` covers the range from its threshold up to 2000 subscribers, once per node, re-warning only after the subscriber count doubles; from 2000 up the always-on `HUGE_FAN_OUT` takes over. Unchanged writes never fire it (the source equality gate commits nothing and notifies no one). The engine counts the live subscriber list on the write, so disposed subscribers don't count.

Threshold configurable (or disable-able) via `enable({ wideWrites })`.

#### `HOT_SCOPE_FANOUT`

**Message:** "N scopes have gone hot (M re-runs) within [window]ms, all driven by [cause] — one hot cause is re-running a large part of the graph. …"

The per-cause aggregate of `HOT_SCOPE_RERUNS`. Hot-scope warnings blame the victim scope; when one hot cause drives many scopes, the first scope to go hot for that root-cause key warns normally and subsequent ones are counted silently, with scope-count milestones (5, then 10×) emitting one escalating fan-out warning that names the shared cause. A genuinely single hot scope behaves exactly as before.

#### `ASYNC_WATERFALL`

**Message:** "N sequential async flights — 'story' (120ms) → 'author' (80ms) — 200ms serialized: each began only after the previous resolved. …"

Attribution-engine only. An async flight (a promise or async iterable entering the system) formed a sequential chain behind an upstream flight. A chain link is asserted only on double proof: the flight's recompute was **caused** by the upstream's landing (graph causality — create runs inherit the enclosing recompute's causes, which covers boundary reveals and lazy first pulls), and the flight's **origin** post-dates the upstream's landing. Origin is the earliest provable start of the work: an `attribution.markFlight(promise, startedAt)` stamp (preloaders and request caches declaring their kickoff), first-seen object identity, else registration time — so preloaded work already in the air alongside its upstream is parallel and never chains.

The verdict is duration-gated (each link ≥ `waterfalls.minFlightMs`, default 50ms — a settled cache hit resolves fast and never warns). Depth-2 chains emit at `info` severity on the structured channel only: a dependent fetch is sometimes intrinsic, and an _unmarked_ external preload is indistinguishable from a real waterfall, so the console stays quiet. Depth-3+ escalates to a console `warn`. Once per node, re-warning only when the chain grows. Every graph-provable chain — warned or not — is queryable via `attribution.waterfalls()`.

If a preloading layer hands out wrapper promises (e.g. `.then()` chains over a cached flight), it must call `markFlight` on the wrapper it returns, with the original kickoff time — wrapping defeats identity tracking otherwise.

#### `UNSTABLE_MEMO_OUTPUT`

**Message:** "memo [name] produced a new-but-equivalent [object/array] on N consecutive runs — its equality gate never closes, so every subscriber re-runs on every upstream change. …"

Attribution-engine only. A memo returned a fresh container that is shallowly equivalent to its previous value on `unstableMemos` consecutive runs (default 4). The equality cutoff that normally absorbs no-op recomputes never fires, so the memo's whole subtree re-runs for nothing. Return stable references (memoize the container, mutate a store) or pass an `equals` option that compares by content.

#### `EFFECT_WRITES_OWN_SOURCE`

**Message:** "effect [name] re-ran because of its own write: it [wrote signal X 3 → 5], which fed back into its inputs [via memo Y]. Two flushes to settle, and the screen rendered the pre-write value in between. …"

Attribution-engine only; graph-proven. An effect's callback wrote a signal or store, and the cause chain of the effect's _next_ run leads back to that write — directly or through any number of derived nodes. The written value is therefore a function of what the effect reads: compute it in a memo (or normalize where the source is written) and drop the effect. The engine follows the chain across effects too: when two or more effects relay writes in a cycle (`A → B → A`), one `info`-severity report names the whole ring and the flush count per change, instead of blaming one effect. A converging loop (clamp, dedupe) is reported the same way — the runtime settles, but each change costs an extra flush and a visible intermediate frame.

Excluded by construction: writes to signals the effect does not (transitively) read, and writes inside `untrack` that never feed back.

#### `EFFECT_RELAY_TEAR`

**Messages:**

- "[kind] [victim] ran twice for one write of [root]: once in the flush where [root] changed, and again after effect [relay] relayed it by writing [signal] — the first frame showed the new [root] with the stale [signal]. …"
- "effect [relay] writes its compute output into [signal] on every run, and nothing else writes [signal] — it is derived state kept one flush late: everything reading it paints a frame behind everything reading the source. …"

Attribution-engine only; graph-proven. A scope re-ran, and every root cause of that run was an effect-originated write whose own run was caused by the same root change that triggered the scope's _previous_ run. The reader rendered a stale frame in between: that is the tear. The verdict adapts to what the graph shows:

- The relay writes its compute output unchanged (an identity copy) and is the signal's sole writer → the value is derivable; `warn` as soon as the copy repeats, even with no reader of both sides, with the repair "read the source / make it a memo."
- Identity copy into a signal that has other writers (a controlled input reset from props) → `info`; the pattern is legitimate editable state, and the repair is to seed the local signal from the prop rather than sync it.
- Anything else (the effect measures DOM, reads a ref, or transforms) → `info` on first sighting, escalating to `warn` once the same relay tears repeatedly. The message offers the measurement fork: if the value cannot be derived, the tear is the price of measuring, and a `createRenderEffect` (or reading the measurement in the same effect) avoids the second frame.

#### `IMMUTABLE_UPDATE_IN_STORE`

**Message:** "[store.path] was replaced with a fresh [object/array] whose [leaves/items] are mostly the same values (K of M unchanged, 1 changed) — a spread-copy update. The store already tracks leaves; a new container makes every reader of [path] re-run for the one that moved. …"

Attribution-engine only. A store write replaced a container (`setState("todos", [...todos, next])`, `setState("user", { ...user, name })`) with a new instance whose leaves are mostly referentially identical to the old ones (unwrapping proxies). The store's fine-grained readers gain nothing from the copy and every subscriber of the container path re-runs. Mutate the draft in place (`setState(s => { s.todos.push(next) })`) or pass `reconcile()` for data that arrives as a fresh tree from the server. Reports once per path.

#### `UNSTABLE_LIST_IDENTITY`

**Message:** "list [name] recreated N of M rows on an update where the entering items are equivalent to the ones they replaced (K of S sampled pairs identical field-for-field) — fresh objects for the same records, so identity keying threw away every row's DOM and state and rebuilt it. …"

Attribution-engine only. A `mapArray` / `<For>` update disposed and recreated a set of rows whose items pair up (by `id`/`key`/`_id`, else by position) as shallowly equivalent. Under identity keying this is the re-fetch-returns-new-objects shape: fix by keying on the id (`<For by="id">`), reconciling into a store, or caching by id upstream. When the list _is_ keyed by a function and rows still churn, the key function is unstable (returns a new object, an index, a random) and the message blames it instead. Genuine turnover and small edits never fire it.

### Responsiveness (attribution engine)

These name **holds** — intervals where a user-visible write was withheld because a downstream async source went pending, so the screen kept the old content until the data landed. The runtime is correct; the question is what the user saw meanwhile. Note that INP does not catch a silent hold: the handler finishes fast, nothing changes, the browser presents a frame, and the metric reads as good. This is the dead-click class INP structurally misses; the INP-shaped cost in these tables is `selfMs`/`worstDispatchMs` on interactions.

Thresholds sit at the strict end of the published bands on purpose. The engine measures to the commit, not the paint, so every number is a floor on what the user saw; and dev-time network is usually faster than the field.

#### `SILENT_HOLD`

**Messages:**

- "[click on button#save] wrote [signal] ; the write was held 640ms waiting on [fetch user] and the screen showed nothing for the wait: no `isPending()`/`latest()` reader downstream, no optimistic value, no `affects()` mark, and no effect ran while it was held — the interaction was dead for 640ms. …"
- "[click on button#save] started an action that held [writes] for 640ms … Pair the action with a `createOptimistic`/`createOptimisticStore` write for the expected result, or read `isPending()` where the result renders."

A signal/store write (or an action's writes) was held because a downstream async source went pending, and for the whole hold no acknowledgement was observed: no `isPending()` or `latest()` companion on the held graph that an effect reads (through however many memos — a memo alone is not the screen, so a router's internal `createMemo(() => isPending(location))` counts only once something renders it), no optimistic overlay, no `affects()` declaration, and no lane effect painted while the hold was open. (Mainline effects are stashed while a hold is open, so the only effects that _can_ paint are readers of optimistic values and companions — the screen changing in response to the hold. An unrelated effect cannot clear the verdict; it waits with everything else. A `Loading` boundary that has not revealed yet is a different answer — the read never holds, the fallback shows.) Holds shorter than `holds.infoMs` (default 100ms — RAIL's "feels instant" ceiling) are recorded silently; from `infoMs` the hold emits `info`; from `holds.warnMs` (default 200ms — the INP "good" ceiling) it warns. When the silent hold is also long (below) the message carries the boundary repair and `data.long` is `true`; one hold is one report.

The hold is attributed to its opening interaction when the web runtime can stamp it (`click`, `keydown`, `input` on the element hit), to the effect or action that made the write otherwise. When the held write was a router's navigation declared via `withOrigin`, the hold also carries that `origin` and the message names the route — "[click on a.nav (navigation to /users/:id)] wrote [location] …" — with `data.navigation` giving the pattern, paths and params. `holdMs` runs from the interaction's dispatch or the first parked flush, whichever is earlier (`at` is that instant). Every hold — reported or not — is queryable via `attribution.holds()`; each carries what acknowledged it as `acknowledgements: [{ kind: "isPending", source: "posts", reader: ["<App>", "<Feed>", "spinner"] }]`, where `reader` is the owner path of the effect the census found painting the affordance — which screen answered, not only that one did. `feedback().sources[].acknowledgedBy` ranks them by `kind:source`.

#### `LONG_HOLD`

**Message:** "[click on button#next] wrote [page (1 → 2)]; the screen kept the old content for 1400ms after the last input (2100ms in all) waiting on [posts] — ["isPending:posts"] said it was pending, but the hold ran on well past the point where "loading" over stale content reads as broken. A wait this long is past what a stale screen should carry: show a fallback instead. Put the reader behind a Loading boundary keyed on what changed — `<Loading on={page()} fallback={…}>` — so the write commits at once and the fallback shows where the data lands; a boundary that has already revealed keeps the old content unless `on` changes. …"

The hold _was_ acknowledged and still outlasted what a stale screen should carry. The measure is the hold's quiescent tail — `tailMs`, from the last write to join the hold (the user's final input) to the commit — not its lifetime, so a hold that keeps taking input is judged by each wait rather than the sum. `info` from `longHolds.infoMs` (default 500ms), `warn` from `longHolds.warnMs` (default 1000ms, where RAIL says the user loses the thread).

The design point: a hold is the stale-while-revalidate tool, right when the old screen stays useful for the wait. Past that, the honest UI is a fallback — which a `Loading` boundary provides only when it has not revealed yet or its `on` prop changed; a revealed boundary with no `on` keeps the old content, which _is_ the hold. So the repair is `on`, a fresh boundary, or making the data fast (preload, cache), never removing the acknowledgement. Silent long holds are not double-reported: they stay one `SILENT_HOLD` with the same repair appended. `feedback().sources[].long`/`longMs` counts long tails at the table level, acknowledged or not.

## Programmatic diagnostics API

In dev mode, `OBSERVE.diagnostics` provides two methods for tooling:

### `OBSERVE.diagnostics.subscribe(listener)`

Registers a callback that fires for every diagnostic event. Returns an unsubscribe function.

```js
import { OBSERVE } from "solid-js";

const unsub = OBSERVE.diagnostics.subscribe(event => {
  console.log(`[${event.severity}] ${event.code}: ${event.message}`);
});
// later: unsub();
```

### `OBSERVE.diagnostics.capture()`

Returns a capture object for collecting diagnostics in a scoped region (useful in tests).

```js
const capture = OBSERVE.diagnostics.capture();

// ... code that may emit diagnostics ...

const events = capture.stop();
// events: DiagnosticEvent[]
```

Each `DiagnosticEvent` has:

| Field       | Type                          | Description                                                                                                                  |
| ----------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `sequence`  | `number`                      | Monotonically increasing counter                                                                                             |
| `code`      | `DiagnosticCode`              | Machine-readable code (e.g. `"STRICT_READ_UNTRACKED"`)                                                                       |
| `kind`      | `DiagnosticKind`              | Category: `"strict-read"`, `"async"`, `"write"`, `"lifecycle"`, `"owner"`, `"perf"`, `"graph"`, `"responsiveness"`           |
| `severity`  | `"info" \| "warn" \| "error"` | `error` throws, `warn` logs; `info` is advisory (structured channel only — budget/assertion consumers should not fail on it) |
| `message`   | `string`                      | Human-readable message                                                                                                       |
| `ownerId`   | `string?`                     | ID of the reactive owner where the diagnostic occurred                                                                       |
| `ownerName` | `string?`                     | Debug name of the owner                                                                                                      |
| `ownerPath` | `string[]?`                   | Owner chain root-first (`["<App>", "<TodoRow>", "effect"]`) — the console's `in` line                                        |
| `nodeName`  | `string?`                     | Debug name of the signal/node involved                                                                                       |
| `data`      | `object?`                     | Additional context                                                                                                           |

## Diagnostic codes (quick reference)

| Code                             | Severity  | Category       | Trigger                                                                                                                    |
| -------------------------------- | --------- | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `REACTIVE_WRITE_IN_OWNED_SCOPE`  | error     | write          | Reactive write/invalidation inside component/computation                                                                   |
| `PENDING_ASYNC_UNTRACKED_READ`   | error     | async          | Reading pending async outside tracking scope                                                                               |
| `ASYNC_OUTSIDE_LOADING_BOUNDARY` | warn      | async          | Async computation outside Loading boundary (non-halting; root mount is deferred)                                           |
| `CLEANUP_IN_FORBIDDEN_SCOPE`     | error     | lifecycle      | `onCleanup` inside trackedEffect/onSettled                                                                                 |
| `SETTLED_CLEANUP_UNOWNED`        | error     | lifecycle      | `onSettled` returned a cleanup in an unowned (out-of-band) scope                                                           |
| `STRICT_READ_UNTRACKED`          | warn      | strict-read    | Untracked reactive read in component/effect body                                                                           |
| `PENDING_ASYNC_FORBIDDEN_SCOPE`  | warn      | async          | Pending async read in trackedEffect/onSettled                                                                              |
| `NO_OWNER_EFFECT`                | warn      | lifecycle      | Effect created without reactive owner                                                                                      |
| `NO_OWNER_CLEANUP`               | warn      | lifecycle      | `onCleanup` called without owner                                                                                           |
| `NO_OWNER_BOUNDARY`              | warn      | lifecycle      | Boundary created without owner                                                                                             |
| `RUN_WITH_DISPOSED_OWNER`        | warn      | owner          | `runWithOwner` with disposed owner                                                                                         |
| `HUGE_FAN_OUT`                   | warn      | graph          | One change reached 2000 live subscribers (always on)                                                                       |
| `HUGE_FAN_IN`                    | warn      | graph          | One recompute tracked 2000 sources (always on)                                                                             |
| `HOT_SCOPE_RERUNS`               | warn      | perf           | 120+ re-runs of one scope in 1s (attribution enabled)                                                                      |
| `HOT_SCOPE_FANOUT`               | warn      | perf           | 5+/50+/500+ scopes hot from one root cause (attribution enabled)                                                           |
| `HOT_SCOPE_TIME`                 | warn      | perf           | 8ms+ self-time in one scope in 1s (attribution enabled)                                                                    |
| `WIDE_SCOPE_DEPS`                | warn      | perf           | Scope subscribed to 30+ sources (attribution enabled)                                                                      |
| `WIDE_WRITE`                     | warn      | perf           | Committed write reached 250+ subscribers (attribution enabled)                                                             |
| `ASYNC_WATERFALL`                | info/warn | perf           | 2+/3+ origin-proven sequential async flights (attribution enabled)                                                         |
| `UNSTABLE_MEMO_OUTPUT`           | warn      | perf           | Memo returned a new-but-equivalent container 4+ runs running (attribution enabled)                                         |
| `EFFECT_WRITES_OWN_SOURCE`       | info/warn | perf           | Effect's write provably feeds back into its own inputs; `info` for multi-effect rings (attribution enabled)                |
| `EFFECT_RELAY_TEAR`              | info/warn | perf           | Reader ran twice for one root change because an effect relayed it; `warn` when derivable or repeated (attribution enabled) |
| `IMMUTABLE_UPDATE_IN_STORE`      | warn      | perf           | Store container replaced by a mostly-identical copy (attribution enabled)                                                  |
| `UNSTABLE_LIST_IDENTITY`         | warn      | perf           | `mapArray`/`For` recreated rows for equivalent items (attribution enabled)                                                 |
| `SILENT_HOLD`                    | info/warn | responsiveness | Write held 100ms+/200ms+ by pending async with no on-screen acknowledgement (attribution enabled)                          |
| `LONG_HOLD`                      | info/warn | responsiveness | Acknowledged hold whose tail (last input → commit) ran 500ms+/1000ms+ (attribution enabled)                                |

## Run attribution — "why did this run"

Beyond the always-on diagnostics above, dev and observe builds ship an opt-in **attribution engine** that explains every re-run. The runtime already knows the full dependency graph; enabling attribution stamps each value commit with a change record (a write, an async landing, a `refresh()` invalidation, or a derived change chaining back to its causes), so each re-run reports the chain down to the originating write:

```
[why-run] effect "docTitle" ran (run 4)
  ← memo "userLabel" changed (#6)
    ← signal "notifications" write (#5) 2 → 3
```

The engine is its own entry, `solid-js/attribution` (re-exporting `@solidjs/signals/attribution`), so a build that never imports it never ships it: the runtime carries only the hook slot the engine installs into (`OBSERVE.attribution.install`) and the two declared frames — the interaction frame the web runtime opens around event dispatch (`OBSERVE.attribution.withInteraction`) and the origin frame a router opens around its navigation write (`OBSERVE.attribution.withOrigin`). The import is legal in every tier — the prod tier resolves an inert engine with the same surface, so app code needs no per-tier guard.

### API (`solid-js/attribution`)

```js
import { attribution } from "solid-js/attribution";

attribution.enable({
  log: true,          // pretty-print each re-run (default true)
  stacks: false,      // capture write stacks — slow (default false)
  historyLimit: 200,  // ring buffer size
  hotRuns: { count: 120, windowMs: 1000 },   // or false
  hotTime: { budgetMs: 8, windowMs: 1000 },  // or false
  wideDeps: 30,                               // or false
  unstableMemos: 4,                           // or false
  wideWrites: 250,                            // or false
  waterfalls: { minFlightMs: 50 },            // or false
  holds: { infoMs: 100, warnMs: 200 },        // or false (disables hold tracking)
  longHolds: { infoMs: 500, warnMs: 1000 }    // or false
});

attribution.history();          // ring buffer of RerunEvents
attribution.why(someMemo);      // re-run history for one node
attribution.subscriptions(fn);  // current dep names of one scope
attribution.costs();            // { scopes, writes } ranked cost tables
attribution.waterfalls();       // graph-provable sequential flight chains
attribution.holds();            // every hold, acknowledged or not
attribution.navigations();      // every declared navigation, settled or not (below)
attribution.interactions();     // every user interaction, settled or not (below)
attribution.feedback();         // responsiveness tables (below)
attribution.subscribe(fn);      // live RerunEvent feed — same as subscribe("rerun", fn)
attribution.subscribe("interaction" | "hold" | "navigation", fn); // each record as it settles
attribution.disable();

// Callable anytime (even while disabled): preloaders/caches declare the true
// kickoff of promises they hand out, so dependents that pick them up later
// are never misread as waterfalls.
attribution.markFlight(promise, startedAt?);

// Runtime side (`OBSERVE`, present in dev and observe builds): stamp the
// writes made synchronously inside `fn` with a user interaction. Compiled
// event bindings do this for every handler; custom renderers and test
// harnesses call it themselves. `fn()` when no engine is enabled.
import { OBSERVE } from "solid-js";
OBSERVE.attribution.withInteraction({ type: "click", target: 'button#next "Next →"' }, fn);
// A router declares a navigation around its location write — match eagerly,
// describe by the parametrized route, then write. This is the only
// router-specific line anywhere; the engine knows no router.
OBSERVE
  ? OBSERVE.attribution.withOrigin(
      { kind: "navigation", name: "/users/:id", to, from, params: match.params },
      () => setLocation(to)
    )
  : setLocation(to);
// An external engine (devtools) installs into the same slot the built-in
// one uses: OBSERVE.attribution.install(hooks) / .installed.
// An observer that renders inside the app it watches (an APM adapter's
// panel, devtools) marks its own root so neither channel reports it.
createRoot(() => {
  OBSERVE?.exclude(getOwner());
  /* panel */
});
```

**Records and clocks.** Everything the engine hands out — `RerunEvent`, `InteractionEvent`, `HoldEvent`, `NavigationEvent` — is a record with an absolute `at` on the `performance.now()` clock (`RerunEvent.at` the run's start, `HoldEvent.at` the start of the wait, `NavigationEvent.at`/`InteractionEvent.at` the request/dispatch) plus durations from it (`holdMs`, `settledMs`, `selfMs`). Epoch time for an exporter is `performance.timeOrigin + at` (milliseconds). Without cross-origin isolation the browser quantizes `performance.now()` to 100µs, so a single run's `selfMs` is often `0`; the per-interaction `settledMs` is the wall-clock number to report. Records carry live graph references (`RerunEvent.node`) and the frame objects that join them (`origin`, `interaction`) — the same object across records, so join by identity, not by name. `subscribe(type, listener)` delivers each record synchronously at the moment it is complete (a re-run at recompute end; an interaction, hold or navigation when it settles), bottom-up: a hold before the navigation it held, before the interaction that performed it. A listener runs inside the engine and must not write signals; hand work off to a microtask.

**Excluding the observer.** `OBSERVE.exclude(owner)` marks an owner subtree as the observer's own: diagnostics whose subject sits under it are built (a throwing site still throws) but never delivered or printed, and the attribution engine records no run for its computations, charges none of them to an interaction, and does not spend a once-per-key slot (`IMMUTABLE_UPDATE_IN_STORE`'s per-path memory) on them. Mark the root as it is created, and make writes from outside the graph under it (`runWithOwner(owner, () => setPanel(…))`) so the writer's context is excluded too. `OBSERVE.isExcluded(subject)` answers the question for any owner or node.

`costs()` aggregates since `enable()`: `scopes` ranked by self-time with `wastedMs` (time in runs whose value didn't change — the equality cutoff absorbed them), and `writes` ranked by the total downstream re-run time each root write caused. Overlay work (optimistic-lane and held runs — `phase: "optimistic" | "held"`) is accounted separately as `overlayMs` and never blamed as waste.

### Provenance — "who wrote this"

Every root `ChangeRecord` carries an `origin` describing the imperative frame the write came from, so a cause chain terminates in something a person can act on, not just a signal name:

| `origin.kind` | Meaning                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `interaction` | A user event (`type`, `target`, dispatch time `at`); stamped by the web runtime's event bindings |
| `effect`      | An effect callback (`name`, and the `run` of the compute run it belongs to)                      |
| `action`      | An `action()` body (`name`); an `interaction` field carries the event that invoked it            |
| `async`       | An async landing — the value arrived from a promise or iterable                                  |
| `navigation`  | A router's navigation declared via `withOrigin` (`name` = route pattern, `to`, `from`, `params`) |
| `external`    | Nothing enclosing was known (module scope, a timer, a foreign callback)                          |

Effect- and action-origin writes resolve through the record of the run they belong to, so `RerunEvent.interaction` names the user interaction a re-run ultimately traces to, however many effects relayed it. Writes made after an `await` inside an action's body have left the action's synchronous frame; they are stamped `async`, which is what makes their escape from the transaction visible.

### Navigations (`navigations()`)

A navigation in Solid 2 is a plain write to the location — reads pull the route's async and the runtime holds the write until the data is ready — so the engine already sees everything a navigation costs. What it cannot see is that the writes _were_ a navigation, and to which route. `OBSERVE.attribution.withOrigin({ kind: "navigation", … }, fn)` is where a router says so, around its write; every router (or hand-rolled one) adds that one call, and nothing else anywhere is router-specific. From it the engine keeps one `NavigationEvent` per frame:

- `name`, `to`, `from`, `params`, `at` — what the router described; `interaction` — the link click (or other event) it ran under, when known, including through an action step (`navigate()` after a `yield`).
- `writes` — root writes the frame performed, redirect hops included.
- `settledMs` and `outcome`, once its writes are through: `committed` (a plain drain took them — settle is the end of that drain, the instant the screen had them), `held` (they waited in a transition — settle is its commit, and `hold` carries the `HoldEvent` when hold tracking recorded one), or `superseded` (a later write to the same node replaced them before they landed — the user navigated again).
- `redirects` — present when a guard or loader sent the navigation elsewhere before it landed: the destinations abandoned along the way, in order, each with the time the redirect away from it was declared. `name`/`to`/`params` are then the final destination.
- `origin` — the frame object the writes were stamped with, the same object as `ChangeRecord.origin` on each write and `HoldEvent.origin` on the hold, so records join by identity.

Two things about the frame are read late, on purpose:

- **The ref is re-read at settle.** The engine keeps the object passed to `withOrigin` and copies `name`, `to` and `params` from it again when the navigation settles (and when a hold on it is judged). A router whose match is not final at write time — a lazy route subtree that resolves inside the hold — describes coarsely (`/admin/*`), then assigns the exact pattern and params onto the same object once it knows them; the settled record, the hold's verdict and the feedback row all read the refined name. `from` and `at` are read once, when the frame opens.
- **A redirect is a hop, not a new navigation.** A router declares a redirect with `redirect: n` (`n >= 1`, the hop depth it already tracks). The engine re-enters the pending navigation's frame instead of opening one: the hop's write replaces the pending one with the same origin, so nothing is superseded; the record keeps the user's request time and interaction, so `settledMs` runs from the click, not the hop; the abandoned destination moves to `redirects`. With no pending navigation to fold onto, a `redirect` frame opens a navigation of its own.
- **A router that owns its own async pipeline hands over its completion.** Solid Router's navigation is a location write whose downstream the runtime holds until route data lands, so "writes through" is "navigation done". A router that awaits loaders in its own core (TanStack Router's load transaction: the location moves at once, matches are published only when the loaders resolve) passes `until: promise` on the ref — the engine then waits for it (resolve or reject) as well as for the writes, so `settledMs` covers the router's wait and the interaction that performed the navigation stays open with it. Superseded navigations settle at once regardless of `until`. A router whose request predates its first write passes `at: startedAt` (its own request time, on the `performance.now()` clock) so the span starts at the click rather than at the write. `params` values may be `undefined` (an optional segment left unbound).
- **A router re-enters its navigation to publish.** While the record is open, `withOrigin` with the _same ref object_ re-enters it instead of opening a new navigation (or superseding the first). The publish the router performs when its pipeline resolves — the matches write, in a later task with no interaction of its own — then stamps the same frame: the hold the destination waits in, its blockers and re-runs all land on this record, under the click that started it, rather than on a nameless one. Open the frame around the location write with `until`; re-enter it around the publish. The record settles once, when the promise has settled and the last phase's writes are through, with the outcome the phases earned together (`held` if any phase was) and the last hold. A redirect hop's ref re-enters the same record too. Without `until` the first frame's record settles at its drain, and the same ref afterwards opens a navigation of its own.

A navigation that changed nothing (no write survived the equality gate) settles at once with `writes: 0`. `formatOrigin` renders the kind as `navigation to /users/:id (/users/42)` — after a redirect, `navigation to /login (redirected from /users/42)` — and cause chains under a click read `— navigation to /users/:id (under click on a.nav "Alice")`. `feedback().navigations` folds settled events per route (the final one, after redirects).

Known gap: handlers bound through the runtime (delegated events, and non-literal `on*` expressions that route through `addEvent`) are stamped; a _literal_ function handler compiles to a bare `addEventListener` and is not, so its writes read as `external` until the compiler wraps them too.

### Interactions (`interactions()`)

The interaction is the unit a person experiences: one click, and everything it cost until the screen had the answer. Every downstream fact is already keyed to the interaction frame — writes stamp it, re-runs trace to it through their causes, holds and navigations carry it — and `feedback().interactions` folds those by interaction _name_. `interactions()` keeps one `InteractionEvent` per dispatch instead, with a start, an end, and the pieces attached, so a consumer building a span per interaction (an APM adapter) neither infers the end from an idle gap nor sums quantized per-run times to approximate the wall clock:

- `name`, `target`, `at` — what the runtime described to `withInteraction`; `handlerMs` — the handler itself, dispatch to return.
- `writes` — root writes attributed to the frame: the handler's, and those of frames it opened (a navigation).
- `runs` and `created` — re-runs traced back to it, and computations _created_ in those runs or in its flushes (the "create 1,000 rows" work, which no `RerunEvent` describes); `runMs` sums the self-time of both.
- `holds` — the `HoldEvent`s its writes waited in; `navigations` — the `NavigationEvent`s performed under it. The same objects as in `holds()`/`navigations()`.
- `settledMs` and `outcome`, once everything is through: `idle` (the handler wrote nothing — settles as the frame closes), `committed` (its writes went through in drains no transition held — settles at the end of the last such drain), `held` (at least one write waited in a transition — settles at the last hold's commit). A navigation under it must settle first, so a router's `until` keeps both open.
- `origin` — the frame object every downstream record carries as `interaction`; join by identity.

Runs are counted while the record is open; an async landing the interaction caused that arrives after its writes committed (a fetch behind a `Loading` boundary that showed its fallback) is attributed to it on the `RerunEvent` but is not the interaction's wait — the boundary answered.

### Responsiveness tables (`feedback()`)

`feedback()` is a pure aggregation over `HoldEvent`s and `RerunEvent`s — facts, not verdicts — shaped for an agent to read in one pass:

- `sources`: per set of async sources waited on, `holds`, `heldMs`/`worstMs`, the `silent` subset (no acknowledgement at any duration) with its `silentMs`, `latestOnly` (the only acknowledgement was a `latest()` shadow — the input showed, nothing said "loading"), `long`/`longMs` (holds whose tail reached `longHolds.infoMs`, acknowledged or not — the `LONG_HOLD` shape; `longMs` sums the tails), `acknowledgedBy` ranked by affordance (`isPending:`, `latest:`, `optimistic:`, `affects:` prefixed with the node), the `interactions` and root `writes` that were held, and how many holds an `action` opened or joined.
- `interactions`: per opening interaction (`click on button#next "Next →"`), `dispatches` folded together, the re-`runs` traced back to it with summed `selfMs` and `worstDispatchMs` (the long-flush hazard) beside `holds`, `heldMs`, `silentMs`, and `worstHoldMs` (the silent-hold hazard) — the two INP failure modes as columns of one row.
- `navigations`: per route pattern (`/users/:id`), `navigations` settled, summed `settledMs` and `worstMs`, the `held` subset with its `heldMs` and how many of those were `silent`, `superseded` — navigations the user moved on from before they landed — and `redirected` — navigations a guard or loader sent elsewhere on the way (keyed by where they ended up). The route-level view a router integration used to build itself, from the runtime's own facts.
- `flights`: per async source, flights started, `landed` (with `landedMs`/`worstMs`) and `abandoned` — superseded before landing. A high abandon count is the request-per-keystroke signature.
- `fallbacks`: per `Loading` boundary, `shows`, total `shownMs`, `worstMs`, and `flashes` — fallbacks shown under 150ms, the loading-flash shape.

All tables are sorted worst-first. The `@solidjs/diagnostics` artifact includes `holds` and `feedback` alongside diagnostics and costs, and the browser bridge exposes both as live queries.

### Architecture

The engine is decoupled from the core through a narrow dev-only hook surface (`attribution-hooks.ts`): the core's only obligation is to report true facts (recompute start/end with lane and transition posture, committed writes, async landings, refreshes) at the moments they happen. All semantics — stamps, cause chains, timings, thresholds — live in the engine. Disabled cost is one null check per hook site; production builds fold every site out entirely (the size guard enforces byte-parity).

The same hook surface is the intended substrate for external devtools: install your own `AttributionHooks` implementation instead of the built-in engine — one mechanism, two front-ends.

Naming: attribution output uses debug names from the `name` option on primitives (`createSignal(0, { name: "count" })`); store nodes are named `store.path` automatically while the engine is active. Unnamed nodes fall back to their owner id.
