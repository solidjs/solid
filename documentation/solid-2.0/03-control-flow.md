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

`Repeat` renders based on `count` (and optional `from`), with no list diffing. It’s useful for skeletons, numeric ranges, and windowed UIs.

```jsx
// 10 items: 0..9
<Repeat count={10}>{(i) => <Item index={i} />}</Repeat>

// Windowing / offset
<Repeat count={visibleCount()} from={start()}>
  {(i) => <Row index={i} />}
</Repeat>

// Fallback when count is 0
<Repeat count={items.length} fallback={<EmptyState />}>
  {(i) => <div>{items[i]}</div>}
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

## Migration / replacement

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
| `ErrorBoundary` | `Errored` |

## Alternatives considered

- Keeping both `For` and `Index`: rejected in favor of one API with explicit keying.
- Adding a separate “range” mode to `For`: rejected in favor of a dedicated `Repeat` that makes “no diffing” obvious.

## Open questions

- Should `For` default to keyed-by-identity explicitly documented as the default (vs relying on undefined meaning “keyed”)? If so, should `keyed` default to `true` in docs and types?
