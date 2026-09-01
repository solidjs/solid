# RFC: Async data

**Start here:** If you’re migrating an app, read the migration guide first: [MIGRATION.md](MIGRATION.md)

## Summary

Solid 2.0 makes async a first-class capability of computations: `createMemo`, derived stores, and other computations can return **Promises** or **AsyncIterables**, and consumers interact with them through normal accessors. Pending async values signal “not ready” through the reactive graph, and `Loading` is the boundary that turns that state into UI. This removes the need for a separate `createResource` primitive. For “stale while revalidating” UI and coordination, 2.0 provides `isPending(fn)` and `latest(fn)`.

## Motivation

- **One model:** Async shouldn’t require a parallel set of primitives (resources vs signals). If computations can be async, the rest of the system (effects, boundaries, SSR/hydration) can treat async consistently.
- **Better types:** Async values can be represented without pervasive `T | undefined` “loading holes”. UI should be expressed via `Loading` boundaries rather than nullable types.
- **Composability:** When async is part of computations, derived values can combine sync + async naturally without bespoke resource combinators.

## Detailed design

### Async in computations (no `createResource`)

Any computation may return a Promise (or AsyncIterable) to represent pending work. Consumers read the accessor as usual; if it isn’t ready, the read follows the `Loading` path until it resolves.

```js
const user = createMemo(() => fetchUser(params.id));

function Profile() {
  // user() is not ready at first — wrap in <Loading>
  return <div>{user().name}</div>;
}

<Loading fallback={<Spinner />}>
  <Profile />
</Loading>
```

This pushes “loading state” to UI structure (boundaries) instead of leaking into every type.

### `Loading` is the UI boundary

`Loading` shows fallback while the subtree needs unresolved async values.

Importantly, `Loading` is intended to cover **branch readiness**: it handles a subtree or newly mounted branch attempting to read async-derived values that are not ready yet. After that branch has produced content, subsequent revalidation/refresh should generally not “kick you back” into the fallback; use `isPending` for “a change to this data is on the way” UI.

```jsx
<Loading fallback={<Spinner />}>
  <UserProfile id={id()} />
</Loading>
```

Nested `Loading` boundaries can be used to avoid blocking large subtrees and to control where loading UI appears.

#### `Loading` `on` prop: controlling when fallback re-shows

By default, once a `Loading` boundary has rendered content, it keeps showing stale content during revalidation (transitions). The `on` prop lets you specify an expression that, when it changes *and* async is pending, causes the boundary to re-show its fallback instead of stale content.

```jsx
// Without on: stale content shown during revalidation
<Loading fallback={<Spinner />}>
  <UserProfile id={id()} />
</Loading>

// With on: fallback re-shown when id changes while data is pending
<Loading on={id()} fallback={<Spinner />}>
  <UserProfile id={id()} />
</Loading>
```

This is useful for route-level or key-level transitions where you don't want to wait on all data loading before updating the UI. Show the fallback again instead.

### `isPending(fn)` (in-flight change queries)

`isPending` answers: “Is a value change in flight for this read that hasn't revealed yet?”

It returns `true` when a tracked input of the data has changed and the new answer hasn't landed (e.g. navigation changed an id and the refetch is still in flight), or when in-flight work has declared it will change the data (`affects`, RFC 06). A re-ask of the *same* question is silent: a bare `refresh()`, polling, or a confirming refetch after a mutation does not read as pending — the data you're showing still answers what's being asked, and the fresh value reveals silently. To make a reload read as pending, declare it: `affects(user); refresh(user)`.

`isPending` performs the read you pass it, so its placement matters: reading async data can participate in Loading/SSR readiness, while reading upstream state only observes that state's own pending transition.

```js
const users = createMemo(() => fetchUsers(query()));
const posts = createMemo(() => fetchPosts(query()));

const listPending = () => isPending(() => users() || posts());

return (
  <Loading fallback={<Spinner />}>
    <Show when={listPending()}>{/* subtle "updating…" indicator while a new query loads */}</Show>
    <List users={users()} posts={posts()} />
  </Loading>
);
```

Because this pending read reaches the async values directly, it sits under the same `Loading` boundary as the data read. On first load, the boundary owns fallback UI; after the values have resolved once, the inline indicator shows while a changed `query()` is being answered. `isPending` may also be used outside a `Loading` boundary when the expression only reads upstream state that cannot itself be not ready.

The intent is to replace `.loading`-style flags that belong to a specific primitive (`createResource`) with something that works for any expression. Since the expression is read normally, the same primitive can guard interactive controls that directly depend on async data when it is placed under the boundary that owns that read:

```jsx
<Loading fallback={<button disabled>Loading...</button>}>
  <button disabled={isPending(user)}>Save</button>
</Loading>
```

This only works when the expression passed to `isPending` actually reaches the async source (or a value already held by the reactive graph). A separate UI tree that only reads an upstream signal cannot infer that some lower subtree is on the Loading path:

```jsx
// While a lower subtree is loading this is still false: `id` itself is not pending.
isPending(id);
```

For interactive controls that would otherwise read async data before it is ready, make the rendered disabled state read the same async source with `isPending(fn)`, and provide a disabled Loading fallback for that path. If the control only reads upstream state, it can live outside the boundary; it just observes that upstream state rather than the lower async branch.

### `latest(fn)` (peek at in-flight values)

`latest(fn)` reads the “in flight” value of a signal/computation during transitions, and may fall back to stale if the next value isn’t available yet.

```js
const [userId, setUserId] = createSignal(1);
const user = createMemo(() => fetchUser(userId()));

// During a transition, this can reflect the in-flight userId
const latestUserId = () => latest(userId);
```

### `resolve(fn)` (wait for a reactive expression to settle)

`resolve(fn)` returns a Promise that resolves once the reactive expression `fn` produces a settled (non-pending) value. It cannot be called inside a reactive scope (it only resolves the current value and does not track updates).

```js
// Wait for an async memo to have a value
const user = await resolve(() => userMemo());

// Useful in tests or imperative code
const result = await resolve(() => computedValue());
```

Its sibling `until(fn, options?)` waits for a reactive *condition* instead of a value: it resolves the first time `fn` settles **truthy** (falsy results keep waiting), with optional `timeout`/`signal` rejection. Inside an `action()` it reads the authoritative view — optimistic overrides are invisible to it (your own tentative write cannot satisfy your own ack), while real data reads normally wherever it lives, including values still staged in the open transaction. That makes it the acknowledgment mechanism for mutations confirmed on a live data channel — see [RFC 06](06-actions-optimistic.md).

### `loadingValue` / `seedLoadingValue`: declared first paint (advanced)

The primary pattern for first-load UI is structural: wrap the branch in `Loading`. This option is the escape hatch for the cases where the right loading UI *is* the real UI rendered with provisional data — a feed that renders placeholder rows through the same components it renders real rows, a chart drawn from default data, dimmed with an inline indicator. Instead of branching to a fallback tree, the computation declares what it renders before its first answer:

```js
const feed = createMemo(() => fetchFeed(id()), {
  loadingValue: { provisional: true, items: placeholderItems }
});
```

- The node is born committed with the declared value. Its first flight never suspends readers, never trips a `Loading` boundary, and never holds a transition — the placeholder renders immediately, and the answer reveals when it lands.
- The first flight is quiet: `isPending` reads `false` while it is in flight. First-load affordances live in the value itself (e.g. a `provisional` flag driving dimmed styles), not in pending state. Once the first real answer lands the window is over — refetches and input changes use the normal pending machinery and `isPending` behaves as usual.
- `loadingValue` is typed strictly as `T`: the placeholder must be shaped like a real answer. If it can't be, that's the signal you wanted a `Loading` boundary.
- Store-family sources (`createStore(fn)`, `createProjection`, `createOptimisticStore`) declare it as `seedLoadingValue: true`, which promotes their existing seed to the same role.
- SSR renders the declared value into the HTML rather than suspending, and the landing streams as data; hydration claims against it. With `ssrSource: "client"` (below) the declaration is what makes a browser-only compute renderable on the server at all — without it, the source suspends structurally instead.

The guardrail is honesty: this is for *default data the user can tell is provisional*, not for impersonating an answer that hasn't arrived. If you find yourself inventing plausible-looking real data to avoid a spinner, use `Loading`.

### Transitions: built-in, multiple in flight

2.0 treats transitions as a core scheduling concept rather than something you explicitly wrap in `startTransition`/`useTransition`. Multiple transitions can be in flight; “entangling” determines what should block what. The user-facing pieces are the observable pending state (`isPending`) and optimistic APIs (RFC 06).

### SSR and hydration: `ssrSource`, `deferStream`, and `transparent`

Because async lives in ordinary computations, SSR/hydration policy is a per-primitive option rather than a resource feature. Two option fields are accepted wherever computation options are — `createMemo`, function-form `createSignal`/`createStore`, `createProjection`, the optimistic variants, and effects:

**`ssrSource`** is the hydration policy: what initial value the client uses, and whether the compute re-runs.

- `"server"` *(default)* — the client uses the serialized server value as its initial state. The compute does **not** re-run for the initial value; the serialized result is authoritative. Choose this when the compute is deterministic from server-available inputs — the common data-fetch case, where it means no duplicate fetch on load.
- `"hybrid"` — the client seeds from the serialized server value, then re-runs the compute to take over. Choose this for computes that mix server data with client-only signals (window size, user locale).
- `"client"` — skip the server value entirely. On the server the compute never runs (an owner is still created so hydration ids stay aligned); on the client it is deferred until hydration completes, then runs as if first-mounted. Choose this for client-only state where serialization is meaningless. What the server renders in the compute's place is the author's choice of channel:
  - **Bare (structural)** — with no declaration, the source is a hole the server can never fill. Reads suspend *finally*: the nearest `Loading` boundary flushes its fallback into the HTML and hands the position to the client, which renders the content fresh after hydration. Read outside a `Loading` boundary this is a render error (the stream would otherwise hang), so bare client sources must sit under a boundary.
  - **Declared (`loadingValue` / `seedLoadingValue`, above)** — the server renders the declared first paint instead of suspending; the client serves the same value while hydrating, then runs the compute. `loadingValue: undefined` is a valid declaration — put the `undefined` in the type and branch on it; store-family sources declare `seedLoadingValue: true` (the seed is what the pre-compute window renders).

```js
// Default ("server"): serialized value is authoritative; no client refetch on load.
const user = createMemo(() => fetchUser(id()));

// Server renders from the signal's default; client re-runs with the live viewport.
const columns = createMemo(() => Math.ceil(viewportWidth() / 240), { ssrSource: "hybrid" });

// Never serialized; computed fresh once hydration completes. The declared
// commit #0 (null) is what renders until then.
const draft = createMemo(() => readDraftFromStorage(key()) ?? null, {
  ssrSource: "client",
  loadingValue: null
});

// Bare form: the server flushes the surrounding <Loading> fallback and the
// client renders this branch itself after hydration.
const widget = createMemo(() => measureBrowserThing(), { ssrSource: "client" });
```

**`deferStream: true`** defers the SSR stream flush until this primitive's first value has resolved. It lets a late-resolving source hold the document open rather than forcing the surrounding `<Loading>` boundary to render its fallback into the HTML. Server-only; ignored on the client.

**`transparent: true`** (integration tier — accepted by effects and memos) makes the node invisible to hydration: it inherits its parent's id instead of consuming a child slot, and its compute runs live during hydration instead of adopting the serialized server value. It exists for **client-only reactive nodes created while hydrating** — nodes the server never rendered, so an id-consuming owner would shift every later sibling's hydration id and break serialized lookups and template claims (this is how `@solidjs/router` wires link state and scroll restoration). It is also the supported alternative to branching on hydration state (`if (hydrating) createEffect(...)`), which freezes the first run's decision: create the node unconditionally and mark it `transparent` so it observes live state. SSR ignores the option (server-side nodes always allocate their id slot), so only mark nodes the server does not create; outside hydration it is a no-op.

## Migration / replacement

### `createResource` → async computations + `Loading`

The basic case is straightforward — a fetcher that depends on a reactive source:

```js
// 1.x
const [user] = createResource(id, fetchUser);

// 2.0
const user = createMemo(() => fetchUser(id()));
```

Wrap reads of async accessors in `Loading` to control where fallback UI appears.

#### `resource.loading` → `isPending`

In 1.x, `.loading` was a property on the resource itself. In 2.0, loading state is structural (handled by `Loading` boundaries while a branch is not ready) and expression-level for in-flight changes:

```js
// 1.x
const [user] = createResource(id, fetchUser);
<Show when={user.loading}>Refreshing...</Show>

// 2.0
const user = createMemo(() => fetchUser(id()));
<Loading fallback={<UserSkeleton />}>
  <Show when={isPending(() => user())}>Updating...</Show>
  <UserDetails user={user()} />
</Loading>
```

Here `isPending` fires while a changed `id()` is being answered. Note the split from 1.x: `.loading` was also true during a plain `refetch`, but a bare `refresh()` re-asks the same question and is *not* pending in 2.0. For a refetch that should read as pending, declare it (`affects(user); refresh(user)`); for a process affordance (“saving…”, a disabled reload button), co-write an optimistic flag in the action instead (RFC 06).

Remember: `isPending(fn)` actively reads `fn`. If that read is not ready yet, it follows the same `Loading` path as reading the value directly. Put pending indicators under the boundary that should own initial fallback UI.

#### `resource.refetch` → `refresh()`

In 1.x, `refetch` was a method on the resource tuple. In 2.0, `refresh()` is a standalone function that can invalidate any derived computation:

```js
// 1.x
const [user, { refetch }] = createResource(id, fetchUser);
refetch();

// 2.0
const user = createMemo(() => fetchUser(id()));
refresh(user);
```

Like an `action(...)` result, `refresh()` is an imperative callback when you hand it to UI. Call it from event handlers, effects, or action workflows. A bare `refresh()` is a quiet re-ask — the fresh value reveals silently and `isPending` stays `false`; pair it with `affects()` when the reload should read as pending (RFC 06).

`refresh()` also returns a promise for the target's **next quiescent state** — the re-ask (and anything that supersedes it) has settled. Accessor targets resolve with the settled value; store targets resolve with the store node you passed, so reads through it after the `await` are fresh:

```js
const fresh = await refresh(user);
// or, for a store/projection:
await refresh(todos);
navigate(`/todos/${todos.at(-1).id}`);
```

The promise is safe to ignore — fire-and-forget `refresh()` is unchanged, and a failed refetch never surfaces an unhandled rejection from an ignored promise. The semantics are quiescence, not flight identity: if a second refresh (or any invalidation) supersedes this one mid-flight, the promise waits for — and delivers — whatever finally lands. A failed re-ask rejects with the error. Awaiting does not change the quiet-re-ask contract: `isPending` still stays `false` for a bare refresh.

Refresh granularity is the granularity of the *derive function*: refreshing a nested store node re-asks the whole family projection (there is no per-path refetch to re-run), though the promise still resolves with the node you passed. Inside actions, `yield refresh(x)` is the mutate-then-refetch sequencing primitive — see RFC 06.

#### `resource.mutate` → `createOptimisticStore` / `action`

In 1.x, `mutate` replaced the resource value wholesale. This had several problems: no granular updates (the entire list re-rendered), no reconciliation (identity lost on every mutation), and no protection against race conditions (concurrent mutations could clobber each other):

```js
// 1.x — replaces entire array, no diffing, races possible
const [todos, { mutate, refetch }] = createResource(fetchTodos);
mutate(prev => [...prev, newTodo]);
await saveTodo(newTodo);
refetch();
```

In 2.0, `createOptimisticStore` + `action` addresses all three: store-backed granular updates, automatic reconciliation on refresh, and transition coordination that prevents race conditions:

```js
// 2.0 — granular updates, reconciled refresh, race-safe
const [todos, setOptimisticTodos] = createOptimisticStore(fetchTodos, []);

const addTodo = action(function* (todo) {
  setOptimisticTodos(s => { s.push(todo); });
  yield saveTodo(todo);
  refresh(todos);
});
```

Use optimistic state for the mutation's user-visible intent. `refresh()` is the follow-up invalidation that reconciles the optimistic view with the source of truth; it should not be used as a separate “refreshing” UI flag.

#### Error handling

In 1.x, `resource.error` provided an alternative branching path that bypassed `ErrorBoundary` entirely. Code could check `.error` inline and render error UI without ever throwing — which meant `ErrorBoundary` wouldn't catch it, SSR couldn't know the tree had failed, and error handling was split between two mechanisms that didn't compose:

```jsx
// 1.x — two parallel error paths that don't compose
const [user] = createResource(id, fetchUser);

// Path A: inline check (bypasses ErrorBoundary, invisible to SSR)
<Show when={user.error} fallback={<Profile user={user()} />}>
  <p>{user.error.message}</p>
</Show>

// Path B: ErrorBoundary
<ErrorBoundary fallback={err => <p>{err.message}</p>}>
  <Profile user={user()} />
</ErrorBoundary>
```

In 2.0, there's one path: async errors propagate through the reactive graph and are caught by `Errored` boundaries (or the `error` option on `createEffect`). No alternative branching, predictable SSR behavior:

```jsx
// 2.0 — one error path, composable with SSR
<Errored fallback={err => <p>{err().message}</p>}>
  <Profile user={user()} />
</Errored>
```

### `startTransition` / `useTransition`

Removed in favor of built-in transition behavior. Pending UI should be expressed via `Loading` and `isPending`. Optimistic UI should use RFC 06 primitives.

## Removals

| Removed | Replacement |
|--------|-------------|
| `createResource` | Async computations (`createMemo`, `createStore(fn)`, projections) + `Loading` |
| `useTransition` / `startTransition` | Built-in transitions; use `Loading`, `isPending`, optimistic APIs |

## Alternatives considered

- Keeping `createResource`: rejected to avoid parallel async models and duplicated surface area.
- Keeping explicit transition wrappers: rejected because transitions are a scheduling concern that should be inferred and managed by the runtime.
