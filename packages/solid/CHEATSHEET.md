# Solid 2.0 — Cheatsheet

One-page reference for Solid 2.0. Every API exists in `solid-js` unless noted. DOM APIs are in `@solidjs/web`.

> **AI codegen warning.** Solid is **not React**, and 2.0 is **not 1.x**. Both priors are dominant bug sources here — distrust pattern-matching from either. The bottom of this file lists 2.0-specific corrections; read them before generating code.

---

## Imports

```ts
import {
  createSignal, createMemo, createEffect, createRoot,
  For, Show, Switch, Match, Loading, Errored, Repeat, Reveal,
  createStore, createProjection, snapshot, reconcile,
  merge, omit,
  action, createOptimistic, createOptimisticStore,
  isPending, latest, refresh,
  untrack, flush, onSettled,
  createContext, useContext, children, lazy, createUniqueId,
} from "solid-js";

import { render, hydrate, Portal, dynamic, Dynamic } from "@solidjs/web";
```

Old subpaths are gone:
`solid-js/web` → `@solidjs/web`. `solid-js/store` → `solid-js`. `solid-js/h` → `@solidjs/h`. `solid-js/html` → `@solidjs/html`. `solid-js/universal` → `@solidjs/universal`.

---

## Signals & memos

```ts
// Plain signal
const [count, setCount] = createSignal(0);
count();              // read (call it!)
setCount(1);          // queues; read returns last committed until flush
setCount(c => c + 1); // updater form

// Readonly derived
const doubled = createMemo(() => count() * 2);
doubled();

// Writable derived ("writable memo")
const [value, setValue] = createSignal(() => props.initial);

// Options
createSignal(0, { ownedWrite: true });           // allow writes from inside owned scope
createSignal(0, { unobserved: () => cleanup() });// fires when no subscribers
createMemo(fn, { lazy: true });                  // defer first compute until read; autodispose when unobserved
createMemo(fn, { equals: (a, b) => a.id === b.id });
```

**Reads update only after flush.** `setX(v); x()` returns the *previous* value until the next microtask or `flush()`.

```ts
setCount(1);
count();   // still 0
flush();
count();   // 1
```

---

## Effects

```ts
// Two-arg form is the only form. Compute tracks; apply runs side effects.
createEffect(
  () => count(),                    // compute (tracks)
  (value, prev) => {                // apply (untracked)
    el.title = value;
    return () => { /* cleanup */ }; // optional cleanup
  }
);

// With error handling
createEffect(
  () => fetchData(id()),
  {
    effect: data => render(data),
    error:  (err, cleanup) => console.error(err)
  }
);

// Run on next change only (skip initial)
createEffect(() => count(), v => log(v), { defer: true });

// Schedule once after the current activity settles — the canonical
// "do this once and clean it up on dispose" primitive (replaces 1.x
// onMount + onCleanup for component-level lifecycle).
onSettled(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
});
```

`onSettled` works in component bodies (after first reactive settle) **and** in event handlers (defer work until the triggered transition settles). For component-level setup-and-teardown, **use `onSettled` with a returned cleanup, not `onCleanup` directly** — `onCleanup` is reserved for reactive cleanup inside computations (see Advanced).

---

## Reactive control utilities

```ts
untrack(() => count()); // read without subscribing
flush();                // drain queued updates synchronously
isEqual(a, b);          // default equality
```

---

## Stores

```ts
const [store, setStore] = createStore({ user: { name: "A" }, list: [] });

// Draft-first setter (canonical)
setStore(s => {
  s.user.name = "B";
  s.list.push("x");
});

// Return a value when mutation is awkward (filter/remove most often).
// Arrays replace by index + length; objects shallow-diff at the top level.
// No keyed reconciliation here — for that, use createProjection / createStore(fn).
setStore(s => s.list.filter(x => x !== "x"));
setStore(s => ({ ...s, list: [] }));

// Reconcile new data into a sub-tree (preserve identity)
setStore(s => { reconcile(serverTodos, "id")(s.todos); });

// Derived stores (mirror signal/memo split)
const items = createProjection(async () => api.list(), [], { key: "id" }); // readonly
const [cache, setCache] = createStore(draft => { draft.x = compute(); }, { x: 0 }); // writable
```

`undefined` is a real value in `merge` / setters — it overrides, not "skip".

---

## Props

**Props are reactive values, not accessors.** Two rules, one underlying model — and together the most common AI-generated bug class in Solid.

```jsx
const [count, setCount] = createSignal(0);

// 1. At the call site: pass the VALUE. Call accessors at the JSX boundary.
<Counter value={count()} />            // ✅
<Counter value={count} />              // ❌ child receives a function, not a number

// 2. In the child: read via `props.x`. The *property access* is what tracks.
function Counter(props) {
  return <div>{props.value}</div>;     // ✅ re-reads on each render
}
function Counter({ value }) {          // ❌ destructure unwraps once, reactivity is dead
  return <div>{value}</div>;
}
```

The rules are two sides of the same boundary: the parent collapses its accessors to values when handing off; the JSX runtime re-wraps `props` so that `props.value` re-reads on each access. Skip step 1 and the child gets a function; skip step 2 and the child reads once.

If you genuinely need to forward a getter (rare — render props, lazy slots), pass `getValue={() => count()}` and document it. Default to values.

### Helpers

```ts
const merged = merge(defaults, props, overrides); // replaces mergeProps
const rest   = omit(props, "class", "style");      // replaces splitProps
```

---

## Async

```ts
// Async is just "any computation that returns a Promise / AsyncIterable"
const user = createMemo(() => fetchUser(id()));
// Reading user() suspends until ready; wrap in <Loading>.

// "Refreshing…" indicator (false during initial Loading)
isPending(() => user());

// Peek at the in-flight value during a transition
latest(id);

// Force recompute of a derived read after a server write
refresh(user);
refresh(() => query.user(id()));
```

---

## Actions & optimistic

```ts
const [todos, setOptimisticTodos] = createOptimisticStore(() => api.list(), []);

const addTodo = action(function* (todo) {
  setOptimisticTodos(s => { s.push(todo); }); // optimistic write
  yield api.add(todo);                         // async work
  refresh(todos);                              // re-derive
});

// Optimistic signal
const [name, setName] = createOptimistic("Alice");
```

Optimistic writes revert when the transition completes.

---

## Control-flow components

```tsx
// List, keyed by identity (default)
<For each={items()}>
  {(item, i) => <Row item={item()} index={i()} />}
</For>

// List, non-keyed (replaces <Index>)
<For each={items()} keyed={false}>
  {(item, i) => <Row item={item()} index={i()} />}
</For>

// List with custom key
<For each={items()} keyed={t => t.id} fallback={<Empty />}>
  {item => <Row todo={item()} />}
</For>

// Range / count (no diffing) — i is a plain number, not an accessor
<Repeat count={store.items.length} fallback={<Empty />}>
  {i => <Row name={store.items[i].name} />}
</Repeat>

// Conditional (function child receives narrowed accessor — call it!)
<Show when={user()} fallback={<Login />}>
  {u => <Profile user={u()} />}
</Show>

// Branching
<Switch fallback={<NotFound />}>
  <Match when={route() === "home"}><Home /></Match>
  <Match when={route() === "profile"}>{() => <Profile />}</Match>
</Switch>

// Async boundary (replaces <Suspense>)
<Loading fallback={<Spinner />} on={id()}>
  <Profile />
</Loading>

// Error boundary (replaces <ErrorBoundary>)
<Errored fallback={(err, reset) => <button onClick={reset}>retry</button>}>
  <Page />
</Errored>

// Coordinate sibling Loadings (replaces <SuspenseList>).
// Default order is "sequential" — siblings reveal in registration order
// as each resolves. `collapsed` (sequential only) suppresses tail-sibling
// fallbacks past the frontier. Other orders: "together" | "natural".
<Reveal collapsed>
  <Loading fallback={<S/>}><A/></Loading>
  <Loading fallback={<S/>}><B/></Loading>
</Reveal>

// Dynamic component — factory form (canonical). Stable Component identity;
// composes with lazy(), routing, polymorphic patterns.
import { dynamic } from "@solidjs/web";

const Active = dynamic(() => isEditing() ? Editor : Viewer);
return <Active value={value()} />;

// JSX-wrapper convenience form. Use when the source is inline and you don't
// need to capture the component identity.
import { Dynamic } from "@solidjs/web";
<Dynamic component={isEditing() ? Editor : Viewer} value={value()} />
```

`<For>` non-keyed: `item` and `i` are **accessors** — call them: `item()`, `i()`.
`<Repeat>`: `i` is a **plain number**.

---

## Context, components, lazy

Context is for state scoped to a subtree of the component tree. **If you
want truly app-wide state, don't use Context — a module-scope signal/store
*is* a global.** That's why the default-less form requires a Provider.

```tsx
// Default-less — the canonical form. No Provider → ContextNotFoundError.
type TodosCtx = readonly [Store<Todo[]>, TodoActions];
const TodosContext = createContext<TodosCtx>();

function App() {
  return (
    <TodosContext value={createTodos()}>   {/* the context IS the provider */}
      <TodoList />
    </TodosContext>
  );
}

function TodoList() {
  const [todos, { addTodo }] = useContext(TodosContext); // typed as TodosCtx
  // ...
}
```

```tsx
// Default form — only for primitive fallbacks (theme, locale, frozen config).
// Outside any Provider, useContext returns the default.
const Theme = createContext<"light" | "dark">("light");

function Page() {
  const theme = useContext(Theme); // "light" | "dark"
  return <div class={theme}>...</div>;
}
```

Don't write a `useTodos`-style wrapper that re-throws on missing Provider —
the default-less form already throws, and `useContext` is typed `T` (no
`| undefined`). The wrapper is React-flavored boilerplate that no longer
earns its keep.

```tsx
// Resolve children once
const list = children(() => props.children);
list.toArray();

// Async component
const Heavy = lazy(() => import("./Heavy"));
```

Component types:

```ts
Component<P>           // no implicit children
VoidComponent<P>       // forbids children
ParentComponent<P>     // optional JSX.Element children
FlowComponent<P, C>    // requires children of type C
```

---

## DOM rendering

```ts
import { render, hydrate, Portal } from "@solidjs/web";

const dispose = render(() => <App />, document.getElementById("root")!);
hydrate(() => <App />, document.getElementById("root")!);

<Portal mount={document.body}><Modal /></Portal>
```

### Refs and directives

```jsx
// Element access
<button ref={el => (myButton = el)} />

// Directive factory (replaces use:)
<input ref={autofocus} />
<button ref={tooltip({ content: "Save" })} />

// Compose multiple
<button ref={[autofocus, tooltip({ content: "Save" })]} />
```

Two-phase directive (recommended):

```ts
function titleDirective(source) {
  // Setup phase (owned): create primitives.
  let el;
  createEffect(source, value => { if (el) el.title = value; });
  // Apply phase (unowned): DOM writes only.
  return nextEl => { el = nextEl; el.title = source(); };
}
```

### Attributes

```jsx
<video muted={true} />              // boolean = presence/absence
<video muted={false} />
<some-element enabled="true" />     // when platform requires the string
```

Lowercase HTML attribute names. No `attr:` / `bool:` / `oncapture:` namespaces. Event handlers stay camelCase (`onClick`).

### Conditional classes — always use the array/object form

```jsx
<div class="card" />                                          // static string
<div class={{ active: isActive(), invalid: !valid() }} />     // object: toggle by truthiness
<div class={["card", props.class, { active: isActive() }]} /> // array: merge entries
```

Array entries are always-on (or further nested arrays/objects). Object entries toggle by truthiness. There is no `classList` prop — the array+object form replaces it.

**Don't build class strings manually.** String concatenation, template literals, and `.join(" ")` over conditionals are the React/`classnames` reflex. Use the array+object form so conditions compose:

```jsx
<li class={["todo", { completed: props.todo.completed, errored: !!err() }]} />     // ✅

const cls = ["todo",                                                                // ❌
  props.todo.completed && "completed",
  err() && "errored",
].filter(Boolean).join(" ");
return <li class={cls} />;
```

---

## SSR (server entry)

```ts
import {
  renderToString, renderToStringAsync, renderToStream,
  isServer, isDev
} from "@solidjs/web";
```

`Portal` throws on the server. `Reveal` `order="together"` and `collapsed` require streaming (`renderToStream` / `renderToStringAsync`).

---

## Diagnostics (dev mode)

Common dev-mode warnings/errors you may hit:

- **Top-level reactive read in component body** — read inside JSX or wrap in `untrack`/`createMemo`.
- **Write under owned scope** — move setters into event handlers / `onSettled` / `untrack`, or opt in with `{ ownedWrite: true }`.
- **Strict read untracked** — extract values in the compute phase; don't read store proxies inside the effect callback.
- **Multiple Solid instances** — single `solid-js` install required.

Each diagnostic has a code (see RFC 08 / runtime error message) — search the docs by code.

---

## Advanced / escape hatches

Reach for these only when the named situation applies. **If you're not sure, you don't need them** — the common-path APIs above are the answer.

```ts
// Reactive cleanup inside a computation — runs before the next compute and
// on disposal. For component-level setup-and-teardown, use onSettled and
// return a cleanup; onCleanup is for library/primitive internals where the
// cleanup is tied to a reactive run, not a component lifecycle.
onCleanup(() => disposeReactiveResource());

// Deep tracking — only when an effect needs to react to *any* nested store change.
// Default store tracking is property-level (preferred).
createEffect(() => deep(store), snap => save(snap));

// Plain (non-reactive) deep copy of a store. For serialization (JSON.stringify,
// localStorage, sending over the wire) and tests that need a plain-object
// assertion target. Inside reactive scopes, prefer reading individual values.
JSON.stringify(snapshot(store));

// Render-phase synchronous effect — for DOM bindings that must run during render
// (the runtime's own attribute/property bindings). For app code, use createEffect.
createRenderEffect(() => props.title, v => { el.title = v; });

// Single-callback effect that may re-run in async situations.
// Rare; prefer createEffect.
createTrackedEffect(() => log(count()));

// One-shot tracked callback (advanced reactive patterns).
const track = createReaction(() => doWork());
track(() => count());

// Manually create an owned reactive scope. App code uses render(); reach for
// createRoot in tests, library setup, and other non-render entry points where
// you need an owner so reactive primitives can dispose properly.
createRoot(dispose => {
  const [count, setCount] = createSignal(0);
  // ...
  dispose();
});

// Detach a root from its parent (module singletons, external integrations only).
runWithOwner(null, () => { /* ... */ });

// Get the current owner. Mostly used to capture and restore an owner across an
// async boundary inside library code.
const owner = getOwner();
runWithOwner(owner, () => { /* ... */ });

// Wait for a reactive expression to settle (imperative code / tests).
const v = await resolve(() => user());

// Are we inside a refresh() cycle? Almost never needed in app code.
isRefreshing();

// Throw to signal "not ready" through the reactive graph (library authors).
throw new NotReadyError();

// 1.x-style path setter compat. Use only when migrating; draft-first is canonical.
setStore(storePath("user", "address", "city", "Paris"));
```

---

## What changed from 1.x (the AI footgun list)

If your training data is 1.x, these are the corrections. **Read this before generating Solid 2.0 code.**

### Imports moved
- `solid-js/web` → `@solidjs/web`
- `solid-js/store` → `solid-js` (store APIs moved into core)
- `solid-js/h` / `solid-js/html` / `solid-js/universal` → `@solidjs/h` / `@solidjs/html` / `@solidjs/universal`

### Renames
| 1.x | 2.0 |
|---|---|
| `Suspense` | `Loading` |
| `SuspenseList` | `Reveal` |
| `ErrorBoundary` | `Errored` |
| `mergeProps` | `merge` |
| `splitProps` | `omit` |
| `unwrap` | `snapshot` |
| `onMount` | `onSettled` |
| `createSelector` | `createProjection` (or `createStore(fn)`) |
| `equalFn` | `isEqual` |
| `getListener` | `getObserver` |
| `Context.Provider` | `<Context value={...}>` (context value *is* the provider) |
| `classList={{...}}` | `class={{...}}` (object/array forms) |

### Removed (with replacements)
| Removed | Use instead |
|---|---|
| `batch` | Default microtask batching; `flush()` to apply now |
| `createComputed` | `createMemo` / split `createEffect` / function-form `createSignal` |
| `createResource` | Async computations + `<Loading>` (`createMemo(() => fetchX(id()))`) |
| `startTransition`, `useTransition` | Built-in transitions; `isPending` / `<Loading>` / optimistic APIs |
| `on(...)` helper | Split effects (compute phase = explicit deps) |
| `onError` / `catchError` | `<Errored>` or effect `error` option |
| `produce` | Default — store setters are draft-first |
| `createMutable` / `modifyMutable` | `createStore` with draft setters |
| `from` / `observable` | Async iterables in computations / `createEffect` to push out |
| `Index` | `<For keyed={false}>` |
| `indexArray` | `mapArray` (handles non-keyed too) |
| `use:foo={x}` directives | `ref={foo(x)}` (or array `ref={[a, b(x)]}`) |
| `attr:` / `bool:` namespaces | Standard attribute behavior |
| `oncapture:` | `addEventListener(..., { capture: true })` |
| `resetErrorBoundaries` | Boundaries heal automatically |

### Behavior changes
- **`createEffect` takes two arguments now**: `(compute, apply)`. The single-arg form is gone — using it is an error.
- **Setters don't update reads immediately** — values become visible after the microtask flushes (or via `flush()`).
- **No writes inside owned scope** — writing a signal/store from inside a memo, effect compute, or component body throws in dev. Move writes to event handlers, `onSettled`, or untracked blocks. Opt in narrowly with `{ ownedWrite: true }` for internal state.
- **No top-level reactive reads in component body** — reading signals/props directly at the top of a component warns. Read inside JSX, a memo, or `untrack`.
- **Props are values, not accessors** — at the call site call accessors (`<X v={count()} />`, not `<X v={count} />`). The single most common AI-generated bug.
- **Don't destructure props** — `function Comp({ name })` warns; use `props.name` to keep reactivity. (Same root cause as above; see the Props section.)
- **`<For>` non-keyed children are accessors** — `(item, i) => ...` where `item` and `i` are functions. Call them: `item()`, `i()`.
- **`<Show>` / `<Match>` function children receive narrowed accessors** — also call them.
- **Stores: setters take a draft callback** — mutate the draft in place by default. Returning a new value is shallow (array index-replace, object top-level diff); reach for it for filter/remove. Keyed reconcile is a *projection-fn* feature, not a setter feature.
- **`undefined` is a real value in `merge`** — it overrides rather than "skip this key".
- **Async lives in computations** — return a Promise/AsyncIterable from `createMemo`/`createStore(fn)`/`createProjection`. Reads suspend; wrap in `<Loading>`.
- **`Loading` is initial-only by default** — once content has rendered, revalidation keeps it visible. Use `isPending(() => x())` for "refreshing…" indicators. Use `<Loading on={key}>` to re-show fallback on key changes.
- **No `Suspense.Provider` or single error path** — async errors flow to `<Errored>` (or effect `error`); no inline `resource.error` branching.
- **`createRoot` is owned by parent by default** — disposed when parent disposes. To detach: `runWithOwner(null, fn)`.
- **Refs are functions** — `ref={el => ...}`. No `useRef`-style ref objects. Compose with arrays: `ref={[a, b]}`.
- **Boolean attributes are presence/absence** — `<video muted={false} />` removes the attribute.
- **Built-in attributes are lowercase** — `tabindex` not `tabIndex`. Event handlers stay camelCase (`onClick`).
- **In tests, `flush()` before asserting on signals** — `setCount(1); flush(); expect(count()).toBe(1)`.
- **Reactive primitives need an owner** — wrap test code in `createRoot(dispose => { ... })` or you'll leak.

---

## See also

- [`MIGRATION.md`](https://github.com/solidjs/solid/blob/main/documentation/solid-2.0/MIGRATION.md) — full beta-tester migration guide.
- [Solid 2.0 RFCs](https://github.com/solidjs/solid/tree/main/documentation/solid-2.0) — eight deep-dive design docs, one per subsystem.

