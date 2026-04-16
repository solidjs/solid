# Solid 2.0 (beta) — quick migration guide

This is a short, practical guide for migrating from Solid 1.x to Solid 2.0’s APIs. It focuses on the changes you’ll hit most often and shows “before/after” examples.

## Quick checklist (start here)

- **Imports**: some 1.x subpath imports moved to `@solidjs/*` packages (and store helpers moved into `solid-js`).
- **Batching/reads**: setters don’t immediately change what reads return; values become visible after the microtask batch flushes (or via `flush()`).
- **Effects**: `createEffect` is split (compute → apply). Cleanup is usually “return a cleanup function”.
- **Lifecycle**: `onMount` is replaced by `onSettled` (and it can return cleanup).
- **Async UI**: use `<Loading>` for first readiness; use `isPending(() => expr)` for “refreshing…” indicators.
- **Lists**: `Index` is gone; use `<For keyed={false}>`. `For` children receive accessors (`item()`/`i()`).
- **Stores**: prefer draft-first setters; `storePath(...)` exists as an opt-in helper for the old path-style ergonomics.
- **Plain values**: `snapshot(store)` replaces `unwrap(store)` when you need a plain non-reactive value.
- **DOM**: `use:` directives are removed; use `ref` directive factories (and array refs).
- **Helpers**: `mergeProps` → `merge`, `splitProps` → `omit`.

## Core behavior changes

### Imports: where things live now

In Solid 2.0 beta, the DOM/web runtime is its own package, and some “subpath imports” from 1.x are gone.

```ts
// 1.x (DOM runtime)
import { render, hydrate } from "solid-js/web";

// 2.0 beta
import { render, hydrate } from "@solidjs/web";
```

```ts
// 1.x (stores)
import { createStore } from "solid-js/store";

// 2.0 beta (stores are exported from solid-js)
import { createStore, reconcile, snapshot, storePath } from "solid-js";
```

```ts
// 1.x (hyperscript / alternate JSX factory)
import h from "solid-js/h";

// 2.0 beta
import h from "@solidjs/h";
```

```ts
// 1.x (tagged-template HTML)
import html from "solid-js/html";

// 2.0 beta
import html from "@solidjs/html";
```

```ts
// 1.x (custom renderers)
import { createRenderer } from "solid-js/universal";

// 2.0 beta
import { createRenderer } from "@solidjs/universal";
```

### Batching & reads: values update after flush

In Solid 2.0, updates are batched by default (microtasks). A key behavioral change is that **setters don’t immediately update what reads return** — the new value becomes visible when the batch is flushed (next microtask), or immediately if you call `flush()`.

```js
const [count, setCount] = createSignal(0);

setCount(1);
count(); // still 0

flush();
count(); // now 1
```

Use `flush()` sparingly (it forces the system to “catch up now”). It’s most useful in tests, or in rare imperative code where you truly need a synchronous “settled now” point.

### Effects, lifecycle, and cleanup

Solid 2.0 splits effects into two phases:

- a **compute** function that runs in the reactive tracking phase and returns a value
- an **apply** function that receives that value and performs side effects (and can return cleanup)

```js
// 1.x (single function effect)
createEffect(() => {
  el().title = name();
});

// 2.0 (split effect: compute -> apply)
createEffect(
  () => name(),
  value => {
    el().title = value;
  }
);
```

Cleanup usually lives on the apply side now:

```js
// 1.x
createEffect(() => {
  const id = setInterval(() => console.log(name()), 1000);
  onCleanup(() => clearInterval(id));
});

// 2.0
createEffect(
  () => name(),
  value => {
    const id = setInterval(() => console.log(value), 1000);
    return () => clearInterval(id);
  }
);
```

If you used `onMount`, the closest replacement is `onSettled` (and it can also return cleanup):

```js
// 1.x
onMount(() => {
  measureLayout();
});

// 2.0
onSettled(() => {
  measureLayout();
  const onResize = () => measureLayout();
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);
});
```

### Dev warnings you’ll likely see (and how to fix them)

These are **dev-only warnings** meant to catch subtle bugs earlier.

#### “Top-level reactive read” in a component

In 2.0, reading reactive values at the top level of a component body (including destructuring props) will warn. The fix is usually to move the read into a reactive scope (`createMemo`/`createEffect`) or make the intent explicit with `untrack`.

```jsx
// ❌ 2.0 warns (top-level reactive read)
function Bad(props) {
  const n = props.count;
  return <div>{n}</div>;
}

// ✅ read inside JSX/expression
function Ok(props) {
  return <div>{props.count}</div>;
}
```

```jsx
// ❌ 2.0 warns (common: destructuring in args)
function BadArgs({ title }) {
  return <h1>{title}</h1>;
}

// ✅ keep props object, or destructure inside a memo/effect
function OkArgs(props) {
  return <h1>{props.title}</h1>;
}
```

#### “Write inside reactive scope” (owned scope)

Writing to signals/stores inside a reactive scope will warn. Usually you want:

- derive values with `createMemo` (no write-back)
- write in event handlers / actions
- return cleanup from effect apply functions (instead of writing during tracking)

```js
// ❌ warns: writing from inside a memo
createMemo(() => setDoubled(count() * 2));

// ✅ derive instead of writing back
const doubled = createMemo(() => count() * 2);
```

If you truly have an **internal** signal that needs to be written from within owned scope (not app state), opt in narrowly with `pureWrite: true`.

## Async data & transitions

### `Suspense` / `ErrorBoundary` → `Loading` / `Errored`

```jsx
// 1.x
<Suspense fallback={<Spinner />}>
  <Profile />
</Suspense>

// 2.0
<Loading fallback={<Spinner />}>
  <Profile />
</Loading>
```

### `createResource` → async computations + `Loading`

```js
// 1.x
const [user] = createResource(id, fetchUser);

// 2.0
const user = createMemo(() => fetchUser(id()));
```

```jsx
<Loading fallback={<Spinner />}>
  <Profile user={user()} />
</Loading>
```

### Initial loading vs revalidation: `Loading` vs `isPending`

- **`Loading`**: initial “not ready yet” UI boundary.
- **`isPending`**: “stale while revalidating” indicator; **false during the initial `Loading` fallback**.

```jsx
const listPending = () => isPending(() => users() || posts());

<>
  <Show when={listPending()}>{/* subtle "refreshing…" indicator */}</Show>
  <Loading fallback={<Spinner />}>
    <List users={users()} posts={posts()} />
  </Loading>
</>
```

### Peeking in-flight values: `latest(fn)`

```js
const latestId = () => latest(id);
```

### “Refetch/refresh” patterns → `refresh()`

```js
// After a server write, explicitly recompute a derived read:
refresh(storeOrProjection);

// Or re-run a read tree:
refresh(() => query.user(id()));
```

### Mutations: `action(...)` + optimistic helpers

In 1.x, mutations often ended up as “call an async function, flip some flags, then manually refetch”. In 2.0, the recommended shape is:

- wrap mutations in `action(...)`
- use `createOptimistic` / `createOptimisticStore` for optimistic UI
- call `refresh(...)` at the end to recompute derived reads

```js
const [todos] = createStore(() => api.getTodos(), { list: [] });
const [optimisticTodos, setOptimisticTodos] = createOptimisticStore({ list: [] });

const addTodo = action(function* (todo) {
  // optimistic UI
  setOptimisticTodos(s => s.list.push(todo));

  // server write
  yield api.addTodo(todo);

  // recompute reads derived from the source-of-truth
  refresh(todos);
});
```

## Stores

### Draft-first setters (and `storePath` as an opt-in helper)

```js
// 2.0 preferred: produce-style draft updates
setStore(s => {
  s.user.address.city = "Paris";
});

// Optional compatibility: old “path argument” ergonomics via storePath
setStore(storePath("user", "address", "city", "Paris"));
```

### `unwrap(store)` → `snapshot(store)`

```js
const plain = snapshot(store);
JSON.stringify(plain);
```

### `mergeProps` / `splitProps` → `merge` / `omit`

```js
// 1.x
const merged = mergeProps(defaults, overrides);

// 2.0
const merged = merge(defaults, overrides);
```

One behavioral gotcha: **`undefined` is treated as a real value** (it overrides), not “skip this key”.

```js
const merged = merge({ a: 1, b: 2 }, { b: undefined });
// merged.b is undefined
```

```js
// 1.x
const [local, rest] = splitProps(props, ["class", "style"]);

// 2.0
const rest = omit(props, "class", "style");
```

### New function forms: `createSignal(fn)` and `createStore(fn)`

`createSignal(fn)` creates a **writable derived signal** (think “writable memo”):

```js
const [count, setCount] = createSignal(0);
const [doubled] = createSignal(() => count() * 2);
```

`createStore(fn, seed)` creates a **derived store** using the familiar `createStore` API:

```js
const [items] = createStore(() => api.listItems(), []);

const [cache] = createStore(
  draft => {
    draft.total = items().length;
  },
  { total: 0 }
);
```

## Control flow

### List rendering: `Index` is gone, and `For` children use accessors

If you used `Index`, it’s now `For` with `keyed={false}`.

The breaking bit: the `For` child function receives **accessors** for both the item and the index, so you’ll write `item()` / `i()` (not `item` / `i`).

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

### Function children often receive accessors (call them!)

This isn’t just `For`. A few control-flow APIs pass **accessors** into function children so the value is always safe to read:

```jsx
<Show when={user()} fallback={<Login />}>
  {u => <Profile user={u()} />}
</Show>

<Switch>
  <Match when={route() === "profile"}>{() => <Profile />}</Match>
</Switch>
```

## DOM

### Attributes & events: closer to HTML (and fewer namespaces)

Solid 2.0 aims to be more “what you write is what the platform sees”:

- built-in attributes are treated as **attributes** (not magically mapped properties), and are generally **lowercase**
- boolean attributes are presence/absence (`muted={true}` adds it, `muted={false}` removes it)
- `attr:` and `bool:` namespaces are removed (you typically don’t need them)

```jsx
<video muted={true} />
<video muted={false} />

// When the platform really wants a string:
<some-element enabled="true" />
```

Also, `oncapture:` is removed.

### Directives: `use:` → `ref` directive factories (two-phase pattern)

```jsx
// 1.x
<button use:tooltip={{ content: "Save" }} />

// 2.0
<button ref={tooltip({ content: "Save" })} />
<button ref={[autofocus, tooltip({ content: "Save" })]} />
```

Two-phase directive factories are recommended (owned setup → unowned apply):

```js
function titleDirective(source) {
  // Setup phase (owned): create primitives/subscriptions here.
  // Avoid imperative DOM mutation at top level.
  let el;
  createEffect(source, value => {
    if (el) el.title = value;
  });

  // Apply phase (unowned): DOM writes happen here.
  // No new primitives should be created in this callback.
  return nextEl => {
    el = nextEl;
  };
}
```

### `classList` → `class` (object/array forms)

```jsx
// 1.x
<div class="card" classList={{ active: isActive(), disabled: isDisabled() }} />

// 2.0
<div class={["card", { active: isActive(), disabled: isDisabled() }]} />
```

## Context

### Context providers: `Context.Provider` → “context is the provider”

```jsx
// 1.x
const Theme = createContext("light");
<Theme.Provider value="dark">{props.children}</Theme.Provider>

// 2.0
const Theme = createContext("light");
<Theme value="dark">{props.children}</Theme>
```

## Quick rename / removal map (not exhaustive)

- **`solid-js/web` → `@solidjs/web`**
- **`solid-js/store` → `solid-js`**
- **`solid-js/h` → `@solidjs/h`**
- **`solid-js/html` → `@solidjs/html`**
- **`solid-js/universal` → `@solidjs/universal`**
- **`Suspense` → `Loading`**
- **`ErrorBoundary` → `Errored`**
- **`mergeProps` → `merge`**
- **`splitProps` → `omit`**
- **`createSelector` → `createProjection` / `createStore(fn)`**
- **`unwrap` → `snapshot`**
- **`classList` → `class`**
- **`mergeProps` / `splitProps` → `merge` / `omit`**
- **`createResource` removed** → async computations + `Loading`
- **`startTransition` / `useTransition` removed** → built-in transitions + `isPending`/`Loading` + optimistic APIs
- **`use:` directives removed** → `ref` directive factories
- **`attr:` / `bool:` removed** → standard attribute behavior
- **`oncapture:` removed**
- **`onMount` → `onSettled`**

