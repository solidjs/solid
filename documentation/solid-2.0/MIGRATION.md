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

The `initialValue` parameter from 1.x is gone. In 2.0, the compute function receives `prev` (which is `undefined` on the first run). If you need a default, use a default parameter:

```js
// 1.x (initialValue as second arg)
createEffect((prev) => {
  console.log("changed from", prev, "to", count());
  return count();
}, 0);

// 2.0 (default parameter for prev, apply function is second arg)
createEffect(
  (prev = 0) => count(),
  (value, prev) => {
    console.log("changed from", prev, "to", value);
  }
);
```

This same change applies to `createMemo` — the second argument is now `options`, not an initial value:

```js
// 1.x
const doubled = createMemo((prev) => count() * 2, 0);

// 2.0 (no initialValue arg; prev is undefined on first run)
const doubled = createMemo(() => count() * 2);
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

These are **dev-only diagnostics** meant to catch bugs earlier. Some are warnings (console); others are errors (throw). See [RFC 08](08-dev-diagnostics.md) for the full reference.

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

Writing to signals/stores inside a reactive scope **throws** in dev. Usually you want:

- derive values with `createMemo` (no write-back)
- write in event handlers / actions
- return cleanup from effect apply functions (instead of writing during tracking)

```js
// ❌ throws: writing from inside a memo
createMemo(() => setDoubled(count() * 2));

// ✅ derive instead of writing back
const doubled = createMemo(() => count() * 2);
```

If you truly have an **internal** signal that needs to be written from within owned scope (not app state), opt in narrowly with `ownedWrite: true`.

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

The basic pattern: replace `createResource` with an async `createMemo` (or `createStore(fn)` for collections), and wrap consumers in `Loading`:

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

The resource tuple features map to standalone APIs:

| 1.x resource feature | 2.0 replacement |
|---|---|
| `resource.loading` | `Loading` (initial), `isPending(() => resource())` (revalidation) |
| `resource.error` | `Errored` boundary or effect `error` option |
| `refetch()` | `refresh(resource)` |
| `mutate()` | `createOptimisticStore` + `action` (see [RFC 06](06-actions-optimistic.md)) |

See [RFC 05 — createResource migration](05-async-data.md#createresource--async-computations--loading) for detailed before/after examples of each pattern.

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

### Dynamic components: `createDynamic` → `dynamic` factory

`createDynamic(source, props): JSX.Element` is replaced by a `lazy`-style factory, `dynamic(source): Component<P>`. The factory returns a stable component whose identity is driven by a reactive (and optionally async) source — children, refs, and reactive props flow through the normal JSX path, so the returned value is usable anywhere a component is.

```jsx
// 1.x style
import { Dynamic } from "solid-js/web";
<Dynamic component={isEditing() ? Editor : Viewer} value={value()} />

// 2.0 — <Dynamic> is unchanged at the call site and now delegates to dynamic() internally.
import { Dynamic } from "@solidjs/web";
<Dynamic component={isEditing() ? Editor : Viewer} value={value()} />

// 2.0 — new factory form (preferred when you want a stable component reference)
import { dynamic } from "@solidjs/web";
const Active = dynamic(() => isEditing() ? Editor : Viewer);
return <Active value={value()} />;
```

Async sources compose with `Loading`/Suspense through the normal `NotReadyError` flow — no wrapper primitive or `await` in user code.

`<Dynamic component={...}>` still exists and is user-facing unchanged; it's now a thin wrapper over `dynamic`. Direct callers of the old `createDynamic(source, props)` should either use `<Dynamic>` or compose manually as `createComponent(dynamic(source), props)`.

### Coordinating loading boundaries: `SuspenseList` → `Reveal`

`SuspenseList` is replaced by `Reveal`, which coordinates sibling `Loading` boundaries.

Ordering is controlled by a single `order` prop with three values: `"sequential"` (default, matches `revealOrder="forwards"`), `"together"` (matches `revealOrder="together"`), and `"natural"` (new in 2.0 — no in-group ordering). A separate `collapsed` boolean covers the former `tail="collapsed"` case; it is only consulted when `order="sequential"` and is ignored otherwise.

```jsx
// 1.x
<SuspenseList revealOrder="forwards">
  <Suspense fallback={<Skeleton />}><ProfileHeader /></Suspense>
  <Suspense fallback={<Skeleton />}><Posts /></Suspense>
</SuspenseList>

// 2.0 — default sequential ordering
<Reveal>
  <Loading fallback={<Skeleton />}><ProfileHeader /></Loading>
  <Loading fallback={<Skeleton />}><Posts /></Loading>
</Reveal>

// 2.0 — reveal the whole group at once
<Reveal order="together">
  <Loading fallback={<Skeleton />}><ProfileHeader /></Loading>
  <Loading fallback={<Skeleton />}><Posts /></Loading>
</Reveal>

// 2.0 — nested natural group that reveals independently within its slot
<Reveal>
  <Loading fallback={<Skeleton />}><Header /></Loading>
  <Reveal order="natural">
    {/* Held on their fallbacks until the outer frontier reaches this slot.
        Once released, each card reveals as its own data resolves. */}
    <Loading fallback={<CardSkel />}><Card id={1} /></Loading>
    <Loading fallback={<CardSkel />}><Card id={2} /></Loading>
  </Reveal>
</Reveal>
```

> Note: in earlier 2.0 betas `Reveal` exposed a boolean `together` prop. That prop has been replaced by `order="together"`. `collapsed` still exists; it is a sequential-only knob and has no effect under `order="together"` or `order="natural"`.

Nesting semantics, the outer/inner ordering matrix, and SSR caveats are documented in [Control flow → Reveal](./03-control-flow.md#reveal-timing-reveal).

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

## New in 2.0

These APIs are new additions (not renames of 1.x APIs):

- **`Reveal`** — coordinates reveal timing of sibling `Loading` boundaries via an `order` prop (`"sequential"` | `"together"` | `"natural"`) plus a sequential-only `collapsed` flag. Replaces `SuspenseList`. `order="natural"` is new: the nested group participates as a single composite slot in its parent's ordering, and once the parent releases that slot, each inner child reveals independently on its own data.
- **`Repeat`** — count/range-based list rendering without diffing (skeletons, windowing).
- **`action(fn)`** — wraps generator/async generator mutations with transition coordination.
- **`createOptimistic` / `createOptimisticStore`** — signal/store primitives whose writes revert when a transition completes.
- **`createProjection(fn, seed)`** — derived store with reactive reconciliation.
- **`isPending(fn)`** — expression-level "stale while revalidating" check.
- **`isRefreshing()`** — returns `true` when code is executing inside a `refresh()` cycle.
- **`latest(fn)`** — peek at in-flight values during transitions.
- **`refresh(target)`** — explicit recomputation/invalidation of derived reads.
- **`resolve(fn)`** — returns a Promise that resolves when a reactive expression settles.
- **`Loading` `on` prop** — controls when a Loading boundary re-shows fallback during revalidation.
- **`deep(store)`** — deep observation of a store (tracks all nested changes).
- **`reconcile(value, key)`** — diffing function for updating stores from new data.
- **Function-form `createSignal(fn)` / `createStore(fn)`** — derived (writable) primitives.
- **Effect `EffectBundle`** — `createEffect` accepts `{ effect, error }` for structured error handling.
- **`createMemo` `lazy` option** — defers initial computation until first read.
- **`unobserved` callback** — fires when a signal/memo loses all subscribers (resource cleanup).
- **`dynamic(source)` factory** — `lazy`-style factory that returns a stable component whose identity is driven by a reactive (and optionally async) source. Backs the `<Dynamic>` JSX wrapper.

## Detailed removal guide

These removals benefit from more context than a one-liner. For simple renames, see the [quick map](#quick-rename--removal-map) below.

### `batch` → default microtask batching + `flush()`

In 1.x, `batch` was explicit — you wrapped multiple writes to avoid intermediate renders. In 2.0, **all writes are batched by default** (microtask). There's nothing to wrap. If you need to force synchronous application (tests, imperative interop), use `flush()`:

```js
// 1.x
batch(() => {
  setA(1);
  setB(2);
});

// 2.0 — just write; batching is automatic
setA(1);
setB(2);

// If you need synchronous "apply now":
setA(1);
setB(2);
flush();
```

### `createComputed` → `createMemo`, `createEffect`, or derived `createSignal`

`createComputed` was used for three distinct patterns. The replacement depends on which one:

**Readonly derivation** — use `createMemo`:

```js
// 1.x
createComputed(() => setDoubled(count() * 2));

// 2.0
const doubled = createMemo(() => count() * 2);
```

**Side effect on change** — use split `createEffect`:

```js
// 1.x
createComputed(() => {
  const val = input();
  localStorage.setItem("input", val);
});

// 2.0
createEffect(
  () => input(),
  (val) => localStorage.setItem("input", val)
);
```

**Derived-with-writeback** (computed that also has a setter) — use function-form `createSignal`:

```js
// 1.x
const [value, setValue] = createSignal(props.initial);
createComputed(() => setValue(props.initial));

// 2.0
const [value, setValue] = createSignal(() => props.initial);
```

### `on` helper → split effects

`on` existed to declare explicit dependencies separately from the effect body. Split effects make this unnecessary — the compute phase *is* the explicit dependency declaration:

```js
// 1.x
createEffect(on(count, (value, prev) => {
  console.log("changed from", prev, "to", value);
}));

// 2.0 — compute phase declares deps, effect phase runs side effects
createEffect(
  () => count(),
  (value, prev) => {
    console.log("changed from", prev, "to", value);
  }
);
```

```js
// 1.x — multiple deps
createEffect(on([a, b], ([a, b]) => {
  console.log(a, b);
}));

// 2.0
createEffect(
  () => [a(), b()],
  ([a, b]) => console.log(a, b)
);
```

`on` also had a `defer` option to skip the initial run. In 2.0, `createEffect` has this directly:

```js
// 1.x
createEffect(on(count, (value) => {
  console.log("changed to", value);
}, { defer: true }));

// 2.0
createEffect(count, (value) => {
  console.log("changed to", value);
}, { defer: true });
```

### `onError` / `catchError` → `Errored` + effect `error` option

In 1.x, `onError`/`catchError` were imperative error handlers registered in scope. In 2.0, errors propagate through the reactive graph and are caught structurally:

**Component-level error UI** — use `Errored`:

```jsx
// 1.x
<ErrorBoundary fallback={err => <p>{err.message}</p>}>
  <Child />
</ErrorBoundary>

// 2.0
<Errored fallback={err => <p>{err.message}</p>}>
  <Child />
</Errored>
```

**Programmatic error handling in effects** — use the `error` option:

```js
// 1.x
catchError(() => {
  createEffect(() => riskyAsyncWork());
}, (err) => console.error("caught:", err));

// 2.0
createEffect(
  () => riskyAsyncWork(),
  {
    effect: (value) => { /* success path */ },
    error: (err) => console.error("caught:", err)
  }
);
```

### `produce` → now the default setter behavior

`produce` is not really "removed" — it's the default. Store setters in 2.0 receive a mutable draft. If you imported `produce` to wrap your setter, just drop it:

```js
// 1.x
import { produce } from "solid-js/store";
setStore(produce(s => {
  s.user.name = "Alice";
  s.list.push("item");
}));

// 2.0 — draft-first is the default
setStore(s => {
  s.user.name = "Alice";
  s.list.push("item");
});
```

If you need the old path-style syntax, use `storePath`:

```js
setStore(storePath("user", "name", "Alice"));
```

### `createMutable` / `modifyMutable` → `createStore` with draft setters

`createMutable` gave you a proxy you could write to directly. In 2.0, `createStore` with draft setters gives the same ergonomics while keeping writes explicit:

```js
// 1.x
const state = createMutable({ count: 0, items: [] });
state.count++;
state.items.push("a");

// 2.0
const [state, setState] = createStore({ count: 0, items: [] });
setState(s => {
  s.count++;
  s.items.push("a");
});
```

The key difference: writes go through `setState`, which makes them visible to the reactive system's batching and transition coordination. Direct mutation on a proxy can't participate in transitions or optimistic rollback.

### `from` / `observable` → async iterators / effects

`from` converted external reactive sources into signals. `observable` converted signals into observables. These directions have different replacements.

**External → Solid (`from`):** Async iterables work directly in computations:

```js
// 1.x
import { from } from "solid-js";
const signal = from(observable$);

// 2.0 — async iterables are first-class in computations
const value = createMemo(async function* () {
  for await (const val of observable$) {
    yield val;
  }
});
```

**Solid → External (`observable`):** There's no drop-in replacement. `observable()` produced a standard Observable that external libraries could subscribe to. In 2.0, use `createEffect` to push signal changes to an external subscriber:

```js
// 1.x
import { observable } from "solid-js";
const obs$ = observable(signal);
obs$.subscribe(value => externalLib.update(value));

// 2.0 — use an effect to push changes outward
createEffect(signal, (value) => {
  externalLib.update(value)
});
```

If you need a standard Observable/AsyncIterable interface for external consumers, you'll need to build a thin adapter around `createEffect`. This is a known gap — the 1.x `observable()` convenience doesn't have a direct 2.0 equivalent yet. I expect this to move into @solid-primitives.

## Quick rename / removal map

### Import paths

- **`solid-js/web` → `@solidjs/web`**
- **`solid-js/store` → `solid-js`** (store APIs now exported from `solid-js` directly)
- **`solid-js/h` → `@solidjs/h`**
- **`solid-js/html` → `@solidjs/html`**
- **`solid-js/universal` → `@solidjs/universal`**

### Renames

- **`Suspense` → `Loading`**
- **`SuspenseList` → `Reveal`**
- **`ErrorBoundary` → `Errored`**
- **`mergeProps` → `merge`**
- **`splitProps` → `omit`**
- **`createSelector` → `createProjection` / `createStore(fn)`**
- **`createDynamic(source, props)` → `dynamic(source)` factory** (`<Dynamic>` JSX wrapper unchanged)
- **`unwrap` → `snapshot`**
- **`onMount` → `onSettled`**
- **`equalFn` → `isEqual`**
- **`getListener` → `getObserver`**
- **`classList` → `class`** (object/array forms)

### Removals

- **`createResource`** → async computations + `Loading`
- **`startTransition` / `useTransition`** → built-in transitions + `isPending`/`Loading` + optimistic APIs
- **`batch`** → `flush()` when you need synchronous application
- **`createComputed`** → `createEffect` (split), function-form `createSignal`/`createStore`, or `createMemo`
- **`on` helper** → no longer necessary with split effects
- **`onError` / `catchError`** → `Errored` or effect `error` option
- **`produce`** → now the default store setter behavior (draft-first)
- **`createMutable` / `modifyMutable`** → use `createStore` with draft setters
- **`from` / `observable`** → async iterators
- **`createDeferred`** → removed; handle outside Solid
- **`indexArray`** → use `mapArray` with `keyed: false`
- **`resetErrorBoundaries`** → no longer needed (error boundaries heal automatically)
- **`enableScheduling`** → removed
- **`writeSignal`** → removed (internal API that should not have been exported)
- **`use:` directives** → `ref` directive factories
- **`attr:` / `bool:` namespaces** → standard attribute behavior
- **`oncapture:`** → removed
- **`Context.Provider`** → use the context directly as provider (`<Context value={...}>`)

