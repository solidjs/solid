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

#### Props

- `order` — `"sequential" | "together" | "natural"`, defaults to `"sequential"`.
  - `"sequential"` — boundaries reveal in DOM order. Later boundaries stay on their fallbacks until every earlier one has resolved.
  - `"together"` — all boundaries keep their fallbacks until the whole group is ready, then the whole group reveals at once.
  - `"natural"` — each boundary reveals as soon as its own data resolves; there is no frontier inside the group. At the top level this is equivalent to not using a `Reveal` at all — its purpose is [nesting](#nesting) (see below), where it marks "this subtree is one composite slot to my parent, but its children don't coordinate with each other".
- `collapsed` — `boolean`. Only consulted when `order="sequential"` (ignored under `"together"` and `"natural"`). When set, boundaries past the current frontier render nothing instead of their own fallback; only the frontier fallback is visible.

```jsx
// Sequential (default) — reveals top-to-bottom as each resolves.
<Reveal>
  <Loading fallback={<Skeleton />}><ProfileHeader /></Loading>
  <Loading fallback={<Skeleton />}><Posts /></Loading>
</Reveal>

// Together — every boundary waits for the whole group, then reveals at once.
<Reveal order="together">
  <Loading fallback={<Skeleton />}><ProfileHeader /></Loading>
  <Loading fallback={<Skeleton />}><Posts /></Loading>
</Reveal>

// Collapsed (sequential-only) — only the frontier shows a fallback.
<Reveal collapsed>
  <Loading fallback={<Skeleton />}><ProfileHeader /></Loading>
  <Loading fallback={<Skeleton />}><Posts /></Loading>
</Reveal>
```

#### Nesting

A nested `<Reveal>` acts as a single composite slot to its parent: the parent's ordering decides when the inner slot is allowed to reveal. Until then the inner group is **held**: every descendant boundary stays on its fallback, even if its own data has already resolved. Once the parent releases the slot, the inner group resumes its own `order` locally.

This rule is absolute. There is no opt-out: wrapping children in an extra `<Loading>` does not let them escape an outer hold, because the `<Loading>` is itself just another slot that the parent holds. If you need a subtree to reveal independently of an outer group, do not nest it under that group.

##### Minimally ready

Each order defines when it has "first visible content" under its own policy. This is the threshold that upward notifications use to report readiness to an enclosing `Reveal`:

- `sequential` — frontier-0 (the first registered slot) has reached its own minimally-ready state.
- `together` — every direct slot has reached its own minimally-ready state.
- `natural` — any direct slot has produced visible content (leaves on resolve; nested composites when their whole subtree is ready, since natural treats a composite as one atomic slot).

For a leaf `<Loading>`, "minimally ready" and "fully ready" are the same thing: its data resolved. For a nested `<Reveal>`, the two differ — e.g. a nested `sequential` is minimally ready once its first child resolves, even though later children are still pending.

`order="together"` uses minimal readiness (not full readiness) to decide when to release. This keeps a nested `together` composable: an outer `together` doesn't have to wait for every grandchild to resolve; it releases as soon as every direct child is showing something. After release, each inner group keeps running its own order over anything still pending.

##### Nesting matrix

| Outer `order` | Inner `order` | Outer release condition | After outer releases, inner siblings behave as |
|---|---|---|---|
| `sequential` | `sequential` | Outer frontier reaches the inner slot. | Inner reveals in registration order; outer frontier waits for the inner group to finish before advancing past it. |
| `sequential` | `together` | Outer frontier reaches the inner slot. | Inner reveals atomically once every inner child is ready. |
| `sequential` | `natural` | Outer frontier reaches the inner slot. | Inner reveals per-slot: each leaf on resolve, each grandchild composite when fully ready. |
| `together` | `sequential` | Every direct child of the outer `together` is minimally ready; that means the inner's frontier-0 has resolved. | Inner reveals its frontier-0 immediately with the group release, then continues its own sequential order for the tail. |
| `together` | `together` | Every direct child of the outer is minimally ready; that means the inner `together` has all its own children ready. | Inner reveals atomically as part of the same group release. |
| `together` | `natural` | Every direct child of the outer is minimally ready; that means at least one inner child is ready. | Already-resolved inner children flush with the group release; later inner resolutions stream independently under natural. |
| `natural` | `sequential` | The inner composite is fully ready (i.e. every inner child has resolved). | Inner group is fully ready at release; all inner children flush together. |
| `natural` | `together` | The inner composite is fully ready. | Same as above. |
| `natural` | `natural` | The inner composite is fully ready. | Same as above. |

`order="natural"` is primarily useful when you have a group whose children don't need to coordinate with each other. Nesting a natural group under an outer ordering lets the natural group participate as one unit in the outer order while each child reveals on its own data once the outer releases the slot.

```jsx
<Reveal>
  <Loading fallback={<Skeleton />}><Header /></Loading>
  <Reveal order="natural">
    <Loading fallback={<CardSkel />}><Card id={1} /></Loading>
    <Loading fallback={<CardSkel />}><Card id={2} /></Loading>
    <Loading fallback={<CardSkel />}><Card id={3} /></Loading>
  </Reveal>
  <Loading fallback={<Skeleton />}><Footer /></Loading>
</Reveal>
```

Here the outer sequential order ensures `Header` reveals first; until it does, the cards section stays on its fallbacks even if card data arrives early. Once the frontier reaches the cards section, natural takes over inside and each card reveals independently as its own data resolves. `Footer` waits for the whole cards composite to finish before it reveals.

#### SSR behavior

- `renderToString` fully supports `order="sequential"` without `collapsed`, and `order="natural"`.
- `order="together"` and `collapsed` rely on streamed activation and therefore require `renderToStream` / `renderToStringAsync` to behave correctly. Using them with `renderToString` inside a nested `Reveal` logs a warning.
- Under streaming, the rules above apply identically: held fragments stream their resolved HTML into templates as data arrives, but the swap from fallback to content is deferred until the enclosing `Reveal` releases the slot. Swaps then happen in resolution order within the released group.

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

