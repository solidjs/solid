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

#### `ASYNC_STORE_SETTER`

**Message:** "Store setter callback returned a Promise. A store setter is a synchronous transaction: the draft closes when the callback returns, so writes after an `await` are lost. Move the await into an action() and call the setter from there."

A store setter is a synchronous transaction — open the draft, apply the writes, commit and notify once at exit. The callback's return has one meaning, a replacement root to adopt, and a Promise can never be that. An `async` callback (or a sync one whose helper is async) commits only the writes before its first `await`; the rest land on a closed draft and vanish. Dev throws at the setter, after the sync writes have committed. Every store family with a user setter is covered (`createStore`, `createOptimisticStore`, the derived store's manual setter); a derived store's own async compute function is the recompute's business and is not flagged. Store-specific: a signal may legitimately hold a promise, so `setSignal` has no such rule.

```js
// Throws in dev — only `d.n = 1` was in the transaction
setStore(async d => {
  d.n = 1;
  await save(d.n);
  d.n = 2; // closed draft: lost
});

// Fix: orchestrate the async in an action, write synchronously inside it
const bump = action(async function* () {
  setStore(d => {
    d.n = 1;
  });
  await save(1);
  yield;
  setStore(d => {
    d.n = 2;
  });
});
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

#### `PRIMITIVE_IN_FORBIDDEN_SCOPE`

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

#### `ACTION_CALLED_IN_OWNED_SCOPE`

**Message:** "Calling an action inside an owned scope (component, computation) is not allowed. Call it from an event handler or another imperative scope."

An `action()` was invoked from a component body or a computation. Actions are imperative transactions; start them from an event handler, an effect callback, or another imperative scope.

#### `MISSING_EFFECT_FN`

**Message:** "createEffect requires both a compute function and an effect function. Use `createEffect(() => signal(), value => doWork(value))`. …"

`createEffect` was called with one function. There is no single-argument overload: a derived value is `createMemo`, a one-shot side effect is a plain call.

#### `SYNC_NODE_RECEIVED_ASYNC`

**Message:** "A computed/effect created with `sync: true` returned a Promise. The value would be stored as-is and never awaited in production; remove `sync: true` to use async-aware behavior, or unwrap the value before returning."

A `sync: true` computation returned a thenable or async iterable. Sync nodes store what they return; the async machinery never sees it.

#### `INVALID_REFRESH_TARGET`

**Message:** "refresh() expects a Solid source accessor or refreshable store. Pass the original source target, not a wrapper function or derived property read."

`refresh()` was handed something that does not resolve to a source node — a wrapper arrow, a derived read, a plain value.

#### `INVALID_AFFECTS_TARGET`

**Messages:** "affects() takes a single optional key — extra keys are not a path. …" / "affects() keys are only valid on store targets. An accessor is a single slot — pass it alone, or target the store record that owns the property."

`affects()` was given a key path, or a key on an accessor. Mark one slot per call: `affects(record, key)` on a store record, `affects(accessor)` alone.

#### `SETTLE_WALK_UNINITIALIZED_SOURCE`

**Message:** "settlePendingSource was called on a source that never produced a value. Settling parked readers requires truth to reveal — an uninitialized source waking its dependents serves them its initial face instead of settled data."

Internal consistency check on the async settle walk (see `packages/signals/docs/INTERNALS-ASYNC-STATE.md`). Reported, not thrown, in dev; a failure means the runtime contradicted itself, not that app code misbehaved — file it.

#### `REACTIVITY_HALTED`

**Message:** "An uncaught error halted the reactive system. No further updates will be processed. Handle errors with createErrorBoundary/<Errored> or treat this as a crash."

A user error escaped every boundary and the scheduler stopped for good: app state is undefined at that point, so nothing limps on with a half-applied update. Emitted once, on the structured channel and to `console.error`; where the platform has `reportError`, the cause is handed to it as well, so `window.onerror` / error monitoring sees a halt that would otherwise leave a page that looks alive (a throw during the hydration render, #3338). The first write after a halt logs "Update ignored: the reactive system was halted" (once) and does nothing. Production halts the same way — the bare `[REACTIVITY_HALTED]` to `console.error`, the cause to `reportError` — without the structured event. An observability adapter should treat this code as a crash signal. (A failure a boundary _contained_ is the client error hook's — [RFC 03](03-control-flow.md#reporting-what-a-boundary-caught-the-client-error-hook); the halt itself is `reportError`'s.)

#### `INVARIANT_VIOLATION`

**Message:** "[INVARIANT_VIOLATION] <name>: <message>"

A dev-mode internal consistency check failed (`data.invariant` names it; the catalog is in `packages/signals/docs/INTERNALS-ASYNC-STATE.md`). Thrown under `__TEST__` so the suite treats any violation as a hard failure; reported in dev builds so apps degrade instead of crashing. Like `SETTLE_WALK_UNINITIALIZED_SOURCE`, it means the runtime contradicted itself — file it with the reproduction.

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

#### `FLUSH_IN_EFFECT_CALLBACK`

**Message:** "flush() called from inside an effect callback is a no-op: the flush that runs effects is already in progress. Writes made here are processed in the same flush's continuation; to force a drain afterwards, defer it: queueMicrotask(() => flush())."

`flush()` from an effect callback does nothing — the drain that is running the effect will pick up its writes. (From `createTrackedEffect`/`onSettled` the same call throws instead; see "`flush()` inside forbidden scope" above.)

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

### Server rendering (`ssr`, `head`)

The server runtime reports on the same channel. Two groups, two tiers. **Findings** are facts about a render whichever tier is running — an error a boundary contained, work the stream threw away, an error the server-function wire replaced. They ride `OBSERVE.diagnostics` in observe and dev builds (a production observability consumer subscribes to them; in dev they also print) and fold out of prod entirely. **Checks** are guidance for a developer at a console — a write on the server, an invalid preload descriptor — and exist only in the dev build, where they print like any client warning. Every entry carries `ownerPath` when it fired inside a component: on the server the component wrapper labels its owner `<Name>` exactly as the client's does, so `in <App> › <Page>` reads the same on both sides. Codes that already exist on the client (`ASYNC_OUTSIDE_LOADING_BOUNDARY`, `UNRECOGNIZED_INSERT_VALUE`) are shared, not duplicated; `data.side` or the message tells the platforms apart where it matters.

#### `SSR_RENDER_ERROR_CONTAINED`

**Messages:**

- "[SSR_RENDER_ERROR_CONTAINED] Render error caught by <Errored>: Error: …"
- "[SSR_RENDER_ERROR_CONTAINED] Render error in a <Loading> boundary — the fragment rejected and the client re-renders it: Error: …"
- "[SSR_RENDER_ERROR_CONTAINED] Render error in a <Loading> boundary — no boundary could contain it, the request failed: Error: …"
- "[SSR_RENDER_ERROR_CONTAINED] Render error outside any boundary — the request failed: Error: …"

Finding (`error`, observe + dev). A component threw during a server render and the runtime routed the error; `data.handling` says where it went: `"fallback"` — an `<Errored>` rendered its fallback and the response completed normally; `"client"` — the enclosing `<Loading>` fragment rejected and the client re-renders that subtree from scratch after hydration (the response completed, the user paid a client render); `"failed"` — nothing could contain it and the request failed through `onError`. `data.error` is the thrown value as thrown; `ownerPath` locates where it was **thrown** — the labels up the owner chain the error escaped (the component that broke), falling back to the boundary's when the throw crossed no owner — and `data.boundary` / `data.boundaryPath` where it was **met**, the boundary's hydration id and its own labels (what the user saw). This is the structured face of what `renderToStream`'s per-call `onError` receives: the same errors, on the process-wide channel an observer already subscribes to, with the containment named — so a fallback that renders on every request is visible without anyone watching a 200.

#### `SSR_SUBTREE_ABANDONED`

**Message:** "[SSR_SUBTREE_ABANDONED] Fragment 'p0-2' failed with 3 nested fragment(s) and 2 serialized value(s) still pending; the subtree was discarded and the client renders it from scratch."

Finding (`warn`, observe + dev). A fragment failed while descendants of it were still pending, and the renderer discarded them — work already begun (fetches, serialized values) that will never reach the wire, and a subtree the client rebuilds. `data.fragment`, `data.fragments`, `data.serialized`, `data.error`. A leaf fragment's failure alone is `SSR_RENDER_ERROR_CONTAINED`'s finding, not this one; this measures the collateral. Repeated abandonment under one boundary is the cue to move the failing read into its own `<Loading>` so its siblings ship.

#### `SSR_STREAM_ABANDONED`

**Message:** "[SSR_STREAM_ABANDONED] The response stream was abandoned mid-render (consumer) with 4 fragment(s) still pending; the render was torn down."

Finding (`warn`, observe + dev; no `ownerPath` — a stream event). The consumer cancelled (`data.reason: "consumer"`, a `pipeTo` cancellation — usually the browser navigating away) or the sink failed on write (`"sink"`) while fragments were pending, and the render was torn down. `data.shellFlushed` says whether the shell had gone out; `data.pendingFragments` counts what never shipped. Not an error in the app; at volume it is the request cost of renders nobody waited for.

#### `LATE_HEADER_WRITE`

**Message:** "[LATE_HEADER_WRITE] Response header write dropped: headers.set("Set-Cookie") ran after the response head was sent. Write headers before the shell flushes (or before the handler returns)."

Finding (`error`, observe + dev) plus the existing behavior: the dev build **throws** the same message (the throw is the console face; the record is not printed twice), other tiers log it and drop the write. Application code wrote a response header after the head had been flushed — the value was lost, and the response looked fine, which is why a production consumer wants this one counted. `data.method`, `data.name`; `ownerPath` names the component when the write came from inside a late-rendering one. Move the write before the first flush, or before the handler returns.

#### `SERVER_FN_ERROR_SANITIZED`

**Message:** "[SERVER_FN_ERROR_SANITIZED] Server function error replaced with a generic Error before serialization: TypeError: …"

Finding (`error`, observe + dev). A server function threw and the non-dev wire replaced the error with the generic message (RFC 10's sanitization). The client sees the replacement; this record carries the original in `data.error`. Beside the invocation channel's `outcome: "error"` it is the one place the real failure surfaces in production. A value branded with `markSafeError` passes through and is not reported.

#### `SSR_ERROR_SANITIZED`

**Message:** "[SSR_ERROR_SANITIZED] Render error replaced before reaching the client: TypeError: …"

Finding (`info`, observe + dev; channel only). A render failure was about to reach the client through one of SSR's roads — the record an `<Errored>` serializes so the client hydrates the same fallback, a rejected async source serialized into the stream, a `<Loading>` fragment's `_fr` rejection, a frame stream's error chunk (the fragment's, a live hole's, the root's) — and the non-dev wire replaced it with the generic `Error` (`"Internal Server Error"`), the same policy the server-function wire applies (`SERVER_FN_ERROR_SANITIZED`; a `"use server"` function called in-process during SSR never touches that wire, so before this the page load leaked what the RPC withheld — [#3468](https://github.com/solidjs/solid/issues/3468)). The boundary sanitizes _before_ rendering its fallback and serializes the same replacement, so fallback markup and record agree on hydration. Advisory because the failure itself is the `SSR_RENDER_ERROR_CONTAINED` finding's, which carries the original; this is the record of what the wire carried instead — `data.error` the original, `data.wire` the replacement (the generic `Error`, or what the server error hook returned; [RFC 12](12-ssr-http.md#the-server-error-hook-configureservererrors--onservererror)) — once per original however many roads it took. The hook is the prod-tier seam for the same facts; these findings sit above it, recording whatever the wire actually carried. A value branded with `markSafeError` passes through and is not reported; an Error reached as a _value_ — never thrown — is data and passes as the author wrote it (#3113's ruling). The dev build keeps full fidelity.

#### `FRAME_MARKER_CORRUPTED`

**Message:** "[FRAME_MARKER_CORRUPTED] Frame slot range "comment#0" is missing its end marker (<!--slot:comment#0:end-->) among its start marker's siblings. …"

Finding (`error`, observe + dev) on the **client**, from the frames consumer — same channel as the server's findings so a consumer sees the client-detected corruption beside them. The frame HTML the browser parsed has a slot start marker whose end marker is not among its siblings: invalid nesting split the range during parsing (a block element inside `<p>`), or an HTML-rewriting layer (CDN, minifier, translator) removed or moved the comment. `data.slot`, `data.end`. Fix the nesting, and serve frame documents with `Cache-Control: no-transform`.

#### `SERVER_WRITE`

**Messages:**

- "[SERVER_WRITE] Writing a signal on the server is deprecated and will become an error. Server render is pure: state changes flow from async sources (promises, async iterables), never setters — this write landed as inert data (nothing re-renders). …"
- "[SERVER_WRITE] Writing a store on the server is deprecated and will become an error. …"
- "[SERVER_WRITE] Optimistic writes are inert on the server and will become an error. …"

Check (`warn`, dev only; once per process per `data.category`). A setter ran during a server render. The write landed as inert data — nothing re-renders on the server — and the pattern will throw in a later release. Derive the state from its async source (`createStore(fn, seed)`, `createMemo(() => fetch…)`), or, for a subscription, make the subscription the source instead of pushing writes from its callback.

#### `ASYNC_OUTSIDE_LOADING_BOUNDARY` (server)

**Message:** "[ASYNC_OUTSIDE_LOADING_BOUNDARY] ssrSource: "client" read during SSR outside a <Loading> boundary — the server cannot run this source, so a boundary must own the position's fallback. Wrap the read in <Loading>, or declare a loadingValue/seedLoadingValue to render a provisional value instead."

The client's code, `data.side: "server"`, and a hard **error** on the server in every tier (the read throws; the record is wiring, so an observer sees it beside the `SSR_RENDER_ERROR_CONTAINED` it usually becomes). A `ssrSource: "client"` async was read where no `<Loading>` could own the position's fallback.

#### `REVEAL_IN_RENDER_TO_STRING`

**Message:** "[REVEAL_IN_RENDER_TO_STRING] Nested <Reveal> with collapsed/together won't coordinate correctly with renderToString. Use renderToStream for full support."

Check (`warn`, dev only). `renderToString` has no stream to coordinate reveal order on. `data.order`, `data.collapsed`.

#### `ASYNC_WATERFALL` (server)

**Message:** "[ASYNC_WATERFALL] 2 sequential async flights in a <Loading> boundary — 84ms over 3 render passes: each read could start only after the previous one answered. If a later read doesn't need the earlier answer, derive both from the same inputs so they start together; if the dependency is intrinsic, preload the dependent data or join the requests."

The client's code, `data.side: "server"`, `kind: "perf"`; a check (dev only) read off the boundary's facts — the same ones the `"boundary"` record carries (below), no listener needed. A `<Loading>` boundary is rendered in passes: discovery, then one per wait, each pass a read that could only start once the previous pass's async answered — so `passes - 1` is the number of sequential flights, and the proof is exact where the client's is graph-inferred. Same thresholds: two flights (`passes: 3`) are `info`, structured-channel only, since a dependent fetch is sometimes intrinsic; three or more earn the console `warn`. Once per boundary per render. `data.boundary` is the boundary's hydration id (the record's `id`), `data.passes`, `data.sequentialMs` (discovery → settle). Located by component.

#### `SSR_CLIENT_CONTENT_MASKED`

**Message:** "[SSR_CLIENT_CONTENT_MASKED] Client-only content (ssrSource: "client") in a <Loading> boundary surfaced only after 1 server wait (52ms): the boundary streamed its fallback and then handed the subtree to the client, discarding the server's work. Give the client-only content its own <Loading>, or read it before the async data, so the handoff ships with the shell."

Check (`warn`, dev only, `kind: "ssr"`). A boundary whose content turned out to be client-only — a `ssrSource: "client"` read — but only after a real server wait: an async read on an earlier pass masked it. The server did the work, streamed the fallback, then handed the whole subtree to the client anyway, so the work was discarded and the user saw the fallback for the wait's duration before the client rendered. A client-only read found on the **first** pass is the well-behaved case — the boundary hands off with the shell, nothing extra is paid, no finding. `data.boundary`, `data.passes`, `data.durationMs`.

#### `LAZY_ASSET_UNMAPPED`

**Messages:**

- "[LAZY_ASSET_UNMAPPED] lazy() asset resolution failed for "src/Page.tsx": Error: …"
- "[LAZY_ASSET_UNMAPPED] lazy() used in SSR without a moduleUrl and the loaded module has no $$moduleUrl export, so its client assets cannot be resolved — the component will load late during hydration. This is typically injected by the bundler plugin."

Check (`warn`, dev only). A `lazy()` component's client assets could not be resolved for the page — the asset resolver threw (`data.reason: "resolution-failed"`, `data.id`, `data.error`) or the module carries no `$$moduleUrl` (`"no-module-url"`). The page still renders; the component's chunk is not preloaded and loads late during hydration. Usually a bundler-plugin configuration gap.

#### `PRELOAD_DESCRIPTOR_INVALID`

**Message:** "[PRELOAD_DESCRIPTOR_INVALID] registerAsset("preload") requires an as destination." (and the other field rules)

Check (`warn`, dev only). A `registerAsset("preload", …)` descriptor broke a rule — not an object, missing `as`, a non-string or empty `href`, a malformed `imagesrcset`/`imagesizes`/`crossorigin` — and the link was dropped or the field ignored. `data.field` names the field, `data.value` what it held.

#### `HEAD_TAG_INVALID`

**Messages:** "[HEAD_TAG_INVALID] useHead: … is not a head element", "[HEAD_TAG_INVALID] useHead: error evaluating tag props: …", "[HEAD_TAG_INVALID] Multiple <title> tags in one head group; the last one wins." (and the other rules)

Check (`warn`, dev only). A `useHead` registration the render could not honor. `data.reason` names the rule — `non-head-tag`, `invalid-attribute`, `props-error`, `group-error`, `after-shell-flush` (registered once the head had gone out), `outside-render`, `duplicate-title` — and `data.detail` the specifics. The last rule fires on the client too: head resolution is shared code.

#### `UNRECOGNIZED_INSERT_VALUE`

**Message:** "[UNRECOGNIZED_INSERT_VALUE] Unrecognized value. Skipped inserting (object)."

Check (`warn`, dev only; kind `render`; server and client). A value at an insert position the renderer has no rendering for — a plain object, a symbol — was skipped. `data.type`, `data.value`. Usually a component returned where its result was meant, or an object where its property was.

#### `BEHAVIOR_CLAIM_DROPPED`

**Messages:**

- "[BEHAVIOR_CLAIM_DROPPED] A spread on a server-rendered <button> carries `onClick` from client props — spreads don't participate in behavior claims, so this drops. Write the position out: `onClick={props.onSelect}`."
- "[BEHAVIOR_CLAIM_DROPPED] A `onClick` position on a server-rendered element received a server-local function — this handler can never run. …"

Check (`warn`, dev only; server components). A behavior position (an event handler prop) on a server-rendered element received something the wire cannot carry: a client prop through a spread (`data.reason: "spread"` — write the position out) or a function that only exists on the server (`"server-local"` — pass it through the server component's props from the client, or bind a mutation to `action=`).

## Programmatic diagnostics API

In dev and observe builds, `OBSERVE.diagnostics` provides two methods for tooling (and `OBSERVE.exclude`/`isExcluded`, described under attribution, mark an observer's own subtree so neither channel reports it):

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

| Field       | Type                          | Description                                                                                                                   |
| ----------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `sequence`  | `number`                      | Monotonically increasing counter                                                                                              |
| `code`      | `DiagnosticCode`              | Machine-readable code (e.g. `"STRICT_READ_UNTRACKED"`)                                                                        |
| `kind`      | `DiagnosticKind`              | Category: `"strict-read"`, `"async"`, `"write"`, `"lifecycle"`, `"owner"`, `"error"`, `"perf"`, `"graph"`, `"responsiveness"` |
| `severity`  | `"info" \| "warn" \| "error"` | `error` throws, `warn` logs; `info` is advisory (structured channel only — budget/assertion consumers should not fail on it)  |
| `message`   | `string`                      | Human-readable message                                                                                                        |
| `ownerId`   | `string?`                     | ID of the reactive owner where the diagnostic occurred                                                                        |
| `ownerName` | `string?`                     | Debug name of the owner                                                                                                       |
| `ownerPath` | `string[]?`                   | Owner chain root-first (`["<App>", "<TodoRow>", "effect"]`) — the console's `in` line                                         |
| `nodeName`  | `string?`                     | Debug name of the signal/node involved                                                                                        |
| `data`      | `object?`                     | Additional context                                                                                                            |

An event is a serializable record and never carries the node it is about. `OBSERVE.subjectOf(record)` hands the live node back to a consumer that runs in-process — the console reporter uses it to print the DOM element a binding effect writes; devtools use it to go from a record to the scope. It answers for `DiagnosticEvent`s and the attribution engine's `RerunEvent`s, for as long as the caller holds the record object; a copy that left the process and came back has no subject.

### `OBSERVE.records` — the runtimes' records channel

Beside diagnostics (findings) and attribution (re-runs and holds), `OBSERVE` carries **records**: a record is a completed, serializable summary of one thing a runtime did — a boundary that waited, a server-function call, a frame stream — delivered synchronously the moment it is complete, with the live handles an in-process observer may want (the request, the response, the value as thrown) passed **beside** it rather than on it. One channel, `OBSERVE.records`, on both platforms; subscribe by record type, and the types available are whatever the loaded runtimes declared:

```js
import { OBSERVE } from "solid-js";

const off = OBSERVE.records.subscribe("invocation", (event, live) => { … });
OBSERVE.records.observed("invocation"); // true while a listener is subscribed — the emitters' pre-check
```

The channel is `@solidjs/signals`'s, created once per **process** and registered on `globalThis` under `Symbol.for("@solidjs/signals/observe/records")`. Two consequences an observer can rely on: it exists as soon as `import { OBSERVE } from "solid-js"` (or from the core) resolves — an APM's `init()` can subscribe before the runtimes that emit have loaded, and without importing them — and a host that bundles the runtime into its server build and instruments through a `--import`ed module still finds one listener set across both copies. The same registration is how the wire layers emit: `@solidjs/web`'s server-function client is bundled without a framework import (a router or a non-Solid caller can use it), so it reaches the channel by the registered name rather than importing `solid-js`. Same tiers as the rest of `OBSERVE`: present in dev and observe builds, absent in prod — the prod artifacts fold the channel and every emit site out, and an emitter with no listener reads no clock. Listeners are observers: a throwing listener is reported through `console.error` and the call, the render, the stream and the other listeners are unaffected; nothing a listener does reaches the result. This is the seam for tooling that watches the app — APM adapters, devtools — and deliberately not a policy hook: `configureServerFunctionsServer({ wrapInvocation })` remains the single, last-writer-wins wrap around execution for code that must **change** a call, and an observer that installed itself there would either displace the host's policy or be displaced by it. Subscribe here, wrap there.

The types layer the way the packages do, each augmenting only the one beneath it: `@solidjs/signals` declares the catalogue empty — `RecordTypes`, extending `HostRecordTypes`; `solid-js` augments `RecordTypes` with its record (`"boundary"`); `@solidjs/web` augments `HostRecordTypes`, through `declare module "solid-js"`, with what it emits (`"invocation"`, `"call"`, `"frame"`). So `OBSERVE.records.subscribe(…)` types with every loaded runtime's records from a single `solid-js` import, and each interface has exactly one augmenter (TypeScript merges an augmentation onto the declaration its alias resolves to; two packages augmenting one interface through different aliases would not both land). Four records so far.

The **`"boundary"` record** (from `solid-js`, server) is one `<Loading>` boundary that **waited** during a server render:

```js
const off = OBSERVE.records.subscribe("boundary", (event, live) => {
  // event: { id, at, durationMs, heldMs, passes,
  //          outcome: "settled" | "fallback" | "client" | "error",
  //          streamed, revealGroup?, ownerPath? }
  // live:  { error? }
});
```

A boundary whose content rendered on its first pass emits nothing — there was no wait to attribute, the same rule as the client's `hold` records. For one that waited: `id` is the boundary's hydration id, the id the `SSR_RENDER_ERROR_CONTAINED` finding names in `data.boundary`, so a record and a finding pair by it; `at` is `performance.now()` at discovery; `durationMs` runs discovery → settle — to the content being complete, or to the decision that the server will not produce it; `passes` counts render passes over the content (the discovery pass plus one per wait — `2` is one round of async, more is a sequential chain, a read that depended on the answer to the previous one); `streamed` says whether the outcome reached the client after the shell had flushed (the user saw the fallback, then the swap) or in time to inline into it. `outcome` is how it ended: `"settled"` — rendered on the server and swapped in; `"fallback"` — the renderer had no stream to settle into (`renderToString`), the fallback shipped final and the client renders the content; `"client"` — the content is client-only (`ssrSource: "client"`); `"error"` — the content threw, `live.error` is the value as thrown, and the paired finding says where it went. Under a `<Reveal>` group the record names the group and waits for the group's reveal, so `heldMs` is real: how long the finished content sat behind its siblings (`order="together"`, a sequential tail) — `0` for every boundary whose swap was issued as it settled. `ownerPath` locates the boundary by component, the same labels the diagnostics carry. The cost is paid only with a listener installed (or in dev, where the checks below read the same facts): a boundary with none takes no clock readings.

Two dev checks are derived from these facts, so the console and a test's `expectNoDiagnostics` see what an agent would otherwise have to read off the record: `ASYNC_WATERFALL` (server) when `passes - 1` sequential flights reach two, and `SSR_CLIENT_CONTENT_MASKED` when a client-only outcome surfaced only after a wait. Both key by `data.boundary` — the record's `id`.

The **`"invocation"` record** (from `@solidjs/web`, server) is one server-function execution:

```js
const off = OBSERVE.records.subscribe("invocation", (event, live) => {
  // event: { id, direct, at, durationMs, outcome: "ok" | "error", deferred?, boundary? }
  // live:  { event: RequestEvent, request?, args, result? | error? }
});
```

One record per call, delivered when the call **settles** — synchronously for a synchronous direct call, at resolution for a promise. `id` is the function's registered id; `direct` says whether this was an in-process SSR call (`true`, no `request`) or HTTP dispatch (`false`, `request` is the `Request` the handler dispatched). `outcome: "error"` carries the value **as thrown** in `live.error` — the sanitized `Error` the wire gets in production is the client's view, not the observer's. `deferred: true` marks a result the caller drives after the record (a stream or async generator): `durationMs` then measures to the handoff, not to the last chunk. For a direct call made during a `<Loading>` boundary's render pass, `boundary` is that boundary's hydration id — the `"boundary"` record's `id` — so a boundary's wait reads as the server-function calls it consisted of; absent for a call outside any boundary's pass (the shell) and for HTTP dispatch.

The **`"call"` record** (from `@solidjs/web`, client) is one server-function call made from the browser — the invocation's twin, seen from the caller's end:

```js
const off = OBSERVE.records.subscribe("call", (event, live) => {
  // event: { id, at, durationMs, method: "GET" | "POST", outcome: "ok" | "error", status?, origin?, deferred? }
  // live:  { args, response?, result? | error? }
});
```

One record per call, delivered when the caller's await settles: `durationMs` is the request built and sent, the response received and decoded (or claimed by the configured `responseHandler`) — the whole wait the caller saw — so against the server's `"invocation"` of the same `id` the difference is the wire. `method` is `"GET"` for a GET-encoded read (`GET(fn)`), `"POST"` otherwise; `status` is the response's HTTP status once one arrived and absent when the fetch itself rejected (`live.response` likewise). `outcome: "error"` carries the value as thrown to the caller — a decoded server error, or the transport's own failure — in `live.error`. `deferred: true` marks a streaming result (a `live()` source, a generator), timed to handoff. A call an integration answered locally (a handler's `intercept`) made no request and emits nothing. Emitted by the observe and dev artifacts of the server-function client (`@solidjs/web/server-functions/client`, the `observe`/`development` export conditions).

`origin` is what the call ran for, when the attribution engine is enabled and knows: the interaction whose handler made it (`{ kind: "interaction", name: "click", target, at }`), the navigation whose data needed it (`{ kind: "navigation", name: "/users/:id", …, interaction }` — a `createAsync` calling the server inside the recompute the location write caused), an effect or action frame, an async landing's recompute calling again. It is read at dispatch through `OBSERVE.attribution.currentOrigin()` and is the engine's **own** origin object — the same one `InteractionEvent.origin`, `NavigationEvent.origin` and `HoldEvent.origin`/`.interaction` carry — so an observer puts the call under the interaction's record by identity, not by a time window. A call after an `await` in a handler carries none (the escape a write there has); without an engine the field is absent.

The **`"frame"` record** (from `@solidjs/web`, both sides) is one frame stream — a server component rendered to the frame transport ([RFC 11](11-server-components.md)) — from its `start` chunk to its `complete`, as **produced** on the server or as **applied** on the client, `side` saying which:

```js
const off = OBSERVE.records.subscribe("frame", (event, live) => {
  // event: { side: "server", id, version, at, durationMs, shellMs?,
  //          outcome: "complete" | "error", chunks, fragments, slots, regions, errors }
  //     or { side: "client", id, version, at, durationMs, shellMs?, address?,
  //          outcome: "complete" | "truncated" | "error", chunks, fragments, slots, regions, errors }
  // live:  { error?, response? }
});
```

One record per stream, delivered at `complete`. `id` is the frame's on the wire: for a server-function response that is a frame stream (`frameTransformResult`), the function's id — the same `id` the call's `"invocation"` and `"call"` records carry, so all three join by it (the invocation is the execution, the call is the caller's wait, the frame is the response that streamed); for a bare `renderToFrameStream`, what the producer named it or `""`. `at` is `performance.now()` at `start`; `durationMs` runs start → `complete`, the whole stream; `shellMs` runs start → the shell (`html`) chunk — time to first content — and is absent when no shell was produced. The census — `chunks` (everything between `start` and `complete`), `fragments` (`<Loading>` content that settled after the shell), `slots` (render-prop invocations the client fills), `regions` (nested server-content regions: `html` chunks addressed to a child frame id), `errors` (`error` chunks) — is the wire, so a span can carry what the stream was made of, and the two halves share it: a consumer joins them by `id` and `version` and reads the wire as the difference.

The **server half** (`renderServerComponent`, `renderToFrameStream`, the handler path): `version` is what the producer stamped; `outcome` is `"complete"` when the render ran to the end, fragment failures included (those are counted in `errors`, each having revealed its fallback and ridden a keyed `error` chunk), and `"error"` when the render threw synchronously — the stream then carried the failure as its only content and completed anyway, and `live.error` is the value as thrown. `<Loading>` boundaries inside the frame emit their own `"boundary"` records. The **client half** (`applyFrameResponse`): `version` is the consumer's restamp — the number the frame's stale-guard saw — and `address` is the local id the chunks were applied under when the consumer remapped the wire id onto its own boundary (the call's address, for the server-component transport), absent when applied under the wire id; `outcome` is `"complete"` when the `complete` chunk arrived, `"truncated"` when the body ended before it (the connection dropped, the producer abandoned the stream), `"error"` when the read failed (a malformed chunk, a body error) with the failure in `live.error`; `live.response` is the response the stream was read from. A single-flight response carries one stream per frame it refreshed; each is its own record, on both sides. Emitted by the observe and dev artifacts of the frames entry on either platform (`frames/dist/server.observe.js`, `client.observe.js`, and the dev pair).

`@solidjs/diagnostics` folds every record type into the artifact it captures — `artifact.records.{boundary, invocation, frame, call}`, format v7, one table per type, with `artifact.timeOrigin` anchoring every record's `at` — on either platform: `captureArtifact(() => renderToStream(…))` on the server, the browser bridge in the page; so a render's waits and calls and a page's requests are evidence a test or an agent can hold beside the findings. See the package README.

### `OBSERVE.server` — the trace-provider slot

`OBSERVE.server` is an empty slot on the object `@solidjs/signals` ships; `solid-js`'s **server entry** fills it the moment it evaluates, with a container it registers once per process on `globalThis` (under `Symbol.for("solid-js/observe/server")`), so an APM's `init()` that imports only `solid-js` can install a provider before `@solidjs/web` has loaded, and a bundled server build instrumented through a `--import`ed module finds the same provider. The types layer as the records' do: `ServerObserve` is declared empty in `@solidjs/signals`; `solid-js` augments it with `trace: ServerTrace`, declaring the interface; `@solidjs/web` augments `ServerTrace` through `declare module "solid-js"` with the provider it defines. On the client `OBSERVE.server` stays empty.

The one member is the **trace-provider slot**, `OBSERVE.server.trace`:

```js
import { OBSERVE } from "solid-js";

const uninstall = OBSERVE.server.trace.provide(request => {
  // an APM answering from its active span; `request` is undefined for a
  // render outside any request scope
  const span = tracer.activeSpan();
  if (!span) return undefined; // leave the runtime's derivation alone
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    sampled: span.sampled,
    entries: { "sentry-trace": span.toSentryTrace(), baggage: span.toBaggage() }
  };
});
```

The runtime derives a request's trace itself in every tier — the W3C `traceparent` half is core HTTP behavior, see `getTraceContext()` in [RFC 12](12-ssr-http.md#the-trace-the-request-belongs-to-gettracecontext) — and this slot is how an observer overrides or extends that derivation **once, globally**, without a per-request entry point into the host: the provider is asked once per request (or per render), at the first read or at shell flush, and its answer merges over the derivation — fields it returns replace the derived ones, its `entries` merge by name over the runtime's `traceparent`. Everything the runtime emits for the browser (the `Server-Timing` metrics, the shell `<meta>` tags) then reflects the merged context, vendor entries included. One provider at a time — a later `provide` replaces the current one, the single-plugin shape rather than a chain — and a throwing provider is reported through `console.error` with the derivation left standing. A provider should answer **every field its vendor decides, `parentId` included**: the runtime derives `parentId` from the incoming `traceparent`, and a vendor whose browser SDK carries its own span ids on a second header (Sentry's `sentry-trace`) continues from _that_ — a provider answering only `traceId`/`spanId` ships a `parentId` that disagrees with the transaction the vendor records. A provider that answered is also what tells the runtime the trace is being recorded, so it is advertised to the browser even when nothing came in upstream.

## Diagnostic codes (quick reference)

| Code                               | Severity  | Category       | Trigger                                                                                                                    |
| ---------------------------------- | --------- | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `REACTIVE_WRITE_IN_OWNED_SCOPE`    | error     | write          | Reactive write/invalidation inside component/computation                                                                   |
| `ASYNC_STORE_SETTER`               | error     | write          | Store setter callback returned a Promise (setters are synchronous transactions)                                            |
| `PENDING_ASYNC_UNTRACKED_READ`     | error     | async          | Reading pending async outside tracking scope                                                                               |
| `ASYNC_OUTSIDE_LOADING_BOUNDARY`   | warn      | async          | Async computation outside Loading boundary (non-halting; root mount is deferred)                                           |
| `CLEANUP_IN_FORBIDDEN_SCOPE`       | error     | lifecycle      | `onCleanup` inside trackedEffect/onSettled                                                                                 |
| `SETTLED_CLEANUP_UNOWNED`          | error     | lifecycle      | `onSettled` returned a cleanup in an unowned (out-of-band) scope                                                           |
| `PRIMITIVE_IN_FORBIDDEN_SCOPE`     | error     | lifecycle      | Reactive primitive created inside trackedEffect/onSettled                                                                  |
| `ACTION_CALLED_IN_OWNED_SCOPE`     | error     | write          | `action()` invoked from a component body or computation                                                                    |
| `MISSING_EFFECT_FN`                | error     | lifecycle      | `createEffect` called without the effect function                                                                          |
| `SYNC_NODE_RECEIVED_ASYNC`         | error     | lifecycle      | `sync: true` computation returned a Promise / AsyncIterable                                                                |
| `INVALID_REFRESH_TARGET`           | error     | write          | `refresh()` target is not a source accessor or refreshable store                                                           |
| `INVALID_AFFECTS_TARGET`           | error     | write          | `affects()` given a key path, or a key on an accessor                                                                      |
| `REACTIVITY_HALTED`                | error     | error          | Uncaught error escaped every boundary; scheduling stopped (reported, cause to `reportError`)                               |
| `INVARIANT_VIOLATION`              | error     | error          | Internal consistency check failed (throws under `__TEST__`, reported in dev)                                               |
| `SETTLE_WALK_UNINITIALIZED_SOURCE` | error     | lifecycle      | Internal: settle walk reached a source that never produced a value (reported)                                              |
| `STRICT_READ_UNTRACKED`            | warn      | strict-read    | Untracked reactive read in component/effect body                                                                           |
| `PENDING_ASYNC_FORBIDDEN_SCOPE`    | warn      | async          | Pending async read in trackedEffect/onSettled                                                                              |
| `NO_OWNER_EFFECT`                  | warn      | lifecycle      | Effect created without reactive owner                                                                                      |
| `NO_OWNER_CLEANUP`                 | warn      | lifecycle      | `onCleanup` called without owner                                                                                           |
| `NO_OWNER_BOUNDARY`                | warn      | lifecycle      | Boundary created without owner                                                                                             |
| `RUN_WITH_DISPOSED_OWNER`          | warn      | owner          | `runWithOwner` with disposed owner                                                                                         |
| `FLUSH_IN_EFFECT_CALLBACK`         | warn      | lifecycle      | `flush()` from an effect callback (no-op; the drain is already running)                                                    |
| `HUGE_FAN_OUT`                     | warn      | graph          | One change reached 2000 live subscribers (always on)                                                                       |
| `HUGE_FAN_IN`                      | warn      | graph          | One recompute tracked 2000 sources (always on)                                                                             |
| `HOT_SCOPE_RERUNS`                 | warn      | perf           | 120+ re-runs of one scope in 1s (attribution enabled)                                                                      |
| `HOT_SCOPE_FANOUT`                 | warn      | perf           | 5+/50+/500+ scopes hot from one root cause (attribution enabled)                                                           |
| `HOT_SCOPE_TIME`                   | warn      | perf           | 8ms+ self-time in one scope in 1s (attribution enabled)                                                                    |
| `WIDE_SCOPE_DEPS`                  | warn      | perf           | Scope subscribed to 30+ sources (attribution enabled)                                                                      |
| `WIDE_WRITE`                       | warn      | perf           | Committed write reached 250+ subscribers (attribution enabled)                                                             |
| `ASYNC_WATERFALL`                  | info/warn | perf           | 2+/3+ sequential async flights: origin-proven (attribution enabled), or a `<Loading>` boundary's passes (server, dev)      |
| `UNSTABLE_MEMO_OUTPUT`             | warn      | perf           | Memo returned a new-but-equivalent container 4+ runs running (attribution enabled)                                         |
| `EFFECT_WRITES_OWN_SOURCE`         | info/warn | perf           | Effect's write provably feeds back into its own inputs; `info` for multi-effect rings (attribution enabled)                |
| `EFFECT_RELAY_TEAR`                | info/warn | perf           | Reader ran twice for one root change because an effect relayed it; `warn` when derivable or repeated (attribution enabled) |
| `IMMUTABLE_UPDATE_IN_STORE`        | warn      | perf           | Store container replaced by a mostly-identical copy (attribution enabled)                                                  |
| `UNSTABLE_LIST_IDENTITY`           | warn      | perf           | `mapArray`/`For` recreated rows for equivalent items (attribution enabled)                                                 |
| `SILENT_HOLD`                      | info/warn | responsiveness | Write held 100ms+/200ms+ by pending async with no on-screen acknowledgement (attribution enabled)                          |
| `LONG_HOLD`                        | info/warn | responsiveness | Acknowledged hold whose tail (last input → commit) ran 500ms+/1000ms+ (attribution enabled)                                |
| `SSR_RENDER_ERROR_CONTAINED`       | error     | ssr            | Server render error routed by a boundary: `data.handling` fallback / client / failed (observe + dev)                       |
| `SSR_SUBTREE_ABANDONED`            | warn      | ssr            | A failed fragment's pending descendants were discarded (observe + dev)                                                     |
| `SSR_STREAM_ABANDONED`             | warn      | ssr            | Response stream cancelled or sink failed with fragments pending (observe + dev)                                            |
| `LATE_HEADER_WRITE`                | error     | head           | Response header written after the head was sent; dropped (observe + dev; dev throws)                                       |
| `SERVER_FN_ERROR_SANITIZED`        | error     | ssr            | Server-function error replaced with the generic Error on the wire; `data.error` is the original (observe + dev)            |
| `FRAME_MARKER_CORRUPTED`           | error     | ssr            | Frame slot range missing its end marker on the client — nesting or an HTML rewriter (observe + dev)                        |
| `SERVER_WRITE`                     | warn      | write          | Signal/store/optimistic setter ran during a server render; inert, will throw (dev; once per category)                      |
| `REVEAL_IN_RENDER_TO_STRING`       | warn      | ssr            | Nested `<Reveal>` with collapsed/together under `renderToString` (dev)                                                     |
| `SSR_CLIENT_CONTENT_MASKED`        | warn      | ssr            | Client-only content in a `<Loading>` surfaced only after a server wait; the server's work was discarded (dev)              |
| `LAZY_ASSET_UNMAPPED`              | warn      | ssr            | `lazy()` component's client assets could not be resolved for the page (dev)                                                |
| `PRELOAD_DESCRIPTOR_INVALID`       | warn      | head           | `registerAsset("preload")` descriptor broke a field rule; link dropped or field ignored (dev)                              |
| `HEAD_TAG_INVALID`                 | warn      | head           | `useHead` registration the render could not honor; `data.reason` names the rule (dev)                                      |
| `UNRECOGNIZED_INSERT_VALUE`        | warn      | render         | Value at an insert position the renderer cannot render; skipped (dev; server and client)                                   |
| `BEHAVIOR_CLAIM_DROPPED`           | warn      | ssr            | Behavior position on a server-rendered element got a spread prop or a server-local function (dev)                          |

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
attribution.waterfalls();       // graph-provable sequential flight chains
attribution.holds();            // every hold, acknowledged or not
attribution.navigations();      // every declared navigation, settled or not (below)
attribution.interactions();     // every user interaction, settled or not (below)
attribution.subscribe(fn);      // live RerunEvent feed — same as subscribe("rerun", fn)
attribution.subscribe("interaction" | "hold" | "navigation", fn); // each record as it settles
attribution.disable();

// The folds over those records, the point queries and the formatters are
// NAMED EXPORTS, not methods: a fold's module registers its accounting with
// the engine when it is imported, so a consumer that only subscribes to
// records (a production adapter) never ships the tables a console or an
// agent reads — importing `costs` or `feedback` is what turns them on.
import { costs, feedback, why, subscriptions, formatRerun, formatOrigin } from "solid-js/attribution";

costs();                        // { scopes, writes } ranked cost tables (since enable())
feedback();                     // responsiveness tables (below)
why(someMemo);                  // re-run history for one node
subscriptions(fn);              // current dep names of one scope
formatRerun(event);             // the console line for one RerunEvent
formatOrigin(origin);           // `click on button#next "Next →"` — a ChangeOrigin as a name

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
// A runtime recording a fact of its own asks what a write here would be
// stamped with — the engine's own interaction/navigation object, or
// undefined — and puts it on its record (the web runtime's "call" record
// does this at dispatch); an observer then joins the two by identity.
const origin = OBSERVE.attribution.currentOrigin();
// An external engine (devtools) installs into the same slot the built-in
// one uses: OBSERVE.attribution.install(hooks) / .installed. The installed
// hooks are also registered on globalThis under
// Symbol.for("@solidjs/signals/observe/attribution"), the records channel's
// reach for a layer bundled without a framework import.
// An observer that renders inside the app it watches (an APM adapter's
// panel, devtools) marks its own root so neither channel reports it.
createRoot(() => {
  OBSERVE?.exclude(getOwner());
  /* panel */
});
```

**Records and clocks.** Everything the engine hands out — `RerunEvent`, `InteractionEvent`, `HoldEvent`, `NavigationEvent` — is a record with an absolute `at` on the `performance.now()` clock (`RerunEvent.at` the run's start, `HoldEvent.at` the start of the wait, `NavigationEvent.at`/`InteractionEvent.at` the request/dispatch) plus durations from it (`holdMs`, `settledMs`, `selfMs`). Epoch time for an exporter is `performance.timeOrigin + at` (milliseconds). Without cross-origin isolation the browser quantizes `performance.now()` to 100µs, so a single run's `selfMs` is often `0`; the per-interaction `settledMs` is the wall-clock number to report. Records are serializable as emitted: none carries a live graph reference — a re-run names its scope by `nodeId` (the engine's per-node id, stable across the scope's runs in the process, distinct between scopes; in-process consumers get the node back through `OBSERVE.subjectOf(event)`) — while the frame objects that join records (`origin`, `interaction`) are the same object across records in-process, so join by identity there and by `ChangeOrigin.run`/`at`/`name` once they have left it. `subscribe(type, listener)` delivers each record synchronously at the moment it is complete (a re-run at recompute end; an interaction, hold or navigation when it settles), bottom-up: a hold before the navigation it held, before the interaction that performed it. A listener runs inside the engine and must not write signals; hand work off to a microtask.

**Excluding the observer.** `OBSERVE.exclude(owner)` marks an owner subtree as the observer's own: diagnostics whose subject sits under it are built (a throwing site still throws) but never delivered or printed, and the attribution engine records no run for its computations, charges none of them to an interaction, counts no write to its signals or stores toward an interaction, and does not spend a once-per-key slot (`IMMUTABLE_UPDATE_IN_STORE`'s per-path memory) on them. An interaction whose writes all went to excluded subjects, with none of the app's work run — a click on the observer's own panel — is not recorded at all. Mark the root as it is created (a store's nodes take the owner the store was created under, recorded only once the engine is enabled — enable before creating the panel's stores). The signals and stores created under it are excluded subjects wherever their writes come from — a click handler, an adapter callback — so writes need no `runWithOwner`, and must not use one: a write under an owner is a write in an owned scope (`REACTIVE_WRITE_IN_OWNED_SCOPE`). `OBSERVE.isExcluded(subject)` answers the question for any owner or node.

**Values in records — the PII surface.** Records name things (owner paths, `name` options, store paths, route patterns, function ids) and are otherwise numbers, kinds and outcomes; a handful of fields carry _user data_, and an exporter that leaves the process owns scrubbing them (vendors already have the control surface — `beforeSend`, `sendDefaultPii` — and the runtime keeps producing them because they are what makes dev output readable). The complete list: `ChangeRecord.prev`/`value` and `HeldWrite.prev`/`value` — previews of the written values (`preview()`: strings quoted and cut at 40 characters, numbers/booleans verbatim, everything else a type tag such as `Array(12)` or `[Object]`), so the string case is the one to drop or hash unless opted in; `ChangeOrigin.target` (and `InteractionRef.target`) — the element hit, `tag#id "text"` with up to 30 characters of `textContent` for anything that is not an `input`/`textarea`/`select`, so a label but also whatever a `<td>` said; `ChangeOrigin.to`/`from`/`params` and `NavigationEvent.to`/`from`/`params` (`NavigationHop` too) — concrete paths and the values a route pattern bound (`/users/42`, `{ id: "42" }`), while `name` is the pattern; `DiagnosticEvent.message` and `data` for the responsiveness findings (`SILENT_HOLD`, `LONG_HOLD`) — the verdict sentence names the interaction (`click on button#next "Next →"`) and the navigation it was under (concrete `to`/`from`/`params`), and `data.interaction.target` / `data.navigation` carry the same fields structured; no finding quotes a value preview. `data.error` on the server error findings (`SSR_RENDER_ERROR_CONTAINED`, `SSR_ERROR_SANITIZED`, `SERVER_FN_ERROR_SANITIZED`) — the error **as thrown**, message and own properties, deliberately unsanitized: the wire got the generic message so the observer could see the real one, which means a driver's connection string or a query lands here, and an exporter treats it as it treats any captured exception. Dev-only checks may put the offending value on `data` (`PRELOAD_DESCRIPTOR_INVALID`'s `data.value`, `HEAD_TAG_INVALID`'s `data.detail`) — dev tier, never exported. Everything else is safe by construction: `RerunEvent` has names and numbers only; the runtimes' records (`"call"`, `"invocation"`, `"boundary"`, `"frame"`) never put arguments, results, thrown values, requests or responses on the record — those ride the `live` argument beside it, in-process only — and carry ids, methods, addresses, statuses and timings; `ownerPath` is component and primitive names. `stacks: true` adds first-party frames to `ChangeRecord.stack` (file paths, not values) and is a dev affordance to leave off in production.

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
- **One rule for every router: wrap the write whose landing is the destination showing.** Solid Router's navigation is a location write whose downstream the runtime holds until route data lands, so "writes through" is "navigation done" and the frame goes around that write. A router that awaits part of its pipeline outside the graph (TanStack Router's load transaction: the location moves at once, matches are published only when the loaders resolve) wraps the _publish_ instead, and passes `at: startedAt` — the user's request time, on the `performance.now()` clock — so the span starts at the click rather than at the write. The engine has no router-specific seam beyond that: a navigation the router abandons before it publishes is the router's to report, and the wait it owns is inside `settledMs` only through `at`. (Making the loader wait itself part of the transition, so the location write is the one to wrap, is router work — planned for the Solid 2 TanStack adapter, not yet done.) `params` values may be `undefined` (an optional segment left unbound).

A navigation that changed nothing (no write survived the equality gate) settles at once with `writes: 0`. `formatOrigin` renders the kind as `navigation to /users/:id (/users/42)` — after a redirect, `navigation to /login (redirected from /users/42)` — and cause chains under a click read `— navigation to /users/:id (under click on a.nav "Alice")`. `feedback().navigations` folds settled events per route (the final one, after redirects).

Known gap: handlers bound through the runtime (delegated events, and non-literal `on*` expressions that route through `addEvent`) are stamped; a _literal_ function handler compiles to a bare `addEventListener` and is not, so its writes read as `external` until the compiler wraps them too.

### Interactions (`interactions()`)

The interaction is the unit a person experiences: one click, and everything it cost until the screen had the answer. Every downstream fact is already keyed to the interaction frame — writes stamp it, re-runs trace to it through their causes, holds and navigations carry it — and `feedback().interactions` folds those by interaction _name_. `interactions()` keeps one `InteractionEvent` per dispatch instead, with a start, an end, and the pieces attached, so a consumer building a span per interaction (an APM adapter) neither infers the end from an idle gap nor sums quantized per-run times to approximate the wall clock:

- `name`, `target`, `at` — what the runtime described to `withInteraction`; `handlerMs` — the handler itself, dispatch to return.
- `writes` — root writes attributed to the frame: the handler's, and those of frames it opened (a navigation).
- `runs` and `created` — re-runs traced back to it, and computations _created_ in those runs or in its flushes (the "create 1,000 rows" work, which no `RerunEvent` describes); `runMs` sums the self-time of both.
- `holds` — the `HoldEvent`s its writes waited in; `navigations` — the `NavigationEvent`s performed under it. The same objects as in `holds()`/`navigations()`.
- `settledMs` and `outcome`, once everything is through: `idle` (the handler wrote nothing — settles as the frame closes), `committed` (its writes went through in drains no transition held — settles at the end of the last such drain), `held` (at least one write waited in a transition — settles at the last hold's commit). A navigation under it must settle first.
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
