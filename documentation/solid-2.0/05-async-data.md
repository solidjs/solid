# RFC: Async data

**Start here:** If you’re migrating an app, read the beta tester guide first: [MIGRATION.md](MIGRATION.md)

## Summary

Solid 2.0 makes async a first-class capability of computations: `createMemo`, derived stores, and other computations can return **Promises** or **AsyncIterables**, and consumers interact with them through normal accessors. Pending async values suspend by throwing an internal “not ready” signal through the reactive graph, and `Loading` is the boundary that turns that suspension into UI. This removes the need for a separate `createResource` primitive. For “stale while revalidating” UI and coordination, 2.0 provides `isPending(fn)` and `latest(fn)`.

## Motivation

- **One model:** Async shouldn’t require a parallel set of primitives (resources vs signals). If computations can be async, the rest of the system (effects, boundaries, SSR/hydration) can treat async consistently.
- **Better types:** Async values can be represented without pervasive `T | undefined` “loading holes”. UI should be expressed via `Loading` boundaries rather than nullable types.
- **Composability:** When async is part of computations, derived values can combine sync + async naturally without bespoke resource combinators.

## Detailed design

### Async in computations (no `createResource`)

Any computation may return a Promise (or AsyncIterable) to represent pending work. Consumers read the accessor as usual; if it isn’t ready, the graph suspends until it resolves.

```js
const user = createMemo(() => fetchUser(params.id));

function Profile() {
  // user() suspends if not ready — wrap in <Loading>
  return <div>{user().name}</div>;
}

<Loading fallback={<Spinner />}>
  <Profile />
</Loading>
```

This pushes “loading state” to UI structure (boundaries) instead of leaking into every type.

### `Loading` is the UI boundary

`Loading` shows fallback while the subtree needs unresolved async values.

Importantly, `Loading` is intended to cover **initial readiness**: it handles the first time a subtree attempts to read async-derived values that are not ready yet. After the subtree has produced a value, subsequent revalidation/refresh should generally not “kick you back” into the fallback; use `isPending` for “background work is happening” UI.

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

### `isPending(fn)` (stale-while-revalidating queries)

`isPending` answers: “Does this expression currently have pending async work while also having a usable stale value?”

This means `isPending` is **false during the initial `Loading` fallback** (there is no stale value yet, and the suspended subtree isn’t producing UI). It becomes useful once you’ve rendered at least once and want to show “refreshing…” indicators during revalidation without replacing the whole subtree with a spinner again.

```js
const users = createMemo(() => fetchUsers());
const posts = createMemo(() => fetchPosts());

const listPending = () => isPending(() => users() || posts());

return (
  <>
    <Show when={listPending()}>{/* subtle "refreshing…" indicator */}</Show>
    <Loading fallback={<Spinner />}>
      <List users={users()} posts={posts()} />
    </Loading>
  </>
);
```

The intent is to replace `.loading`-style flags that belong to a specific primitive (`createResource`) with something that works for any expression.

### `latest(fn)` (peek at in-flight values)

`latest(fn)` reads the “in flight” value of a signal/computation during transitions, and may fall back to stale if the next value isn’t available yet.

```js
const [userId, setUserId] = createSignal(1);
const user = createMemo(() => fetchUser(userId()));

// During a transition, this can reflect the in-flight userId
const latestUserId = () => latest(userId);
```

### `isRefreshing()` (are we inside a refresh cycle?)

`isRefreshing()` returns `true` when code is executing inside a `refresh()` cycle. This can be used inside computations to distinguish between initial evaluation and a refresh-triggered recomputation.

```js
const data = createMemo(async () => {
  const id = userId();
  if (isRefreshing()) console.log("refreshing data for", id);
  return fetchUser(id);
});
```

### `resolve(fn)` (wait for a reactive expression to settle)

`resolve(fn)` returns a Promise that resolves once the reactive expression `fn` produces a settled (non-pending) value. It cannot be called inside a reactive scope (it only resolves the current value and does not track updates).

```js
// Wait for an async memo to have a value
const user = await resolve(() => userMemo());

// Useful in tests or imperative code
const result = await resolve(() => computedValue());
```

### Transitions: built-in, multiple in flight

2.0 treats transitions as a core scheduling concept rather than something you explicitly wrap in `startTransition`/`useTransition`. Multiple transitions can be in flight; “entangling” determines what should block what. The user-facing pieces are the observable pending state (`isPending`) and optimistic APIs (RFC 06).

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

In 1.x, `.loading` was a property on the resource itself. In 2.0, loading state is structural (handled by `Loading` boundaries for initial load) and expression-level for revalidation:

```js
// 1.x
const [user] = createResource(id, fetchUser);
<Show when={user.loading}>Refreshing...</Show>

// 2.0
const user = createMemo(() => fetchUser(id()));
<Show when={isPending(() => user())}>Refreshing...</Show>
```

Remember: `isPending` is **false** during the initial `Loading` fallback (there's no stale value yet). It only becomes true during revalidation.

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
<Errored fallback={err => <p>{err.message}</p>}>
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
