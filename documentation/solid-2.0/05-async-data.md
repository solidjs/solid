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

### Transitions: built-in, multiple in flight

2.0 treats transitions as a core scheduling concept rather than something you explicitly wrap in `startTransition`/`useTransition`. Multiple transitions can be in flight; “entangling” determines what should block what. The user-facing pieces are the observable pending state (`isPending`) and optimistic APIs (RFC 06).

## Migration / replacement

### `createResource` → async computations + `Loading`

```js
// 1.x
const [user] = createResource(id, fetchUser);

// 2.0
const user = createMemo(() => fetchUser(id()));
```

Wrap reads of async accessors in `Loading` to control where fallback UI appears.

### `.loading` → `isPending`

Replace resource-specific flags with expression-level pending checks.

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
