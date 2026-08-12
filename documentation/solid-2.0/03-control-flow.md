# RFC: Control flow

**Start here:** If you’re migrating an app, read the migration guide first: [MIGRATION.md](MIGRATION.md)

## Summary

Solid 2.0 simplifies and unifies control-flow APIs by consolidating list rendering into a single `For` signature (covering the old `For`/`Index` split), introducing `Repeat` for range/count-based rendering, renaming/reshaping async and error boundaries as `Loading` and `Errored`, and reshaping `createDynamic` into a `lazy`-style `dynamic` factory that returns a stable `Component`. The goal is fewer “nearly-the-same” APIs, more explicit keying semantics, and control-flow callbacks that expose reactive accessors only where the callback argument can actually change.

## Motivation

- **One list primitive:** Having both `For` and `Index` encourages bikeshedding and accidental misuse. A single `For` that can be keyed or index-based is easier to teach and document.
- **Ranges without diffing:** Rendering “count-based” lists (skeletons, ranges, windowing) shouldn’t require list diffing; `Repeat` expresses this directly.
- **Async and error UX:** Names like Suspense and ErrorBoundary are long and carry baggage. `Loading` and `Errored` are concise and align better with their actual role in the 2.0 async model.
- **Dynamic components as values:** A factory that returns a stable `Component<P>` composes cleanly with JSX (reactive props, children, refs) and with the async-computation model — async sources flow through `Loading` via the same `NotReadyError` path as any other not-ready reactive read.

## Detailed design

### List rendering: `For` (keyed, non-keyed, custom key)

`For` takes `each`, optional `fallback`, optional `keyed`, and a children mapping function whose arguments depend on the keying mode:

- Default / `keyed={true}`: `(item, index)` where `item` is the raw row value and `index` is an accessor, because keyed rows can move.
- `keyed={false}`: `(item, index)` where `item` is an accessor and `index` is a plain number, matching the old `Index` stability model.
- `keyed={(item) => key}`: `(item, index)` where both arguments are accessors, because the row can be preserved while either argument changes.

```jsx
// Default keyed behavior (identity)
<For each={todos()}>
  {(todo, i) => <TodoRow todo={todo} index={i()} />}
</For>

// Index-style behavior (reuse by index)
<For each={todos()} keyed={false}>
  {(todo, i) => <TodoRow todo={todo()} index={i} />}
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
- Avoid dynamic boolean `keyed` values with function children. The callback shape is mode-specific, so prefer a literal `true`, literal `false`, or a custom key function.

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

`Show` supports element children or function children. Non-keyed function children receive a narrowed accessor. Keyed function children receive the raw narrowed value, matching Solid 1.x keyed behavior.

```jsx
<Show when={user()} fallback={<Login />}>
  {(u) => <Profile user={u()} />}
</Show>

// Keyed form (treats value identity as the switching condition)
<Show when={user()} keyed>
  {(u) => <Profile user={u} />}
</Show>
```

### Branching: `Switch` / `Match`

`Switch` picks the first matching `Match`. `Match` supports element or function children. Like `Show`, keyed function children receive the raw narrowed value and non-keyed function children receive an accessor.

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

In 2.0’s async model, async values are part of computations (not a separate `createResource`), so `Loading` is the user-facing “this subtree may be not ready yet” boundary.

`Loading` also accepts an `on` prop to control when the boundary re-shows its fallback during revalidation. See [RFC 05](05-async-data.md) for details.

### Error boundary: `Errored`

`Errored` is the error boundary. It supports a static fallback or a callback form that receives an error accessor and a reset function.

The reset function is an action: pass it to event handlers or other imperative code to retry the errored branch.

```jsx
<Errored
  fallback={(err, reset) => (
    <div>
      <p>Something went wrong.</p>
      <pre>{String(err())}</pre>
      <button onClick={reset}>Retry</button>
    </div>
  )}
>
  <Page />
</Errored>
```

### Dynamic components: `dynamic` factory and `<Dynamic>`

Solid 2.0 reshapes `createDynamic` into a `lazy`-style factory named `dynamic`. Given a source that produces a component (or native tag name), `dynamic` returns a **stable `Component<P>`** whose identity is driven reactively. The returned value is usable anywhere a component is — children, refs, and reactive props flow through the normal JSX path.

```jsx
import { dynamic } from "@solidjs/web";

// Reactive swap between two components
const Active = dynamic(() => isEditing() ? Editor : Viewer);
return <Active value={value()} />;

// Native tag swap
const Tag = dynamic(() => multiline() ? "textarea" : "input");
return <Tag value={value()} />;
```

The `<Dynamic component={...}>` JSX wrapper from 1.x still exists and is unchanged at the call site; it is now a thin delegate over `dynamic`:

```jsx
<Dynamic component={isEditing() ? Editor : Viewer} value={value()} />
```

#### Async sources and `Loading`

`source` may return a `Promise<Component | string | undefined>`. The factory composes with `Loading` / `Errored` through the normal `NotReadyError` flow — no separate suspense primitive or user-side `await`.

#### Notes

- The source evaluation is shared across all mounted instances of the returned component, so using one `dynamic(...)` in many places doesn't duplicate work.

### Client-only components: `clientOnly`

`clientOnly` (from `@solidjs/web`, hoisted from SolidStart) wraps a dynamically imported component so it renders only in the browser — the same factory shape as `lazy`/`dynamic`, with an SSR contract: the server renders `props.fallback` (and nothing else) and never starts the import.

```jsx
import { clientOnly } from "@solidjs/web";

const Chart = clientOnly(() => import("./Chart.jsx"));

<Chart fallback={<div>Loading chart…</div>} data={data()} />;
```

Unlike `lazy()`, it avoids Suspense entirely — it composes with no `Loading` boundary — and never server-renders the wrapped component, so the component participates in no hydration asset manifest and its code is guaranteed never to run on the server. This is the tool for browser-only libraries: anything that touches `window`, measures the DOM, or simply can't be loaded in a server build.

Hydration is mismatch-free by construction: during hydration the client renders the fallback exactly as the server did — the server-rendered fallback DOM is claimed, not re-created — and the swap to the real component happens only after the tree has settled. In pure client rendering (no hydration), the fallback shows until the import resolves.

By default the import starts as soon as `clientOnly(...)` is called (module load); pass `{ lazy: true }` to defer it to the component's first render. Either way the importer is invoked at most once, no matter how many instances render — all instances share the loaded module.

Bundler integrations sharpen the load path further: the compiler's module-URL pass (the same one that annotates `lazy()` calls, shipped through @solidjs/vite-plugin) recognizes `clientOnly(() => import("..."))` and injects the wrapped module's resolved URL into the call, which the server half uses to emit an early `modulepreload` hint — the browser starts fetching the component's chunk with the page instead of discovering it when the import first runs after hydration.

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

Group *membership* is direct-children-only: every boundary (`<Loading>` or `<Errored>`) severs reveal coordination for its subtree. A `<Loading>` nested inside another slot's content — or wrapped in an `<Errored>` — does not join the group and never delays its release; it is covered by its own fallback inside the (possibly held) slot and settles on its own schedule. While the enclosing slot is still held, any content the severed boundary streams is queued and applied the moment the slot goes live.

##### Minimally ready

Each order defines when it has "first visible content" under its own policy. This is the threshold that upward notifications use to report readiness to an enclosing `Reveal`:

- `sequential` — frontier-0 (the first registered slot) has reached its own minimally-ready state.
- `together` — every direct slot has reached its own minimally-ready state.
- `natural` — any direct slot has reached its own minimally-ready state (leaves on resolve; nested composites according to their own order).

For a leaf `<Loading>`, "minimally ready" and "fully ready" are the same thing: its data resolved. For a nested `<Reveal>`, the two differ — e.g. a nested `sequential` is minimally ready once its first child resolves, even though later children are still pending.

`order="together"` uses minimal readiness (not full readiness) to decide when to release. This keeps a nested `together` composable: an outer `together` doesn't have to wait for every grandchild to resolve; it releases as soon as every direct child is showing something. After release, each inner group keeps running its own order over anything still pending.

##### Nesting matrix

| Outer `order` | Inner `order` | Outer release condition | After outer releases, inner siblings behave as |
|---|---|---|---|
| `sequential` | `sequential` | Outer frontier reaches the inner slot. | Inner reveals in registration order; outer frontier waits for the inner group to finish before advancing past it. |
| `sequential` | `together` | Outer frontier reaches the inner slot. | Inner reveals atomically once every inner child is ready. |
| `sequential` | `natural` | Outer frontier reaches the inner slot. | Inner reveals per-slot: each leaf on resolve, while each grandchild composite runs its own order locally. |
| `together` | `sequential` | Every direct child of the outer `together` is minimally ready; that means the inner's frontier-0 has resolved. | Inner reveals its frontier-0 immediately with the group release, then continues its own sequential order for the tail. |
| `together` | `together` | Every direct child of the outer is minimally ready; that means the inner `together` has all its own children ready. | Inner reveals atomically as part of the same group release. |
| `together` | `natural` | Every direct child of the outer is minimally ready; that means at least one inner child is ready. | Already-resolved inner children flush with the group release; later inner resolutions stream independently under natural. |
| `natural` | `sequential` | Immediately; outer `natural` does not hold the inner composite. | Inner reveals in registration order. |
| `natural` | `together` | Immediately; outer `natural` does not hold the inner composite. | Inner reveals atomically once every direct child is minimally ready. |
| `natural` | `natural` | Immediately; outer `natural` does not hold the inner composite. | Inner children reveal independently. |

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
- `order="together"` and `collapsed` rely on streamed activation and therefore require `renderToStream` to behave correctly. Using them with `renderToString` inside a nested `Reveal` logs a warning.
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
  {(item, i) => <Row item={item()} index={i} />}
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

### `createDynamic(source, props)` → `dynamic(source)` factory

```jsx
// 1.x
import { createDynamic } from "solid-js/web";
createDynamic(() => current(), { value: value() });

// 2.0 — factory form
import { dynamic } from "@solidjs/web";
const Active = dynamic(() => current());
return <Active value={value()} />;

// 2.0 — manual composition, if you really want a one-shot call
createComponent(dynamic(() => current()), { value: value() });
```

The `<Dynamic component={...}>` JSX wrapper is unchanged at the call site; most users don't need to touch anything.

## Removals

| Removed | Replacement |
|--------|-------------|
| `Index` | `For keyed={false}` |
| `Suspense` | `Loading` |
| `SuspenseList` | `Reveal` |
| `ErrorBoundary` | `Errored` |
| `createDynamic(source, props)` | `dynamic(source)` factory (`<Dynamic>` unchanged) |

## Alternatives considered

- Keeping both `For` and `Index`: rejected in favor of one API with explicit keying.
- Adding a separate “range” mode to `For`: rejected in favor of a dedicated `Repeat` that makes “no diffing” obvious.

