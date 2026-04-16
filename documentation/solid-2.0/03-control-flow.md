# RFC: Control flow

**Start here:** If you’re migrating an app, read the beta tester guide first: [MIGRATION.md](MIGRATION.md)

## Summary

Solid 2.0 simplifies and unifies control-flow APIs by consolidating list rendering into a single `For` signature (covering the old `For`/`Index` split), introducing `Repeat` for range/count-based rendering, and renaming/reshaping async and error boundaries as `Loading` and `Errored`. The goal is fewer “nearly-the-same” APIs, more explicit keying semantics, and control-flow callbacks that are consistent with the 2.0 reactivity model.

## Motivation

- **One list primitive:** Having both `For` and `Index` encourages bikeshedding and accidental misuse. A single `For` that can be keyed or index-based is easier to teach and document.
- **Ranges without diffing:** Rendering “count-based” lists (skeletons, ranges, windowing) shouldn’t require list diffing; `Repeat` expresses this directly.
- **Async and error UX:** Names like Suspense and ErrorBoundary are long and carry baggage. `Loading` and `Errored` are concise and align better with their actual role in the 2.0 async model.

## Detailed design

### List rendering: `For` (keyed, non-keyed, custom key)

`For` takes `each`, optional `fallback`, optional `keyed`, and a children mapping function that receives **accessors** for both the item and the index.

```jsx
// Default keyed behavior (identity)
<For each={todos()}>
  {(todo, i) => <TodoRow todo={todo()} index={i()} />}
</For>

// Index-style behavior (reuse by index)
<For each={todos()} keyed={false}>
  {(todo, i) => <TodoRow todo={todo()} index={i()} />}
</For>

// Custom key
<For each={todos()} keyed={(t) => t.id}>
  {(todo) => <TodoRow todo={todo()} />}
</For>

// Fallback
<For each={todos()} fallback={<EmptyState />}>
  {(todo) => <TodoRow todo={todo()} />}
</For>
```

Notes:

- `keyed={false}` is the direct replacement for `Index`.
- `keyed={(item) => key}` is the escape hatch for stable keys without having to pre-normalize lists.

### Range/count rendering: `Repeat`

`Repeat` renders based on `count` (and optional `from`), with no list diffing. Unlike `For`, children receive a **plain number** (not an accessor) — the index itself is stable and never changes for a given slot.

This is primarily intended for use with **stores**, where the data at each index manages its own granular updates. The index is just a stable lookup key; reactivity comes from the store reads, not the index changing:

```jsx
// Store-backed list: index is stable, store handles granular updates
<Repeat count={store.items.length}>
  {(i) => <Row name={store.items[i].name} status={store.items[i].status} />}
</Repeat>
```

```jsx
// Skeletons
<Repeat count={10}>{(i) => <Skeleton key={i} />}</Repeat>

// Windowing / offset
<Repeat count={visibleCount()} from={start()}>
  {(i) => <Row index={i} />}
</Repeat>

// Fallback when count is 0
<Repeat count={store.items.length} fallback={<EmptyState />}>
  {(i) => <div>{store.items[i].label}</div>}
</Repeat>
```

### Conditionals: `Show`

`Show` supports element children or function children. Function children receive a narrowed accessor.

```jsx
<Show when={user()} fallback={<Login />}>
  {(u) => <Profile user={u()} />}
</Show>

// Keyed form (treats value identity as the switching condition)
<Show when={user()} keyed>
  {(u) => <Profile user={u()} />}
</Show>
```

### Branching: `Switch` / `Match`

`Switch` picks the first matching `Match`. `Match` supports element or function children.

```jsx
<Switch fallback={<NotFound />}>
  <Match when={route() === "home"}>
    <Home />
  </Match>
  <Match when={route() === "profile"}>
    <Profile />
  </Match>
</Switch>
```

### Async boundary: `Loading`

`Loading` is the boundary for async computations. It shows `fallback` while async values required by its subtree are not ready.

```jsx
<Loading fallback={<Spinner />}>
  <UserProfile id={params.id} />
</Loading>
```

In 2.0’s async model, async values are part of computations (not a separate `createResource`), so `Loading` is the user-facing “this subtree may suspend” boundary.

`Loading` also accepts an `on` prop to control when the boundary re-shows its fallback during revalidation. See [RFC 05](05-async-data.md) for details.

### Error boundary: `Errored`

`Errored` is the error boundary. It supports a static fallback or a callback form that receives the error and a reset function.

```jsx
<Errored
  fallback={(err, reset) => (
    <div>
      <p>Something went wrong.</p>
      <pre>{String(err)}</pre>
      <button onClick={reset}>Retry</button>
    </div>
  )}
>
  <Page />
</Errored>
```

### Reveal timing: `Reveal`

`Reveal` coordinates the reveal timing of sibling `Loading` boundaries. It replaces `SuspenseList` from 1.x.

- **Sequential** (default): boundaries reveal in DOM order as each resolves.
- **Together** (`together`): all boundaries wait until the group is ready, then reveal at once.
- **Collapsed** (`collapsed`, sequential only): only the frontier boundary shows its fallback; later boundaries produce nothing until their turn.

```jsx
<Reveal>
  <Loading fallback={<Skeleton />}><ProfileHeader /></Loading>
  <Loading fallback={<Skeleton />}><Posts /></Loading>
</Reveal>

// Together mode — all reveal at once
<Reveal together>
  <Loading fallback={<Skeleton />}><ProfileHeader /></Loading>
  <Loading fallback={<Skeleton />}><Posts /></Loading>
</Reveal>

// Collapsed mode — only the frontier shows fallback
<Reveal collapsed>
  <Loading fallback={<Skeleton />}><ProfileHeader /></Loading>
  <Loading fallback={<Skeleton />}><Posts /></Loading>
</Reveal>
```

## Migration / replacement

### `SuspenseList` → `Reveal`

```jsx
// 1.x
<SuspenseList revealOrder="forwards">
  <Suspense fallback={<Skeleton />}><ProfileHeader /></Suspense>
  <Suspense fallback={<Skeleton />}><Posts /></Suspense>
</SuspenseList>

// 2.0
<Reveal>
  <Loading fallback={<Skeleton />}><ProfileHeader /></Loading>
  <Loading fallback={<Skeleton />}><Posts /></Loading>
</Reveal>
```

### `Index` → `For keyed={false}`

```jsx
// 1.x
<Index each={items()}>
  {(item, i) => <Row item={item()} index={i} />}
</Index>

// 2.0
<For each={items()} keyed={false}>
  {(item, i) => <Row item={item()} index={i()} />}
</For>
```

### `Suspense` → `Loading`

```jsx
// 1.x
<Suspense fallback={<Spinner />}>
  <Page />
</Suspense>

// 2.0
<Loading fallback={<Spinner />}>
  <Page />
</Loading>
```

### `ErrorBoundary` → `Errored`

```jsx
// 1.x
<ErrorBoundary fallback={(err, reset) => <Fallback err={err} reset={reset} />}>
  <Page />
</ErrorBoundary>

// 2.0
<Errored fallback={(err, reset) => <Fallback err={err} reset={reset} />}>
  <Page />
</Errored>
```

## Removals

| Removed | Replacement |
|--------|-------------|
| `Index` | `For keyed={false}` |
| `Suspense` | `Loading` |
| `SuspenseList` | `Reveal` |
| `ErrorBoundary` | `Errored` |

## Alternatives considered

- Keeping both `For` and `Index`: rejected in favor of one API with explicit keying.
- Adding a separate “range” mode to `For`: rejected in favor of a dedicated `Repeat` that makes “no diffing” obvious.

