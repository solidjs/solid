# RFC: Dev-mode diagnostics and errors

**Start here:** If you're migrating an app, read the migration guide first: [MIGRATION.md](MIGRATION.md)

## Summary

Solid 2.0 introduces a structured diagnostics system that catches common mistakes at development time. Every diagnostic has a code, severity (`error`, `warn`, or `info`), and actionable message. Errors throw and halt execution; warnings log to the console; `info` events are advisory leads that reach only the structured channel. All diagnostics are stripped from production builds via `_SOLID_DEV_` / `__DEV__` guards.

Diagnostics can also be programmatically observed via `OBSERVE.diagnostics.subscribe()` and `OBSERVE.diagnostics.capture()` for tooling and testing. The `@solidjs/diagnostics` package builds an agent-facing harness on that channel (captured artifacts, budgets, Vitest matchers, a browser bridge); the `reactivity-diagnostics` skill shipped in `solid-js` maps every code to its repair.

## Console addressability

Every console report is one entry built for a human to act on:

- The message, with the code in brackets and the repair in the text.
- An `in` line naming the owners enclosing the subject, root first — component roots as `<Name>`, computations by their `name` option or the `effect`/`computed` default (`in <App> › <TodoList> › <TodoRow> › effect`) — a compiled binding effect reads as what it writes (`span.textContent`, `div.class:active`, a hole `div.children`) when the JSX compiler's `sourceNames.bindings` is on (both `@solidjs/babel-plugin` and `@solidjs/compiler` take the same `sourceNames` option, on by default in dev builds alongside `components`); a primitive reads as the identifier it was declared as (`count`, `doubled`, `todos.title`, `createCounter.value` inside a composed primitive) when `@solidjs/compiler`'s standalone `transformSourceNames` pass has run — primitive naming is not a JSX-transform feature: the build tool applies that pass to every module, `.ts`/`.js` and JSX alike, independently of which JSX compiler handles the file (the Vite plugin's `sourceNames.primitives`, on by default in its dev and `observe` postures; solid-vite-plugin #371) — or as its `name` option otherwise. The same chain is `event.ownerPath` on the structured event. A component's name is the tag as written in source when the JSX compiler's `sourceNames.components` is on (`createComponent(Home, props, "Home")` — on by default in dev builds; the Vite plugin also enables it for the `observe` posture, so minified observe builds still read `<Home>`), otherwise the function's `.name`, which a minifier rewrites and a `lazy()` wrapper hides. Components a library invokes by value rather than by tag (a router rendering a route's `component`) carry only the function name.
- For a compiled JSX binding effect (attribute, class, style, property, spread, insert), the element it writes as a second console argument — hover highlights it on the page, click jumps to it in the Elements panel. The web runtime tags binding effects with their element in dev; the core prints whatever the subject knows.
- The first report of each code ends with a footer `solid-js` registers through an internal seam of the engine (not a public `DEV` method): the installed repair skill path (`node_modules/solid-js/skills/reactivity-diagnostics/SKILL.md`) and the same file's stable GitHub URL anchored to the code's section — `DEV.guideUrl(code)`, the one place that URL is built, so a profiler track's Insights link (in dev) and the console footer agree. Perf, graph, and responsiveness codes add a second line pointing at `attribution.enable()` from `solid-js/attribution` and the `agent-loops` skill in `@solidjs/diagnostics`.

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

#### `LOADING_ON_OUTSIDE_HOLD`

**Message:** "`on` re-armed a Loading boundary, but `comments` is also read outside it and holds the frame: the fallback can never be seen — the frame waits on the very source the boundary is waiting on. Move the outside read under the boundary so one hold owns the data. (Reading `latest()` in `on` shows the fallback now, beside the held frame.)"

**Severity:** `warn` (non-halting)

A `<Loading on={…}>` dependency changed while something under the boundary was pending, so the boundary stopped waiting on its content and staged its fallback. The fallback follows the frame — it lands with the change that caused it — and here that frame waits on the very async source the boundary is waiting on, because a live reader **outside** the boundary also reads it: a sibling `<Loading>` over the same data, an `isPending()` on it in the header, a plain read in the shell. That reader holds the frame until the data lands, so by the time the frame commits the content is ready and the fallback can never be shown. The diagnostic fires once, at the change, and `data.source` names the source.

This is the only shape reported, because it is the only one that is deterministic and structural: no ordering of the flights can show this fallback. A frame held past the content's landing by something _else_ — the write's `action` staying open, other pending data the shell is waiting on — also shows no fallback, but that is a race the fallback may still win (the action ending first, the shell landing first, shows it with the commit), a fallback that loses it is a legitimate outcome, and the engine cannot tell "the action awaited exactly this data" from "the action awaited something slower". Nothing is reported for it.

The frame is holding because the old content is still on screen and still valid; a `Loading` fallback would say it is not. The fix is structural — one hold owns the data:

```jsx
// Warns: B reads the same data() and holds the frame — A's fallback can never show.
<Loading on={id()} fallback={<Spinner />}>{data()}</Loading>
<Loading fallback={<Spinner />}>{data()}</Loading>

// Fix: one boundary owns the read.
<Loading on={id()} fallback={<Spinner />}>{data()} {data()}</Loading>
```

A display-ahead read in `on` — `on={latest(id)}`, `isPending()`, an optimistic signal — is not reported: it says the change is already on screen, so the fallback lands now beside the held frame. That is a capability the diagnostic notes, not the recommended shape: it puts the new page's loading state inside the old page. See [RFC 05](05-async-data.md#loading-on-prop-dependencies-that-show-the-fallback-again).

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

#### `UNTRACKED_READ_AFTER_AWAIT`

**Message:** "[name] was first read after an `await` in an async computation, so it is not a dependency: the computation will not re-run when it changes. Read it before the first `await`, or wrap the read in untrack() if a one-time value is intended."

Only reads made before the first `await` of an async computation are tracked. A signal, memo, or store property first read after it returns its current value, but the computation never re-runs when it changes, so the result goes stale silently.

```js
// Warns: query() is read after the await and never tracked
const items = createMemo(async () => {
  const res = await fetchItems();
  return res.filter(item => item.tag === query());
});

// Fix: read it before the first await
const items = createMemo(async () => {
  const q = query();
  const res = await fetchItems();
  return res.filter(item => item.tag === q);
});
```

A source that was also read before the `await` does not warn, nor does `untrack()`. Each computation warns once per signal or memo, and once per store (naming the first untracked property it reads, at any depth — a row walk such as `items.map(i => i.name)` produces one warning, not one per row; prototype methods such as `map` are ignored). A source that is still loading its first value throws instead, which is a separate error raised when the flight rejects; a source that is refetching serves its old value, so reading it after an `await` warns.

Effect callbacks, cleanups, and `action()` bodies that the continuation itself triggers — by calling `flush()`, `dispose()`, or the action — are not blamed on it: their reads are imperative by design.

**V8 only.** The check attributes a read to its computation through V8's async stack traces (`Error.captureStackTrace` plus the `await` frames V8 records), so it runs on V8 engines — Chromium browsers (Chrome, Edge, Brave, Arc, Electron), Node, Deno, and Bun — and is silent everywhere else (Firefox, Safari, and any SpiderMonkey- or JavaScriptCore-based runtime). Treat it as complementary to a lint rule, not a replacement: a lint rule sees the `await` and the read in the same function body, while this check follows the read into places a lint rule cannot — a sync helper called after the await, an awaited async utility, a `.then` callback, or `Promise.all` — because the runtime, not the source text, knows which computation resumed. Test on a V8 engine at least once.

It covers native Promise computations. Not covered: `async function*` bodies (async-iterable computations are not wrapped, and the engine does not track between-yield reads either), other thenables and Promise subclasses, and a helper returned without `await` (`return load()`). It can occasionally miss a read (a read more than ~40 synchronous frames deep, or a continuation that resumed in the same microtask window as an unowned read that ran first); it never invents one. It is dev-only and adds nothing to production builds.

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

**Message:** "[HUGE_FAN_OUT] Signal "selectedId" changed with 2000 subscribers — every one re-runs this flush. If many independent computations read the same value (for example every row of a list comparing against one selected id), prefer a per-key store or projection so only the items whose result flipped update." (the same text from either reporter; the attribution engine's finding adds `data.write`)

A committed change (a write, a memo's new value, an async landing) reached an unusually large number of live subscribers. This is the signature of many independent computations asking keyed questions of one value — every row of a list comparing itself against one `selectedId` signal. Invert the subscription: keep the answer in a store used as a map keyed by id (`selected[row.id]` rather than `row.id === selectedId()`), so each consumer reads its own key and only the keys that flipped re-run; `createProjection` builds such a map when it is derived from other state.

One code, one threshold story, two reporters. **Always on** wherever the diagnostics channel exists (dev and observe tiers), the core fires from 2000 subscribers: the count is taken by the notification walk the change makes anyway, so it is the live subscriber list at that moment — disposed subscribers don't count — and the core keeps no per-node counter for it (a live edge count was a post-construction field on every node, and forked node shapes). While the **attribution engine** is enabled it reports the same finding from a much lower threshold — `enable({ fanOut })`, default 250 — on the root invalidations it stamps (a signal or store write, a `refresh()`, an async landing), counting the live subscriber list itself on the write, and adds `data.write: "write" | "refresh" | "async"` naming the invalidation; where the per-scope warnings below blame the _reader_, this is the fan-out actually happening, priced at the moment it happens. The engine hands over to the core at 2000, so one change never carries two findings. Either way the finding fires on the change, not on subscription (a fan-out that is never written costs nothing, and one that is re-runs every subscriber right then), once per node, re-warning only once the count has grown by another 500. Unchanged writes never fire it (the source equality gate commits nothing and notifies no one). `data.count` is the subscriber count. `fanOut: false` leaves only the always-on threshold; it is one of the six cost checks `checks: false` folds off.

#### `HUGE_FAN_IN`

**Message:** "Computation [name] tracked N sources. It will re-run when any of them change. …"

One recompute pass tracked an unusually large number of distinct sources (same thresholds as `HUGE_FAN_OUT`; the sources the pass actually tracked, counted once at the end of the pass — repeat reads of the same source excluded). This is the coarse-read signature — e.g. a helper that touches a whole store, or one memo derived from everything. Narrow the read or split the derivation so each computation tracks only what it needs.

Related: `WIDE_SCOPE_DEPS` (below) fires at a much lower threshold, but only while the attribution engine is enabled — it names the offending sources. `HUGE_FAN_IN` is the always-on backstop for the pathological case.

#### `GRAPH_GROWTH`

**Message:** "the live graph grew on 3 consecutive visits to `/orders`: computations 900 → 903 → 906; edges 900 → 903 → 906 (2 roots), across visits to `/orders`, `/`. Each visit left something behind that the next did not reclaim — the shape says an effect or memo created with no owner (a module-level or callback `createEffect`) that only its sources keep alive. Dispose what a visit creates (`onCleanup`, or return the disposer from `onSettled`) and own it under the route's component so leaving the route tears it down."

Attribution-engine only; the leak class a heap snapshot finds, as a finding. At every navigation's settle (`withOrigin({ kind: "navigation" })`) the engine measures the live graph with a **walk**, never a per-node counter: the owner tree from the registered top-level roots (`owners`: roots, component owners, owned computations), then everything reachable from it through the reactive graph — each computation's dependency links (`edges`) and the `signals` and computations they reach, and each reached node's subscriber list, which is how a computation **no owner holds** (a `createEffect` with no owner, kept alive only by the sources it reads) is found and counted in `computations`. It emits a `graph` record (`GraphEvent`: the `GraphSize` fields plus `at`, `route`, `navigation`) for an `OBSERVE.records.subscribe("graph", …)` listener, and keeps the size at each settle of the same route. When any series — `owners`, `computations`, `signals`, `edges` — has climbed on `graphGrowth.visits` consecutive visits (default 3) to `ratio` or more of the first (default 1.25), the route reports, and _which_ series climbed names the leak: `owners` is an undisposed root or a Portal per visit; `computations` with `owners` flat is an ownerless effect; `edges` alone is a subscription per visit to something long-lived. The count is the whole graph's, so a leak shows at every route's settle: the first route to complete its climb reports and `data.routes` names the others seen; the verdict then resets. `data`: `route`, `grew` (the series that climbed), `history` (the `GraphSize` at each settle, oldest first), `roots`, `routes`, `interaction`. No subject.

The observe core's part is the root registry: `createOwner` with no parent registers the root (weakly — a `WeakRef`, reaped by a `FinalizationRegistry` — so an undisposed root nothing references still collects; one a subscription keeps alive is exactly what the walk counts), and its disposal unregisters it. One Set write per top-level root, nothing per node; the walk runs at navigation cadence, only when the check is on or something listens for `graph` records. Measured on the observe artifacts (components of 1 signal, 3 memos, 6 effects): 10k owners walk in 0.6ms, 50k in 3.6ms — a `Set` for the reached nodes is most of it. A reactive node the app's own graph never reaches (an ownerless effect over a signal nothing owned reads) is not counted. `graphSize()` is exported from `solid-js/attribution` for a consumer that wants the measure on its own schedule. `false` disables.

#### `HOT_SCOPE_RERUNS`, `HOT_SCOPE_TIME`, `WIDE_SCOPE_DEPS`

Perf-kind warnings emitted by the **attribution engine** — they only fire while the attribution engine (`solid-js/attribution`) is enabled (see the next section). Defaults:

- `HOT_SCOPE_RERUNS`: one scope re-ran 120+ times within 1000ms (above animation-frame cadence, so a legitimate rAF-driven scope doesn't cry wolf). The message names the most recent cause chain. When many scopes go hot from the _same_ root cause (a selection write re-running every row), only the first warns per-node; the rest fold into `HOT_SCOPE_FANOUT` (below) so one culprit can't bury the console in victim warnings.
- `HOT_SCOPE_TIME`: one scope's summed self-time exceeded 8ms within 1000ms — half a frame in one scope. Catches the few-but-expensive runs that counts miss.
- `WIDE_SCOPE_DEPS`: a scope's dependency count reached 30 (re-warns after another 50% growth), with the source names listed.

All three thresholds are configurable (or disable-able) through `enable()` options.

The write-side fan-out finding is `HUGE_FAN_OUT` (above), which the engine reports from its own lower threshold.

#### `HOT_SCOPE_FANOUT`

**Message:** "N scopes have gone hot (M re-runs) within [window]ms, all driven by [cause] — one hot cause is re-running a large part of the graph. …"

The per-cause aggregate of `HOT_SCOPE_RERUNS`. Hot-scope warnings blame the victim scope; when one hot cause drives many scopes, the first scope to go hot for that root-cause key warns normally and subsequent ones are counted silently, with scope-count milestones (5, then 10×) emitting one escalating fan-out warning that names the shared cause. A genuinely single hot scope behaves exactly as before.

#### `ASYNC_WATERFALL`

**Message:** "N sequential async flights — 'story' (120ms) → 'author' (80ms) — 200ms serialized: each began only after the previous resolved. …"

Attribution-engine only, and the client graph's verdict — the server's `<Loading>` boundary counterpart is its own code, `SSR_BOUNDARY_WATERFALL` (below), because its proof is a different fact. An async flight (a promise or async iterable entering the system) formed a sequential chain behind an upstream flight. A chain link is asserted only on double proof: the flight's recompute was **caused** by the upstream's landing (graph causality — create runs inherit the enclosing recompute's causes, which covers boundary reveals and lazy first pulls), and the flight's **origin** post-dates the upstream's landing. Origin is the earliest provable start of the work: an `attribution.markFlight(promise, startedAt)` stamp (preloaders and request caches declaring their kickoff), first-seen object identity, else registration time — so preloaded work already in the air alongside its upstream is parallel and never chains.

The verdict is duration-gated (each link ≥ `waterfalls.minFlightMs`, default 50ms — a settled cache hit resolves fast and never warns). Depth-2 chains emit at `info` severity on the structured channel only: a dependent fetch is sometimes intrinsic, and an _unmarked_ external preload is indistinguishable from a real waterfall, so the console stays quiet. Depth-3+ escalates to a console `warn`. Once per node, re-warning only when the chain grows. Every graph-provable chain — warned or not — is queryable via `attribution.history("waterfall")`.

If a preloading layer hands out wrapper promises (e.g. `.then()` chains over a cached flight), it must call `markFlight` on the wrapper it returns, with the original kickoff time — wrapping defeats identity tracking otherwise.

#### `UNSTABLE_MEMO_OUTPUT`

**Message:** "memo [name] produced a new-but-equivalent [object/array] on N consecutive runs — its equality gate never closes, so every subscriber re-runs on every upstream change. …"

Attribution-engine only. A memo returned a fresh container that is shallowly equivalent to its previous value on `unstableMemos` consecutive runs (default 4). The equality cutoff that normally absorbs no-op recomputes never fires, so the memo's whole subtree re-runs for nothing. Return stable references (memoize the container, mutate a store) or pass an `equals` option that compares by content.

#### `WASTED_RECOMPUTE`

**Message:** "memo `greeting` re-ran 12 times in 1000ms and 11 of those produced the same value — 9.4ms of compute the equality gate then discarded. Its inputs change without changing its result: put an equality boundary upstream (a memo over the part of the input it reads, or an `equals` on the source), or read a narrower slice (the property, not the object). Latest cause: `user` (write)"

Attribution-engine only; the mirror image of `UNSTABLE_MEMO_OUTPUT`. There the gate never closes; here it closes almost every time: the scope re-ran because an input changed, computed, compared equal to its last value and notified nobody — pure cost. `costs().wastedMs` sums the same fact; this names it while it happens, with the input that keeps triggering it. Fires once per window per scope when, within `wastedRecompute.windowMs` (default 1000ms), the scope ran at least `minRuns` times (5), `ratio` or more of them unchanged (0.8), for `budgetMs` or more of compute in all (2ms). Plain runs only — a held or overlay run may be replayed and is never blamed as waste; a side-effect-only compute (`undefined` output) reports `changed: true` and is exempt (see `RerunEvent.changed`). `data`: `runs`, `wasted`, `wastedMs`, `windowMs`, `causes`. One of the six cost checks `checks: false` folds off.

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

The hold is attributed to its opening interaction when the web runtime can stamp it (`click`, `keydown`, `input` on the element hit), to the effect or action that made the write otherwise. When the held write was a router's navigation declared via `withOrigin`, the hold also carries that `origin` and the message names the route — "[click on a.nav (navigation to /users/:id)] wrote [location] …" — with `data.navigation` giving the pattern, paths and params. `holdMs` runs from the interaction's dispatch or the first parked flush, whichever is earlier (`at` is that instant). Every hold — reported or not — is queryable via `attribution.history("hold")` and delivered on `OBSERVE.records.subscribe("hold", (event, signal) => …)` as it settles, the held signal beside it; each carries what acknowledged it as `acknowledgements: [{ kind: "isPending", source: "posts", reader: ["<App>", "<Feed>", "spinner"] }]`, where `reader` is the owner path of the effect the census found painting the affordance — which screen answered, not only that one did. `feedback().sources[].acknowledgedBy` ranks them by `kind:source`. The engine's verdicts are stamped on the record at settle: `HoldEvent.silent` (nothing painted and no acknowledgement — duration-free; `SILENT_HOLD` is this above `holds.infoMs`) and `HoldEvent.long` (the tail reached `longHolds.infoMs`, with long-hold reporting on), so a consumer applies the engine's own tiering rather than a threshold of its own, in-process or offline.

#### `LONG_HOLD`

**Message:** "[click on button#next] wrote [page (1 → 2)]; the screen kept the old content for 1400ms after the last input (2100ms in all) waiting on [posts] — ["isPending:posts"] said it was pending, but the hold ran on well past the point where "loading" over stale content reads as broken. A wait this long is past what a stale screen should carry: show a fallback instead. Put the reader behind a Loading boundary keyed on what changed — `<Loading on={page()} fallback={…}>` — so the write commits at once and the fallback shows where the data lands; a boundary that has already revealed keeps the old content unless `on` changes. …"

The hold _was_ acknowledged and still outlasted what a stale screen should carry. The measure is the hold's quiescent tail — `tailMs`, from the last write to join the hold (the user's final input) to the commit — not its lifetime, so a hold that keeps taking input is judged by each wait rather than the sum. `info` from `longHolds.infoMs` (default 500ms), `warn` from `longHolds.warnMs` (default 1000ms, where RAIL says the user loses the thread).

The design point: a hold is the stale-while-revalidate tool, right when the old screen stays useful for the wait. Past that, the honest UI is a fallback — which a `Loading` boundary provides only when it has not revealed yet or its `on` prop changed; a revealed boundary with no `on` keeps the old content, which _is_ the hold. So the repair is `on`, a fresh boundary, or making the data fast (preload, cache), never removing the acknowledgement. Silent long holds are not double-reported: they stay one `SILENT_HOLD` with the same repair appended. `feedback().sources[].long`/`longMs` counts long tails at the table level, acknowledged or not.

#### `UNTRACKED_ASYNC_HANDLER`

**Message:** "[click on button#save]'s handler awaited for 430ms after returning and wrote nothing before the await, so nothing on screen could show the wait and no hold was opened for the engine to judge — the interaction was dead for 430ms. Make the async work an `action()`: its steps stay attributed to this click across yields, the writes it makes are held and the hold is judged (`SILENT_HOLD`). Or write the pending state before the await — a `createOptimistic(false)` "saving" flag the UI reads."

The dead click that is not a hold. `onClick={async () => setResult(await save())}` returns a promise and continues past the interaction frame; the handler made no root write before its first `await`, so no hold opened, nothing could acknowledge one, and the engine's other verdicts never see the wait. `withInteraction` hands the handler's return value to the engine (`interactionEnd(returned)`); a thenable keeps the `InteractionEvent` open until it settles (either way — a rejection ended the wait too), capped at `ASYNC_HANDLER_CAP_MS` (10s) so a promise that never settles cannot pin a record. The record then carries `continuationMs` (handler return → settle) and `settledMs` covers it, so a consumer's interaction span spans the wait the person experienced. The continuation runs with no frame on the stack, so writes it makes are _not_ attributed to the interaction — only its duration is; the join for work dispatched synchronously in the handler (a `"call"` record's `origin`) is unchanged.

The finding fires at settle when the handler took no other road: no root write before returning (a write is the acknowledgement — a pending flag, an optimistic value — and its hold, if any, is judged by `SILENT_HOLD`), and no `action()` step under the frame (an action's steps stay attributed across yields and its holds are judged). Same thresholds as holds — it is the same wait: `info` from `holds.infoMs` (100ms), `warn` from `holds.warnMs` (200ms); off with `holds: false`. `data`: `interaction` (`type`, `target`), `continuationMs`, `capped`. No subject: an interaction has no node.

#### `ABANDONED_FLIGHTS`

**Message:** "`"posts"` abandoned 3 flights in 1000ms (`keydown on input#search` started the first): each was superseded by the next before it landed, so every input asked again and the answers were discarded. Put a debounced or equality-gated derivation between the input and the fetch, or key the fetch on what changes rather than on every keystroke; a preload the flights share (`markFlight`) reads as one flight, not many."

The request-per-keystroke signature `feedback().flights[].abandoned` counts, as a finding while it happens. One async source abandoned `abandonedFlights.count` flights (default 3) within `windowMs` (default 1000ms) — each superseded by the node's next flight before it landed. `warn`, once per window per source; the window lives in the engine, not on the node. `data`: `source`, `abandoned`, `windowMs`, `interaction` (the one whose write started the flight that was abandoned, when known). Subject: the async node. `false` disables.

#### `FALLBACK_FLASH`

**Message:** "`click on button#next`: the Loading fallback at `<App> › <Feed>` showed for 40ms — a spinner that appeared and vanished, feedback for a wait too short to need it. Preload or cache the data so it is there before the boundary asks, or lift the read above the boundary; a fallback under 150ms reads as a flicker."

The other end of the `SILENT_HOLD` spectrum: too much feedback for too little wait. A `Loading` boundary's fallback was displayed (timed from the drain that rendered the swap, as the `fallback` record and `feedback().fallbacks[].flashes` are) and hidden again inside `FALLBACK_FLASH_MS` (150ms, exported). `info`, one per flash, structured channel only. `data`: `shownMs`, `interaction`. Subject: the boundary's subtree, so `ownerPath` names the boundary. `fallbackFlashes: false` disables; the fold's count is unaffected.

#### `STACKED_HOLDS`

**Message:** "3 interactions queued behind one hold waiting on `posts` for 640ms: the person kept clicking while the first answer was in the air, and every repeat waited on the same source. Acknowledge the wait where the control is (`isPending()` to disable or dim it) so the repeats stop, or debounce the input; the hold itself is judged by `SILENT_HOLD`/`LONG_HOLD`."

When a hold commits, `stackedHolds.count` or more interactions (default 3) were waiting in it — the person clicked or typed again while the first answer was still in the air, and the runtime folded every repeat into the same wait. The pile is the symptom; the hold's own verdict is the cause, so the repair is the acknowledgement plus a control that does not accept the repeat. `warn`, once per hold. `data`: the hold's data (`holdMs`, `blockers`, `heldWrites`, `interaction`, `navigation`) plus `interactions`, the count. Subject: the first held write's node. `false` disables.

#### `OPTIMISTIC_REVERTED`

**Message:** "the optimistic value of `status` showed "saved"; it reverted to "idle". The person saw the guess, then the correction. A revert on failure is the feature; one that recurs says the guess is wrong for this input or the action fails often — show the failure where the value renders (the action's catch, an `Errored` boundary) rather than letting the value snap back on its own."

An optimistic override (`createOptimistic`) the screen displayed was replaced by a different value. Two roads, named in `data.how`: `reverted` — nothing new landed and the override lifted back to the committed value it covered (the action failed, or never wrote what it promised); `superseded` — an authoritative value landed that differs from the guess (the server counted differently), and tracked readers re-derived to it. Both are correct by construction — the override reverting _is_ the feature — so the finding is `info`, structured channel only, always on while the engine is enabled: a count that grows for one source is what says the guess or the failure rate is wrong. Judged by the node's own `equals`, so a structurally equal correction is silent. The runtime's own optimistic nodes are never judged: an `isPending()`/`latest()` companion is an optimistic signal that goes `true` while pending and back to `false` at commit by design — the acknowledgement `SILENT_HOLD` asks for — and a derived override promotes rather than reverts; the check skips them by the same predicate the hold census uses. `optimisticReverts: false` disables. `data`: `source`, `shown`, `truth` (previews, 40 characters), `how`. Subject: the node, so `ownerPath` locates it. Not yet covered: optimistic _stores_ (`createOptimisticStore`), whose overlay folds off per path; and the interaction that wrote the guess (optimistic writes are not stamped with an origin today).

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

Finding (`warn`, observe + dev; no `ownerPath` — a stream event). The consumer cancelled (`data.reason: "consumer"`, a `pipeTo` cancellation — usually the browser navigating away), the sink failed on write (`"sink"`), or the request's `signal` aborted (`"signal"` — `renderToStream`'s `signal` option; how a frame-stream response, whose render never touches the document writable, learns its reader is gone, from its body's `cancel` or the request's abort) while fragments were pending, and the render was torn down. `data.shellFlushed` says whether the shell had gone out; `data.pendingFragments` counts what never shipped. Not an error in the app; at volume it is the request cost of renders nobody waited for.

#### `LATE_HEADER_WRITE`

**Message:** "[LATE_HEADER_WRITE] Response header write dropped: headers.set("Set-Cookie") ran after the response head was sent. Write headers before the shell flushes (or before the handler returns)."

Finding (`error`, observe + dev) plus the existing behavior: the dev build **throws** the same message (the throw is the console face; the record is not printed twice), other tiers log it and drop the write. Application code wrote a response header after the head had been flushed — the value was lost, and the response looked fine, which is why a production consumer wants this one counted. `data.method`, `data.name`; `ownerPath` names the component when the write came from inside a late-rendering one. Move the write before the first flush, or before the handler returns.

#### `SERVER_ERROR_SANITIZED`

**Messages:**

- "[SERVER_ERROR_SANITIZED] Server function error replaced with a generic Error before serialization: TypeError: …" (`data.source: "server-function"`)
- "[SERVER_ERROR_SANITIZED] Render error replaced before reaching the client: TypeError: …" (`data.source: "ssr"`)

Finding (observe + dev; channel only). One policy — the wire got the generic `Error` (`"Internal Server Error"`), the observer sees the real failure — on two roads, told apart by `data.source`; `data.error` is the original on both, `data.wire` what replaced it (the generic `Error`, or what the server error hook returned; [RFC 12](12-ssr-http.md#the-server-error-hook-configureservererrors--onservererror)). A value branded with `markSafeError` passes through on either road and is not reported. The dev build keeps full fidelity and records nothing.

`"server-function"` (`error`): a server function threw and the non-dev wire replaced the error with the generic message (RFC 10's sanitization). The client sees the replacement; beside the invocation channel's `outcome: "error"` this record is the one place the real failure surfaces in production — which is why this road is `error` where the other is advisory.

`"ssr"` (`info`): a render failure was about to reach the client through one of SSR's roads — the record an `<Errored>` serializes so the client hydrates the same fallback, a rejected async source serialized into the stream, a `<Loading>` fragment's `_fr` rejection, a frame stream's error chunk (the fragment's, a live hole's, the root's) — and the non-dev wire replaced it, the same policy the server-function wire applies (a `"use server"` function called in-process during SSR never touches that wire, so before this the page load leaked what the RPC withheld — [#3468](https://github.com/solidjs/solid/issues/3468)). The boundary sanitizes _before_ rendering its fallback and serializes the same replacement, so fallback markup and record agree on hydration. Advisory because the failure itself is the `SSR_RENDER_ERROR_CONTAINED` finding's, which carries the original; this is the record of what the wire carried instead, once per original however many roads it took. The hook is the prod-tier seam for the same facts; these findings sit above it, recording whatever the wire actually carried. An Error reached as a _value_ — never thrown — is data and passes as the author wrote it (#3113's ruling).

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

#### `SSR_BOUNDARY_WATERFALL`

**Message:** "[SSR_BOUNDARY_WATERFALL] A <Loading> boundary took 3 render passes — 2 sequential async waits, 84ms end to end: each read could start only after the previous one answered. If a later read doesn't need the earlier answer, derive both from the same inputs so they start together; if the dependency is intrinsic, preload the dependent data or join the requests."

Check (`kind: "ssr"`, dev only) read off the boundary's facts — the same ones the `"boundary"` record carries (below), no listener needed. A `<Loading>` boundary is rendered in passes: discovery, then one per wait, each pass a read that could only start once the previous pass's async answered — so `passes - 1` is the number of sequential waits, and the proof is exact: the pass structure IS the chain. The client's `ASYNC_WATERFALL` states a different fact (a graph-inferred, origin-proven chain of flights, duration-gated, with `markFlight` as its escape hatch), so it keeps its own code; a budget keyed by code tells the two apart. Same thresholds: two waits (`passes: 3`) are `info`, structured-channel only, since a dependent fetch is sometimes intrinsic; three or more earn the console `warn`. Once per boundary per render. `data.boundary` is the boundary's hydration id (the record's `id`), `data.passes`, `data.sequentialMs` (discovery → settle). Located by component.

#### `SSR_CLIENT_CONTENT_MASKED`

**Message:** "[SSR_CLIENT_CONTENT_MASKED] Client-only content (ssrSource: "client") in a <Loading> boundary surfaced only after 1 server wait (52ms): the boundary streamed its fallback and then handed the subtree to the client, discarding the server's work. Give the client-only content its own <Loading>, or read it before the async data, so the handoff ships with the shell."

Check (`warn`, dev only, `kind: "ssr"`). A boundary whose content turned out to be client-only — a `ssrSource: "client"` read — but only after a real server wait: an async read on an earlier pass masked it. The server did the work, streamed the fallback, then handed the whole subtree to the client anyway, so the work was discarded and the user saw the fallback for the wait's duration before the client rendered. A client-only read found on the **first** pass is the well-behaved case — the boundary hands off with the shell, nothing extra is paid, no finding. `data.boundary`, `data.passes`, `data.durationMs`.

#### `SSR_UNDECLARED_LIVE_SOURCE`

**Message:** "[SSR_UNDECLARED_LIVE_SOURCE] An async iterable read in a server component is still producing 5s into a document render: the document stays open for as long as it does. Declare the server function live(...) so the document takes the source's first value and the client connects for the rest, or bound the source."

Check (`warn`, dev only, `kind: "ssr"`). The safety cap of RFC 11 §9.5 (Server face 4), resolved as a fixed dev-only check rather than a knob. A server component rendered into a **document** (not a frame stream) read an async iterable that was still producing five seconds later: an undeclared unbounded source pumps its yields into the document's live-hole channel and holds the document open for as long as it produces. A component declared `live(...)` never gets here — under the live scope every async source takes its first value into the markup and is closed; the client connects for the rest after hydration — so a pump still open this long is the authoring error the check names. Once per source per render. `data.afterMs`. Located by owner. Frame-stream renders (a `live` connection, a `renderServerComponent` response) are never judged: an unbounded source is what they are for.

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

#### `UNSCOPED_HOLE_ALLOCATED_IDS`

**Message (server):** "[UNSCOPED_HOLE_ALLOCATED_IDS] A JSX hole received `renderHead` instead of a value, and calling it built hydratable content. The hole is unscoped, so that content took ids from the enclosing scope's counter: the server evaluated it at 2 (→ 3), after the scoped holes that follow it had reserved theirs, but it was registered at 1, where the client builds it in place. The hydration keys of this hole's content and of the holes after it permute between server and client. Pass the built value — call it at the hole (`{renderHead()}`) or assign the result first — rather than the function; a function is not a JSX.Element, so this shape is reached only from JavaScript or through a cast."

**Message (client):** "… The hole is unscoped, so that content took ids from the enclosing scope's counter: the client built it in place at 1 (→ 2) and its content missed its server-rendered keys, because the server evaluates it after the scoped holes that follow it. …"

Check (`warn`, dev only; kind `render`; server render and client hydrate; once per hole site). A hole the compiler left unscoped evaluated to a **function**, and calling it built hydratable content at a counter position the other side does not share. The compiler scopes every child hole that could build JSX (`_$scope`, #3567): the scope reserves one slot at registration and nests the content under it, so server and client agree on every key however late the content resolves. The one shape it cannot see is a bare identifier bound to a function — `const renderHead = () => props.header; <div>{renderHead}</div>` — which is a value to the compiler and a thunk to the runtime. Unscoped, its content takes ids from the parent's counter where each runtime happens to evaluate it: the client's `insert` at the statement, the server's `ssr()` inside the walk after every scoped sibling reserved its slot — the keys permute, the client builds detached copies, handlers land on nodes the user cannot see. `JSX.Element` excludes functions in 2.0, so type-checked code cannot write this hole; by ruling it is **not** scoped (no production cost for a shape the types reject), and this check is what catches it — from JavaScript or through a cast.

Unscoped allocation alone is not the finding: a function hole with nothing scoped after it in its template lands on the same ids on both sides and stays silent. (An `<Errored>` zero-arity `fallback={() => <Fallback />}` thunk used to be the common instance — handed back unresolved and built by the consuming hole; `<Errored>` now calls a function-valued fallback inside its own scope whatever its arity, so that shape never reaches a hole.) Each side reports the permutation it can see. The server records the counter's next id when the hole was registered (`data.registered`, argument evaluation — where the client builds it) and around its evaluation in the walk (`data.before` → `data.after`), and reports when the hole allocated at a shifted position; `data.hole` is the hole's position in its template. The client always builds in place, so it reports when the content built inside an unscoped function hole moved the counter **and** missed a server-rendered key (`Hydration key miss …` is the symptom; this is the cause). `data.name` is the function (when it has one). Scoped holes, memo and component accessors, `children()`, `<For>` rows and the runtime's own children inserts (`spread`, `Portal`) never raise it. Fix: call the function at the hole (`{renderHead()}` — a call hole is scoped on both sides) or pass the built value.

#### `BEHAVIOR_CLAIM_DROPPED`

**Messages:**

- "[BEHAVIOR_CLAIM_DROPPED] A spread on a server-rendered <button> carries `onClick` from client props — spreads don't participate in behavior claims, so this drops. Write the position out: `onClick={props.onSelect}`."
- "[BEHAVIOR_CLAIM_DROPPED] A `onClick` position on a server-rendered element received a server-local function — this handler can never run. …"

Check (`warn`, dev only; server components). A behavior position (an event handler prop) on a server-rendered element received something the wire cannot carry: a client prop through a spread (`data.reason: "spread"` — write the position out) or a function that only exists on the server (`"server-local"` — pass it through the server component's props from the client, or bind a mutation to `action=`).

## Programmatic diagnostics API

In dev and observe builds, `OBSERVE.diagnostics` provides two methods for tooling (and `OBSERVE.exclude`/`isExcluded`, described under attribution, mark an observer's own subtree so neither channel reports it; `OBSERVE.ownerPath(subject)`, below, is the labelling the channel's events carry, for a consumer that holds a live handle):

### `OBSERVE.diagnostics.subscribe(listener)`

Registers a callback that fires for every diagnostic event, with the live node the event is about (when the emitter located one) as its second argument. Returns an unsubscribe function.

```js
import { OBSERVE } from "solid-js";

const unsub = OBSERVE.diagnostics.subscribe((event, subject) => {
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

### `DEV.guideUrl(code)`

Dev builds only. The repair guide's section for a code — the `reactivity-diagnostics` skill's stable GitHub URL, anchored to the code (`…/SKILL.md#strict_read_untracked`). One place builds it: the console footer's "learn more" line and the profiler track's Insights link (`learnMoreUrl`, in dev) both read it, so a tool that renders findings elsewhere links to the same text. Dev-tier rather than observe because it is guidance for a developer, and the URL string on a retained object would be a cost every observe build paid.

### `OBSERVE.ownerPath(subject)`

The owner chain of a live owner or node, root first, as the events carry it (`["<App>", "<TodoRow>", "effect"]` — `event.ownerPath` on a finding, the `ownerPath` field on a record); `undefined` for `null`/`undefined` and for a subject with no named owner above it. For a consumer holding the live handle the channel passed beside an event — the profiler track labelling a span by the computation it received — rather than a copy that already left the process, which carries the path itself.

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

An event is a serializable record and never carries the node it is about. The live node arrives **beside** it instead, as the listener's second argument — `OBSERVE.diagnostics.subscribe((event, subject) => …)` for findings, `OBSERVE.records.subscribe(type, (event, live) => …)` for records — for a consumer that runs in-process: the console reporter uses it to print the DOM element a binding effect writes; devtools use it to go from a record to the scope. `subject` is `undefined` for a finding with no location (an interaction has no node) or a host finding whose owners are not signals' owners; `live` is what the record type declares (the computation for a re-run, the held signal for a hold, nothing for a flush). A copy of the event that left the process and came back has no subject: the handle was never on it.

### `OBSERVE.records` — the runtimes' records channel

Beside diagnostics (findings), `OBSERVE` carries **records**: a record is a completed, serializable summary of one thing a runtime did — a boundary that waited, a server-function call, a frame stream — or the attribution engine saw — a re-run, a hold, an interaction — delivered synchronously the moment it is complete, with the live handles an in-process observer may want (the request, the response, the value as thrown, the node that ran) passed **beside** it rather than on it. One channel, `OBSERVE.records`, on both platforms, for the runtimes' records and the engine's alike; subscribe by record type, and the types available are whatever the loaded runtimes declared:

```js
import { OBSERVE } from "solid-js";

const off = OBSERVE.records.subscribe("invocation", (event, live) => { … });
OBSERVE.records.observed("invocation"); // true while a listener is subscribed — the emitters' pre-check
```

The channel is `@solidjs/signals`'s, created once per **process** and registered on `globalThis` under `Symbol.for("@solidjs/signals/observe/records")`. Two consequences an observer can rely on: it exists as soon as `import { OBSERVE } from "solid-js"` (or from the core) resolves — an APM's `init()` can subscribe before the runtimes that emit have loaded, and without importing them — and a host that bundles the runtime into its server build and instruments through a `--import`ed module still finds one listener set across both copies. The same registration is how the wire layers emit: `@solidjs/web`'s server-function client is bundled without a framework import (a router or a non-Solid caller can use it), so it reaches the channel by the registered name rather than importing `solid-js`. Same tiers as the rest of `OBSERVE`: present in dev and observe builds, absent in prod — the prod artifacts fold the channel and every emit site out, and an emitter with no listener reads no clock. Listeners are observers: a throwing listener is reported through `console.error` and the call, the render, the stream and the other listeners are unaffected; nothing a listener does reaches the result. Delivery allocates nothing — the channel keeps one listener array per type, replaced (never mutated) on subscribe and unsubscribe, so an emit in progress finishes over the array it started with and a listener unsubscribing mid-delivery neither skips nor double-calls anyone that round. A subscription is the channel's, not any emitter's: it outlives the attribution engine's `enable()`/`disable()` cycles and is dropped only by the function `subscribe` returned. This is the seam for tooling that watches the app — APM adapters, devtools — and deliberately not a policy hook: `configureServerFunctionsServer({ wrapInvocation })` remains the single, last-writer-wins wrap around execution for code that must **change** a call, and an observer that installed itself there would either displace the host's policy or be displaced by it. Subscribe here, wrap there.

The types layer the way the packages do, each augmenting only the one beneath it: `@solidjs/signals` declares `RecordTypes`, extending `HostRecordTypes`, with the attribution engine's ten entries on it directly — the engine ships in that package, behind its own entry — `rerun`, `create`, `effect`, `flush`, `flight`, `fallback`, `interaction`, `hold`, `navigation`, `graph`; `solid-js` augments `RecordTypes` with its records (`"boundary"`, `"recovery"`); `@solidjs/web` augments `HostRecordTypes`, through `declare module "solid-js"`, with what it emits (`"invocation"`, `"render"`, `"call"`, `"frame"`). So `OBSERVE.records.subscribe(…)` types with the engine's records and every loaded runtime's from a single `solid-js` import, and each interface has exactly one augmenter (TypeScript merges an augmentation onto the declaration its alias resolves to; two packages augmenting one interface through different aliases would not both land). Six runtime records so far, beside the engine's ten (described under [Run attribution](#run-attribution--why-did-this-run); none is emitted until `attribution.enable()`). `OBSERVE.records.observed(type)` is the one gate an emitter of either kind consults before building a record.

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

Two dev checks are derived from these facts, so the console and a test's `expectNoDiagnostics` see what an agent would otherwise have to read off the record: `SSR_BOUNDARY_WATERFALL` when `passes - 1` sequential waits reach two, and `SSR_CLIENT_CONTENT_MASKED` when a client-only outcome surfaced only after a wait. Both key by `data.boundary` — the record's `id`.

The **`"invocation"` record** (from `@solidjs/web`, server) is one server-function execution:

```js
const off = OBSERVE.records.subscribe("invocation", (event, live) => {
  // event: { id, direct, at, durationMs, outcome: "ok" | "error", deferred?, boundary? }
  // live:  { event: RequestEvent, request?, args, result? | error? }
});
```

One record per call, delivered when the call **settles** — synchronously for a synchronous direct call, at resolution for a promise. `id` is the function's registered id; `direct` says whether this was an in-process SSR call (`true`, no `request`) or HTTP dispatch (`false`, `request` is the `Request` the handler dispatched). `outcome: "error"` carries the value **as thrown** in `live.error` — the sanitized `Error` the wire gets in production is the client's view, not the observer's. `deferred: true` marks a result the caller drives after the record (a stream or async generator): `durationMs` then measures to the handoff, not to the last chunk. For a direct call made during a `<Loading>` boundary's render pass, `boundary` is that boundary's hydration id — the `"boundary"` record's `id` — so a boundary's wait reads as the server-function calls it consisted of; absent for a call outside any boundary's pass (the shell) and for HTTP dispatch.

The **`"render"` record** (from `@solidjs/web`, server) is one server render — a `renderToString` or a `renderToStream` — the server-side account of the head's timing:

```js
const off = OBSERVE.records.subscribe("render", (event, live) => {
  // event: { mode: "string" | "stream", at, shellMs?, durationMs, boundaries,
  //          outcome: "complete" | "abandoned" | "error" }
  // live:  { event?: RequestEvent, trace: TraceContext }
});
```

One record per render, delivered when it **ends**: the document returned, the stream's last fragment written, or the render torn down. `at` is `performance.now()` at the render's start; `shellMs` runs start → the shell complete — for a stream, the head and shell handed to the sink (the head is frozen from there; a fragment can no longer add to it), for a string, the document assembled (the whole render) — and is absent when the render ended before its shell; `durationMs` runs start → the end. `boundaries` counts the `<Loading>` boundaries the shell **waited on** — each also a `"boundary"` record with `streamed: false` — and not the ones that streamed after it; it is counted from the boundary records the render filed, so in an observe build it needs a `"boundary"` listener too (`0` with a `"render"` listener alone). `outcome` is `"complete"` for a render that ran to its end, `"abandoned"` when the consumer left mid-stream (the `SSR_STREAM_ABANDONED` finding is that request's account), `"error"` when the render failed (a string render threw; a stream's uncontained failure wound it down). `live.event` is the request the render served, absent for a render outside a request scope; `live.trace` is the render's trace context (what `getTraceContext()` answers during it). `solid-shell` on the response's `Server-Timing` is this record's `shellMs`, read off the same object at head commit (below, [Chrome Performance panel](#chrome-performance-panel-solidjswebperformance-tracks)). The cost is paid only with a listener installed (or in dev): a render nobody observes reads no clock.

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

The **`"recovery"` record** (from `solid-js`, client) is the other end of a `"boundary"` record whose `outcome` was `"client"`: a `<Loading>` boundary whose fragment the server could not produce — its async rejected after the shell flushed, or the stream was cut before the fragment arrived — and which the client therefore rendered as fresh DOM instead of adopting server markup:

```js
const off = OBSERVE.records.subscribe("recovery", (event, live) => {
  // event: { id, at, waitedMs, renderMs }
  // live:  {}
});
```

One record per such boundary, delivered when the fresh render has committed. `id` is the boundary's hydration id — the server record's `id`, so the two sides join: the server says how long it tried and why it gave up (`durationMs`, `outcome: "client"`, and the error hook's `handling: "client"` has the error), the client says how long the person looked at the fallback while it did (`waitedMs`, from the boundary registering against the fragment to the rejection reaching it — `0` when the rejection had already arrived at hydration) and what the fresh render cost (`renderMs`). The question they answer together: "this boundary fails on the server 4% of the time and costs users 900ms when it does." Observe-only: prod is byte-identical (the branch and its helper fold), and the clock is read only when something is subscribed. The error itself stays on the server; `live` is empty.

`@solidjs/diagnostics` folds the runtimes' record types into the artifact it captures — `artifact.records.{boundary, invocation, frame, call}`, format v7, one table per type, with `artifact.timeOrigin` anchoring every record's `at` — on either platform: `captureArtifact(() => renderToStream(…))` on the server, the browser bridge in the page; so a render's waits and calls and a page's requests are evidence a test or an agent can hold beside the findings. See the package README.

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

| Code                               | Severity  | Category       | Trigger                                                                                                                                                 |
| ---------------------------------- | --------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REACTIVE_WRITE_IN_OWNED_SCOPE`    | error     | write          | Reactive write/invalidation inside component/computation                                                                                                |
| `ASYNC_STORE_SETTER`               | error     | write          | Store setter callback returned a Promise (setters are synchronous transactions)                                                                         |
| `PENDING_ASYNC_UNTRACKED_READ`     | error     | async          | Reading pending async outside tracking scope                                                                                                            |
| `ASYNC_OUTSIDE_LOADING_BOUNDARY`   | warn      | async          | Async computation outside Loading boundary (non-halting; root mount is deferred)                                                                        |
| `CLEANUP_IN_FORBIDDEN_SCOPE`       | error     | lifecycle      | `onCleanup` inside trackedEffect/onSettled                                                                                                              |
| `SETTLED_CLEANUP_UNOWNED`          | error     | lifecycle      | `onSettled` returned a cleanup in an unowned (out-of-band) scope                                                                                        |
| `PRIMITIVE_IN_FORBIDDEN_SCOPE`     | error     | lifecycle      | Reactive primitive created inside trackedEffect/onSettled                                                                                               |
| `ACTION_CALLED_IN_OWNED_SCOPE`     | error     | write          | `action()` invoked from a component body or computation                                                                                                 |
| `MISSING_EFFECT_FN`                | error     | lifecycle      | `createEffect` called without the effect function                                                                                                       |
| `SYNC_NODE_RECEIVED_ASYNC`         | error     | lifecycle      | `sync: true` computation returned a Promise / AsyncIterable                                                                                             |
| `INVALID_REFRESH_TARGET`           | error     | write          | `refresh()` target is not a source accessor or refreshable store                                                                                        |
| `INVALID_AFFECTS_TARGET`           | error     | write          | `affects()` given a key path, or a key on an accessor                                                                                                   |
| `REACTIVITY_HALTED`                | error     | error          | Uncaught error escaped every boundary; scheduling stopped (reported, cause to `reportError`)                                                            |
| `INVARIANT_VIOLATION`              | error     | error          | Internal consistency check failed (throws under `__TEST__`, reported in dev)                                                                            |
| `SETTLE_WALK_UNINITIALIZED_SOURCE` | error     | lifecycle      | Internal: settle walk reached a source that never produced a value (reported)                                                                           |
| `STRICT_READ_UNTRACKED`            | warn      | strict-read    | Untracked reactive read in component/effect body                                                                                                        |
| `UNTRACKED_READ_AFTER_AWAIT`       | warn      | async          | Async computation first read a signal/memo/store key after an `await`; never a dependency (dev; V8 engines only)                                        |
| `PENDING_ASYNC_FORBIDDEN_SCOPE`    | warn      | async          | Pending async read in trackedEffect/onSettled                                                                                                           |
| `LOADING_ON_OUTSIDE_HOLD`          | warn      | async          | `<Loading on>` changed but its data is also read outside the boundary and holds the frame: the fallback can never be seen                               |
| `NO_OWNER_EFFECT`                  | warn      | lifecycle      | Effect created without reactive owner                                                                                                                   |
| `NO_OWNER_CLEANUP`                 | warn      | lifecycle      | `onCleanup` called without owner                                                                                                                        |
| `NO_OWNER_BOUNDARY`                | warn      | lifecycle      | Boundary created without owner                                                                                                                          |
| `RUN_WITH_DISPOSED_OWNER`          | warn      | owner          | `runWithOwner` with disposed owner                                                                                                                      |
| `FLUSH_IN_EFFECT_CALLBACK`         | warn      | lifecycle      | `flush()` from an effect callback (no-op; the drain is already running)                                                                                 |
| `HUGE_FAN_OUT`                     | warn      | graph          | One change reached 2000 live subscribers (always on), or 250 — `fanOut` — on a stamped root write (attribution enabled)                                 |
| `HUGE_FAN_IN`                      | warn      | graph          | One recompute tracked 2000 sources (always on)                                                                                                          |
| `GRAPH_GROWTH`                     | warn      | perf           | The live owner count at the same route's settle climbed on 3 consecutive visits to 1.25× — something each visit leaves behind (attribution enabled)     |
| `HOT_SCOPE_RERUNS`                 | warn      | perf           | 120+ re-runs of one scope in 1s (attribution enabled)                                                                                                   |
| `HOT_SCOPE_FANOUT`                 | warn      | perf           | 5+/50+/500+ scopes hot from one root cause (attribution enabled)                                                                                        |
| `HOT_SCOPE_TIME`                   | warn      | perf           | 8ms+ self-time in one scope in 1s (attribution enabled)                                                                                                 |
| `WIDE_SCOPE_DEPS`                  | warn      | perf           | Scope subscribed to 30+ sources (attribution enabled)                                                                                                   |
| `ASYNC_WATERFALL`                  | info/warn | perf           | 2+/3+ sequential async flights, origin-proven (attribution enabled)                                                                                     |
| `UNSTABLE_MEMO_OUTPUT`             | warn      | perf           | Memo returned a new-but-equivalent container 4+ runs running (attribution enabled)                                                                      |
| `WASTED_RECOMPUTE`                 | warn      | perf           | 80%+ of a scope's 5+ runs in a second produced an unchanged value for 2ms+ of compute — inputs change, result does not (attribution enabled)            |
| `EFFECT_WRITES_OWN_SOURCE`         | info/warn | perf           | Effect's write provably feeds back into its own inputs; `info` for multi-effect rings (attribution enabled)                                             |
| `EFFECT_RELAY_TEAR`                | info/warn | perf           | Reader ran twice for one root change because an effect relayed it; `warn` when derivable or repeated (attribution enabled)                              |
| `IMMUTABLE_UPDATE_IN_STORE`        | warn      | perf           | Store container replaced by a mostly-identical copy (attribution enabled)                                                                               |
| `UNSTABLE_LIST_IDENTITY`           | warn      | perf           | `mapArray`/`For` recreated rows for equivalent items (attribution enabled)                                                                              |
| `SILENT_HOLD`                      | info/warn | responsiveness | Write held 100ms+/200ms+ by pending async with no on-screen acknowledgement (attribution enabled)                                                       |
| `LONG_HOLD`                        | info/warn | responsiveness | Acknowledged hold whose tail (last input → commit) ran 500ms+/1000ms+ (attribution enabled)                                                             |
| `UNTRACKED_ASYNC_HANDLER`          | info/warn | responsiveness | Handler awaited 100ms+/200ms+ past its frame with no write before the `await` and no `action()`: a dead click no hold could judge (attribution enabled) |
| `ABANDONED_FLIGHTS`                | warn      | responsiveness | One async source abandoned 3+ flights in 1s, each superseded before landing — the request-per-keystroke signature (attribution enabled)                 |
| `FALLBACK_FLASH`                   | info      | responsiveness | A `Loading` fallback showed for under 150ms — feedback for a wait too short to need it (attribution enabled)                                            |
| `STACKED_HOLDS`                    | warn      | responsiveness | 3+ interactions were waiting in one hold when it committed — repeats piled behind the same source (attribution enabled)                                 |
| `OPTIMISTIC_REVERTED`              | info      | responsiveness | An optimistic value the screen showed was replaced by a different one — reverted at settle, or superseded by the truth (attribution enabled)            |
| `SSR_RENDER_ERROR_CONTAINED`       | error     | ssr            | Server render error routed by a boundary: `data.handling` fallback / client / failed (observe + dev)                                                    |
| `SSR_SUBTREE_ABANDONED`            | warn      | ssr            | A failed fragment's pending descendants were discarded (observe + dev)                                                                                  |
| `SSR_STREAM_ABANDONED`             | warn      | ssr            | Response stream cancelled or sink failed with fragments pending (observe + dev)                                                                         |
| `LATE_HEADER_WRITE`                | error     | head           | Response header written after the head was sent; dropped (observe + dev; dev throws)                                                                    |
| `SERVER_ERROR_SANITIZED`           | error/info| ssr            | Error replaced with the generic Error on the wire — `data.source` `"server-function"` (`error`) or `"ssr"` (`info`); `data.error` is the original (observe + dev) |
| `FRAME_MARKER_CORRUPTED`           | error     | ssr            | Frame slot range missing its end marker on the client — nesting or an HTML rewriter (observe + dev)                                                     |
| `SERVER_WRITE`                     | warn      | write          | Signal/store/optimistic setter ran during a server render; inert, will throw (dev; once per category)                                                   |
| `REVEAL_IN_RENDER_TO_STRING`       | warn      | ssr            | Nested `<Reveal>` with collapsed/together under `renderToString` (dev)                                                                                  |
| `SSR_BOUNDARY_WATERFALL`           | info/warn | ssr            | A `<Loading>` boundary needed 3+/4+ render passes — 2+/3+ sequential async waits (dev)                                                                  |
| `SSR_CLIENT_CONTENT_MASKED`        | warn      | ssr            | Client-only content in a `<Loading>` surfaced only after a server wait; the server's work was discarded (dev)                                           |
| `LAZY_ASSET_UNMAPPED`              | warn      | ssr            | `lazy()` component's client assets could not be resolved for the page (dev)                                                                             |
| `PRELOAD_DESCRIPTOR_INVALID`       | warn      | head           | `registerAsset("preload")` descriptor broke a field rule; link dropped or field ignored (dev)                                                           |
| `HEAD_TAG_INVALID`                 | warn      | head           | `useHead` registration the render could not honor; `data.reason` names the rule (dev)                                                                   |
| `UNRECOGNIZED_INSERT_VALUE`        | warn      | render         | Value at an insert position the renderer cannot render; skipped (dev; server and client)                                                                |
| `UNSCOPED_HOLE_ALLOCATED_IDS`      | warn      | render         | Unscoped hole was handed a function whose content took ids at a position the other side does not share; keys permute (dev)                              |
| `BEHAVIOR_CLAIM_DROPPED`           | warn      | ssr            | Behavior position on a server-rendered element got a spread prop or a server-local function (dev)                                                       |

## Run attribution — "why did this run"

Beyond the always-on diagnostics above, dev and observe builds ship an opt-in **attribution engine** that explains every re-run. The runtime already knows the full dependency graph; enabling attribution stamps each value commit with a change record (a write, an async landing, a `refresh()` invalidation, or a derived change chaining back to its causes), so each re-run reports the chain down to the originating write:

```
[why-run] effect "docTitle" ran (run 4)
  ← memo "userLabel" changed (#6)
    ← signal "notifications" write (#5) 2 → 3
```

The engine is its own entry, `solid-js/attribution` (re-exporting `@solidjs/signals/attribution`), so a build that never imports it never ships it: the runtime carries only the hook slot the engine installs into (internal to `@solidjs/signals`; `OBSERVE.attribution.installed` says whether an engine is present) and the two declared frames — the interaction frame the web runtime opens around event dispatch (`OBSERVE.attribution.withInteraction`) and the origin frame a router opens around its navigation write (`OBSERVE.attribution.withOrigin`). The import is legal in every tier — the prod tier resolves an inert engine with the same surface, so app code needs no per-tier guard.

### API (`solid-js/attribution`)

```js
import { attribution } from "solid-js/attribution";

const release = attribution.enable({
  log: true,          // pretty-print each re-run (default true)
  stacks: false,      // capture write stacks — slow (default false)
  historyLimit: 200,  // ring buffer size
  hotRuns: { count: 120, windowMs: 1000 },   // or false
  hotTime: { budgetMs: 8, windowMs: 1000 },  // or false
  wideDeps: 30,                               // or false
  unstableMemos: 4,                           // or false
  fanOut: 250,                                // or false (HUGE_FAN_OUT threshold while enabled)
  waterfalls: { minFlightMs: 50 },            // or false
  holds: { infoMs: 100, warnMs: 200 },        // or false (disables hold tracking)
  longHolds: { infoMs: 500, warnMs: 1000 },   // or false
  checks: true                                // false: records only — none of the six cost checks above
});

// The ring buffers, by type (readonly, oldest first, `historyLimit` deep):
attribution.history("rerun");       // RerunEvents — kept only while a listener, a fold or the log wants them
attribution.history("waterfall");   // graph-provable sequential flight chains
attribution.history("hold");        // every hold, acknowledged or not
attribution.history("navigation");  // every declared navigation, settled or not (below)
attribution.history("interaction"); // every user interaction, settled or not (below)
release();                      // this consumer's hold; the last release uninstalls
attribution.disable();          // everything, whatever holds are outstanding (the console's reset)

// The engine's records are delivered on the core's channel, the same place
// the runtimes' records arrive (`OBSERVE.records`, above): one subscribe,
// typed by record type, the live node beside the record.
import { OBSERVE } from "solid-js";
const off = OBSERVE.records.subscribe("rerun", (event, node) => { … });   // live RerunEvent feed; `node` is the computation that ran
OBSERVE.records.subscribe("interaction" | "hold" | "navigation", (event, live) => { … }); // each record as it settles; `live` is the held signal for a hold, undefined otherwise
OBSERVE.records.subscribe("flush" | "create" | "effect" | "flight" | "fallback" | "graph", (event, live) => { … }); // timeline records (below)
off();                          // subscriptions are the channel's: they outlive enable()/disable()

// Each enable() is a hold and returns its release: a second consumer (a
// diagnostics capture beside a profiler track beside an APM adapter) takes
// its own, and live state survives until the last hold goes (record
// listeners are not the engine's and survive it regardless).
// Options combine across holds by the most demanding request per key — the
// log prints while any holder wants it, a check runs while any holder wants
// it and at the most sensitive threshold asked for, historyLimit is the
// largest — so a hold can add to what the engine does but never take away
// what another asked for, and the order holds are taken does not matter.
// Releasing a hold withdraws its requests: a track that enabled with
// `log: false` beside this session never silenced it; a capture with tight
// thresholds beside a records-only adapter runs the checks for its own
// duration. Each enable() does reset the aggregation windows (history, the
// fold tables), which is what a capture wants; a consumer that re-enables
// to reopen its window holds twice and releases twice.

// The folds over those records, the point queries and the formatters are
// NAMED EXPORTS, not methods: a fold's module registers its accounting with
// the engine when it is imported, so a consumer that only subscribes to
// records (a production adapter) never ships the tables a console or an
// agent reads — importing `costs` or `feedback` is what turns them on.
import { costs, feedback, why, subscriptions, formatRerun, formatOrigin } from "solid-js/attribution";

costs();                        // { scopes, writes } ranked cost tables (since enable())
feedback();                     // responsiveness tables (below)
why(someMemo);                  // re-run history for one node — a view of history("rerun"), same gate: empty for runs nothing wanted a record of
subscriptions(fn);              // current dep names of one scope — read from the graph, not a record; unaffected by the gate
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
// Whether an engine is present: OBSERVE.attribution.installed (the hook
// table itself is opaque — the slot is the engine's, not a public seam).
// The installed hooks are also registered on globalThis under
// Symbol.for("@solidjs/signals/observe/attribution"), the records channel's
// reach for a layer bundled without a framework import.
// An observer that renders inside the app it watches (an APM adapter's
// panel, devtools) marks its own root so neither channel reports it.
createRoot(() => {
  OBSERVE?.exclude(getOwner());
  /* panel */
});
```

**Records and clocks.** Everything the engine hands out — `RerunEvent`, `InteractionEvent`, `HoldEvent`, `NavigationEvent` — is a record with an absolute `at` on the `performance.now()` clock (`RerunEvent.at` the run's start, `HoldEvent.at` the start of the wait, `NavigationEvent.at`/`InteractionEvent.at` the request/dispatch) plus durations from it (`holdMs`, `settledMs`, `selfMs`). Epoch time for an exporter is `performance.timeOrigin + at` (milliseconds). Without cross-origin isolation the browser quantizes `performance.now()` to 100µs, so a single run's `selfMs` is often `0`; the per-interaction `settledMs` is the wall-clock number to report. Records are serializable as emitted: none carries a live graph reference — a re-run names its scope by `nodeId` (the engine's per-node id, stable across the scope's runs in the process, distinct between scopes; in-process consumers get the node itself as the listener's second argument, `live`) — while the frame objects that join records (`origin`, `interaction`) are the same object across records in-process, so join by identity there and by `ChangeOrigin.run`/`at`/`name` once they have left it. `OBSERVE.records.subscribe(type, listener)` delivers each record synchronously at the moment it is complete (a re-run at recompute end; an interaction, hold or navigation when it settles), bottom-up: a hold before the navigation it held, before the interaction that performed it — the same objects `history(type)` keeps. A listener runs inside the engine and must not write signals; hand work off to a microtask. A `RerunEvent` is built — dep diff, previews, cause list, ring-buffer push — only while something wants it: a `rerun` listener, an imported fold (`costs`/`feedback`) or the console log. Without one the engine still keeps its per-node facts and runs every check (hot runs, hot time, wasted recompute, dep width) from them, allocates no record, and `history("rerun")` stays empty.

**Timeline records.** Five further record types describe the work itself rather than its outcome, shaped for a profiler track (`@solidjs/web/performance-tracks`, below) and for the responsiveness findings; they enter no ring buffer and are built only while something is subscribed to them (`OBSERVE.records.observed(type)`), so an app that does not listen pays nothing beyond the hook null-check. `flush` — one per scheduler drain: `at`, `durationMs`, `runs` and `created` inside it, `held` (a transition parked), `interaction`. `create` — a computation's creation run (`RerunEvent`'s shape without causes: `nodeId`, `nodeName`, `nodeKind`, `at`, `selfMs`, `totalMs`, `depCount`, `phase`, `held`, `interaction`) — the mount work that no `RerunEvent` describes, and what `InteractionEvent.created` counts. `effect` — an effect's callback, the imperative half that writes the DOM: `nodeId`, `nodeName`, `at`, `durationMs`, `run`, `interaction`. `flight` — an async node's flight, kickoff to landing: `nodeId`, `nodeName`, `ownerPath`, `at`, `durationMs`, `outcome: "landed" | "abandoned"` (superseded before it landed), `interaction`. `fallback` — a `<Loading>` boundary's fallback, displayed to hidden: `ownerPath`, `at`, `shownMs`, `interaction`. `at` is the end of the drain that rendered the swap — the boundary's swap is a staged write that lands with its frame ([RFC 05](05-async-data.md#loading-on-prop-dependencies-that-show-the-fallback-again)), and a swap cleared before that (the content landed before the frame did, or the commit's own sweep cleared it ahead of any effect — the `LOADING_ON_OUTSIDE_HOLD` shape) was never on screen and is no record. Every derived `ChangeRecord` on a re-run's cause chain also carries the `nodeId` of the memo it came from, so a consumer can walk the propagation of one write node by node.

**Joining an interaction to the browser's INP entry.** An `InteractionEvent.at` is the DOM event's `timeStamp` when the runtime dispatched it (compiled event bindings pass it; `OBSERVE.attribution.withInteraction({ …, at: e.timeStamp }, fn)` for a custom dispatcher), and `inputDelayMs` is the queueing from that moment to the handler's entry — the browser's input delay. The `PerformanceEventTiming` entry for the same event (a `PerformanceObserver` on `"event"`) has `startTime === interaction.at` on the same clock and carries `interactionId`, so the join is `entry.startTime === interaction.at`: `inputDelayMs` accounts for the entry's `processingStart − startTime`, `handlerMs` for its processing, and `settledMs` extends past its `duration` to when Solid had the screen right.

**Excluding the observer.** `OBSERVE.exclude(owner)` marks an owner subtree as the observer's own: diagnostics whose subject sits under it are built (a throwing site still throws) but never delivered or printed, and the attribution engine records no run for its computations, charges none of them to an interaction, counts no write to its signals or stores toward an interaction, and does not spend a once-per-key slot (`IMMUTABLE_UPDATE_IN_STORE`'s per-path memory) on them. An interaction whose writes all went to excluded subjects, with none of the app's work run — a click on the observer's own panel — is not recorded at all. Mark the root as it is created (a store's nodes take the owner the store was created under, recorded only once the engine is enabled — enable before creating the panel's stores). The signals and stores created under it are excluded subjects wherever their writes come from — a click handler, an adapter callback — so writes need no `runWithOwner`, and must not use one: a write under an owner is a write in an owned scope (`REACTIVE_WRITE_IN_OWNED_SCOPE`). `OBSERVE.isExcluded(subject)` answers the question for any owner or node.

**Values in records — the PII surface.** Records name things (owner paths, `name` options, store paths, route patterns, function ids) and are otherwise numbers, kinds and outcomes; a handful of fields carry _user data_. The engine governs those fields **at the source**, with one option on the hold — `attribution.enable({ values })` — so a record never carries what the level excludes and nothing downstream (a formatter, `@solidjs/web/performance-tracks`, an exporter) has to scrub. The fields the level governs: `ChangeRecord.prev`/`value` and `HeldWrite.prev`/`value` — previews of the written values (`preview()`: strings quoted and cut at 40 characters, numbers/booleans verbatim, everything else a type tag such as `Array(12)` or `[Object]`); `ChangeOrigin.target` (and so `InteractionEvent.target`, `HoldEvent.interaction.target`) — the element hit as the runtime described it, `tag#id "text"` with up to 30 characters of `textContent` for anything that is not an `input`/`textarea`/`select`, so a label but also whatever a `<td>` said; and every sentence the engine builds from those — `formatRerun`, `formatOrigin`, the `SILENT_HOLD`/`LONG_HOLD` verdicts (`click on button#next "Next →" wrote "page" (1 → 2)…`, with `data.interaction.target` structured beside), `OPTIMISTIC_REVERTED` (which quotes the shown and settled values, `data.shown`/`data.truth`). The levels, each a strict subset of the one above:

- `"full"` — **the dev default**: previews on every change record and held write; the element text on every target; the sentences quote both. Today's dev output, unchanged. Right for dev, a console session, a diagnostics capture an agent reads locally.
- `"labels"` — no value previews anywhere (`prev`/`value` absent, sentences say `wrote "page"` and `signal "n" write` without the `1 → 2`); element text kept only on a `button` or an `a` (`button#save "Save"` stays, `div#card "Personal note"` becomes `div#card`) — the control's label, never a cell's content. What `@solidjs/web/performance-tracks` used to apply by hand in observe builds.
- `"none"` — **the observe default**: no previews, no element text on any target (`button#save`); the sentences name the node and the element and nothing the person typed or read.

**The default is the build tier's** — `"full"` in dev builds, `"none"` in observe builds (the literal is folded per build; the observe engine ships `"none"` only). An observe build is a production artifact: it carries no user data unless a holder asks, and a holder that wants more says so — `attribution.enable({ values: "labels" })` for the interaction's control label, `"full"` for everything. Across holds the **least permissive** level wins: a diagnostics panel asking for `"full"` beside an APM adapter asking for `"none"` gets `"none"` until the adapter releases — a production holder can rely on its level regardless of who else is on the engine. A holder that names no level asks for the tier's default, so in an observe build it tightens to `"none"` beside anyone, while a single holder passing `"full"` there gets `"full"`; an explicit `"full"` never loosens what another holder demanded. The level applies from the moment it is in effect (a record built before a stricter hold was taken keeps what it carried). An observe-tier consumer that ships records off the machine should treat its level as its export contract — pass it explicitly rather than relying on the default, and never scrub after the fact. Outside the level: `ChangeOrigin.to`/`from`/`params` and `NavigationEvent.to`/`from`/`params` (`NavigationHop` too) — concrete paths and the values a route pattern bound (`/users/42`, `{ id: "42" }`), while `name` is the pattern; the verdict sentences name the navigation with them. `data.error` on the server error findings (`SSR_RENDER_ERROR_CONTAINED`, `SERVER_ERROR_SANITIZED` on either road) — the error **as thrown**, message and own properties, deliberately unsanitized: the wire got the generic message so the observer could see the real one, which means a driver's connection string or a query lands here, and an exporter treats it as it treats any captured exception. Dev-only checks may put the offending value on `data` (`PRELOAD_DESCRIPTOR_INVALID`'s `data.value`, `HEAD_TAG_INVALID`'s `data.detail`) — dev tier, never exported. Everything else is safe by construction: `RerunEvent` has names and numbers only; the runtimes' records (`"call"`, `"invocation"`, `"render"`, `"boundary"`, `"frame"`, `"recovery"`) never put arguments, results, thrown values, requests or responses on the record — those ride the `live` argument beside it, in-process only — and carry ids, methods, addresses, statuses, counts and timings; `ownerPath` is component and primitive names. `stacks: true` adds first-party frames to `ChangeRecord.stack` (file paths, not values) and is a dev affordance to leave off in production.

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

### Navigations (`history("navigation")`)

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

### Interactions (`history("interaction")`)

The interaction is the unit a person experiences: one click, and everything it cost until the screen had the answer. Every downstream fact is already keyed to the interaction frame — writes stamp it, re-runs trace to it through their causes, holds and navigations carry it — and `feedback().interactions` folds those by interaction _name_. `history("interaction")` keeps one `InteractionEvent` per dispatch instead (delivered on `OBSERVE.records.subscribe("interaction", …)` as it settles), with a start, an end, and the pieces attached, so a consumer building a span per interaction (an APM adapter) neither infers the end from an idle gap nor sums quantized per-run times to approximate the wall clock:

- `name`, `target`, `at` — what the runtime described to `withInteraction` (`at` the event's own `timeStamp` when it was given, else the dispatch); `inputDelayMs` — the browser's queueing from `at` to the handler's entry, present when `at` predates it; `handlerMs` — the handler itself, entry to return.
- `writes` — root writes attributed to the frame: the handler's, and those of frames it opened (a navigation).
- `runs` and `created` — re-runs traced back to it, and computations _created_ in those runs or in its flushes (the "create 1,000 rows" work, which no `RerunEvent` describes); `runMs` sums the self-time of both.
- `holds` — the `HoldEvent`s its writes waited in; `navigations` — the `NavigationEvent`s performed under it. The same objects as in `history("hold")`/`history("navigation")`.
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

### Chrome Performance panel (`@solidjs/web/performance-tracks`)

The same records, painted: `enablePerformanceTracks()` renders the attribution engine's records and the web runtime's `call`/`frame` records as custom tracks in the Chrome Performance panel — the extensibility API React's own tracks use — beside Chrome's main-thread and network tracks, so what an agent read in the artifact is what the developer sees on the timeline. Dev and observe tiers in the browser; a no-op in prod builds and under the `node`/`worker`/`deno` conditions (the tracks are a browser view — an SSR pass takes no hold and emits nothing).

```ts
import { enablePerformanceTracks } from "@solidjs/web/performance-tracks";

const disable = enablePerformanceTracks({
  minMs: 0, // floor for run spans; 0 in dev, 0.05 in observe builds
  rich: true, // performance.measure with tooltips/properties (dev default) vs console.timeStamp
  attribution: { values: "labels" } // options for the engine hold it takes (log: false; values: the tier's default)
});
```

The adapter scrubs nothing itself: what the spans and tooltips say about values and elements is what the engine put on the records under the hold's `values` level (above) — the tier's default unless the `attribution` option names one: dev shows previews and element text (`"full"`), an observe build shows neither (`"none"`); pass `attribution: { values: "labels" }` for the control labels in an observe build, or `"none"` for a dev timeline without user data.

Group `Solid`, tracks in order: **Interactions** — the input delay, the handler, then the settle to `committed`/`held` (a silent hold as a warning); **Propagation** — one span per scheduler drain labelled by the writes that started it and what they reached (`count 0 → 1 — click on button#next · 5 runs, 1 unchanged`), with every run inside it beneath, labelled by what made it run (`<TodoRow> › effect ← doubled`) — the write's path through the graph as a flame; **Effects** and **Memos** — one span per re-run, creation run (`· create`) and effect callback (`· callback`), coloured by self time, `warning` for a run that changed nothing; **Async** — flights kickoff → landing (abandoned ones as warnings) and fallbacks shown → hidden; **Holds** — each wait labelled by its blockers, `warning` when silent, `error` when long; **Navigations** — request → settle by route pattern; **Server** — server-function calls and frame streams. Every span is emitted retroactively from the record's own `performance.now()` stamps — nothing brackets a hot path.

The **Server** track also shows the server's side of the work it painted from the client: dev and observe servers write the request's timed work as `Server-Timing` metrics, each a projection of one of the server's records on `OBSERVE.records` — `solid-invocation` from the `"invocation"` record on a server-function response; on a document, `solid-shell` from the `"render"` record's `shellMs` and one `solid-boundary` from each `"boundary"` record the shell waited on (RFC 12, [the trace the request belongs to](12-ssr-http.md#the-trace-the-request-belongs-to-gettracecontext)) — and the adapter reads them back: a `call` record's `live.response` headers become `<id> · server` beneath the call span, placed so the server span ends at the resource's `responseStart` and runs back its `dur` (the gap before it is the request's wire; `Wire` is a property), with the document's own `PerformanceNavigationTiming.serverTiming` painted as `shell · server` and `boundary <App> › <Loading> · server` when the tracks enable. Resource entries can land after the call settles, so the adapter watches `PerformanceObserver({ type: "resource", buffered: true })` for up to 30 s per call and centres the span inside the call when no entry arrives. An observe-tier server writes each metric only while something on the server is subscribed to the record it is projected from (`"render"` for the shell, `"boundary"` for the boundaries, `"invocation"` for the function — a diagnostics capture, an APM adapter) — enabling the tracks in the browser does not by itself change a production-shaped wire; a dev server always writes them.

Labels read as source: a flow control's own nodes fold into its tag (`<App> › <Show>` rather than `<App> › <Show> › condition value`) and a composed primitive's nodes into the primitive (`createDebounced.value` → `createDebounced`, the same rule as `store.user`), with the runtime's name kept in the span's `Node` property; the `Owner path` property is the unfolded truth and `Node id` the engine's id. A label also starts at the nearest component the developer wrote — `<Search> › results`, not `<Document> › body › <App> › <Router> › … › <Search> › results` — because a track entry is only as wide as its span and the panel elides the middle of a label that does not fit, which in a full path is exactly the part that says which component this is. Solid's own flow controls (`<Show>`, `<For>`, `<Loading>`, `<Portal>`…) are not anchors: a node under `<Card> › <Show>` labels `<Card> › <Show> › effect`. The same cut applies to fallback spans, flights, findings and the Server track's boundary spans; wherever the label is shorter than the path, the full path is the `Owner path` property. Rich mode carries the why-chain (`formatRerun`) as the tooltip, and causes, deps added/removed, phase, origin and interaction as properties.

Findings become markers: every `DiagnosticEvent` delivered while enabled is a marker on the panel's Timings track (`SILENT_HOLD — <Search>`), coloured by severity, and — at `warn` or worse — annotated as a performance issue for the Insights sidebar (`detail.devtools.performanceIssue`, with the repair guide's section for the code as its link; Chrome ignores the annotation where it is not yet supported). In dev, every span and marker is emitted inside the `console.createTask` task of the component it belongs to, so the entry's stack in the panel points at the JSX site that rendered the component rather than at the engine. The dev component wrapper creates that task only for components rendered while an attribution engine is installed — `console.createTask` captures a stack per call, roughly the wrapper's own cost again and ~90 B retained per instance, DevTools open or not, and only an attribution consumer reads it — so a dev session with nothing enabled pays nothing, and the tracks enabled at bootstrap see every component's site (a component rendered before any consumer enabled carries no task and its spans are emitted plainly). Enabling takes its own hold on the engine (`attribution.enable({ log: false, ... })` — asking for no console log, which quiets the console only while no other holder wants it), so it coexists with a diagnostics capture or an APM adapter; the returned function releases it. There is one instance per page: a second `enablePerformanceTracks()` while one is running joins it (the first call's options stand) and returns its own release, and the instance is torn down when every release has been called — a module HMR re-evaluates lands back on one set of tracks, not two painters. The adapter is the one place host APIs are called from inside the engine's hooks, and it guards them: a `performance`/`console` call that throws drops that entry (dev warns once) and never reaches the engine.

### Architecture

The engine is decoupled from the core through a narrow dev-only hook surface (`attribution-hooks.ts`): the core's only obligation is to report true facts (recompute start/end with lane and transition posture, committed writes, async landings, refreshes) at the moments they happen. All semantics — stamps, cause chains, timings, thresholds — live in the engine. Disabled cost is one null check per hook site; production builds fold every site out entirely (the size guard enforces byte-parity).

External devtools build on the engine's public face — `attribution.enable()` plus `OBSERVE.records` — not on the hook table, which is internal to `@solidjs/signals` (a devtools engine that replaced the built-in one would be a change to the package, not an integration).

Naming: attribution output uses debug names from the `name` option on primitives (`createSignal(0, { name: "count" })`); store nodes are named `store.path` automatically while the engine is active. Unnamed nodes fall back to their owner id.
