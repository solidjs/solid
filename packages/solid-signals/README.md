# @solidjs/signals

The reactive core that powers [SolidJS 2.0](https://github.com/solidjs/solid). It is developed in the Solid monorepo and includes first-class support for async, transitions, optimistic updates, and deeply reactive stores that go beyond what general-purpose signals libraries offer.

> **Status:** Beta — this package is the reactive foundation of SolidJS 2.0 Beta. The API is stabilizing but may still have breaking changes before a final release.

## Installation

```bash
npm install @solidjs/signals
# or
pnpm add @solidjs/signals
```

## Overview

`@solidjs/signals` is a push-pull hybrid reactive system. Signals hold values, computeds derive from them, and effects run side effects — all connected through an automatic dependency graph. Updates are **batched** and flushed asynchronously via microtask, giving you consistent state without glitches.

```typescript
import { createEffect, createMemo, createRoot, createSignal, flush } from "@solidjs/signals";

createRoot(() => {
  const [count, setCount] = createSignal(0);
  const doubled = createMemo(() => count() * 2);

  createEffect(
    () => doubled(),
    value => {
      console.log("Doubled:", value);
    }
  );

  setCount(5);
  flush(); // "Doubled: 10"
});
```

### Batched Updates

Signal writes are batched — reads after a write won't reflect the new value until `flush()` runs. This prevents glitches and unnecessary recomputation.

```typescript
const [a, setA] = createSignal(1);
const [b, setB] = createSignal(2);

setA(10);
setB(20);
// Neither has updated yet — both writes are batched
flush(); // Now both update and downstream effects run once
```

## Core Primitives

### Signals

```typescript
const [value, setValue] = createSignal(initialValue, options?);
```

Reactive state with a getter/setter pair. Supports custom equality via `options.equals`.

### Memos

```typescript
const derived = createMemo(() => expensive(signal()));
```

Read-only derived values that cache their result and only recompute when dependencies change. Supports async compute functions — return a `Promise` or `AsyncIterable` and downstream consumers will wait automatically.

### Effects

```typescript
// Two-phase: compute tracks dependencies, effect runs side effects
createEffect(
  () => count(),
  value => {
    console.log(value);
  }
);

// Render-phase effect (runs before user effects)
createRenderEffect(
  () => count(),
  value => {
    updateDOM(value);
  }
);
```

Effects split tracking from execution. `createEffect` and `createRenderEffect` take a compute function (for tracking) and an effect function (for side effects).

### Writable Memos

Pass a function to `createSignal` to get a writable derived value — a memo you can also set:

```typescript
const [value, setValue] = createSignal(prev => transform(source(), prev), initialValue);
```

## Async

Computeds can return promises or async iterables. The reactive graph handles this automatically — previous values are held in place until the async work resolves, so downstream consumers never see an inconsistent state.

```typescript
const data = createMemo(async () => {
  const response = await fetch(`/api/items?q=${query()}`);
  return response.json();
});

// Check async state
isPending(data); // true while loading
latest(data); // last resolved value
```

Use `action()` to coordinate async workflows with the reactive graph:

```typescript
const save = action(function* (item) {
  yield fetch("/api/save", { method: "POST", body: JSON.stringify(item) });
});
```

## Optimistic Updates

Optimistic signals show an immediate value while async work is pending, then automatically revert when it settles:

```typescript
const [optimisticCount, setOptimisticCount] = createOptimistic(0);

// Immediate UI update — reverts when the async work resolves
setOptimisticCount(count + 1);
```

Also available for stores via `createOptimisticStore()`.

## Stores

Proxy-based deeply reactive objects with per-property tracking:

```typescript
import { createStore, reconcile } from "@solidjs/signals";

const [store, setStore] = createStore({ todos: [], filter: "all" });

// Setter takes a mutating callback — mutations are intercepted by the proxy
setStore(s => {
  s.filter = "active";
});
setStore(s => {
  s.todos.push({ text: "New", done: false });
});
setStore(s => {
  s.todos[0].done = true;
});

// Reconcile from server data
setStore(s => {
  reconcile(serverTodos, "id")(s.todos);
});
```

### Projections

Derived stores that transform data reactively:

```typescript
import { createProjection } from "@solidjs/signals";

const filtered = createProjection(
  draft => {
    draft.items = store.todos.filter(t => !t.done);
  },
  { items: [] }
);
```

## Boundaries

Intercept async loading and error states in the reactive graph:

```typescript
import { createErrorBoundary, createLoadingBoundary } from "@solidjs/signals";

createErrorBoundary(
  () => riskyComputation(),
  (error, reset) => handleError(error)
);

createLoadingBoundary(
  () => asyncContent(),
  () => showFallback()
);
```

## Ownership & Context

All reactive nodes exist within an **owner** tree that handles disposal and context propagation:

```typescript
import { createContext, createRoot, getContext, onCleanup, setContext } from "@solidjs/signals";

const ThemeContext = createContext("light");

createRoot(dispose => {
  setContext(ThemeContext, "dark");

  createEffect(
    () => getContext(ThemeContext),
    theme => {
      console.log("Theme:", theme);
    }
  );

  onCleanup(() => console.log("Disposed"));

  // Call dispose() to tear down the tree
});
```

## Utilities

| Function                 | Description                                                        |
| ------------------------ | ------------------------------------------------------------------ |
| `flush()`                | Process all pending updates                                        |
| `untrack(fn)`            | Run `fn` without tracking dependencies                             |
| `isPending(accessor)`    | Check if an async accessor is loading                              |
| `latest(accessor)`       | Get the last resolved value of an async accessor                   |
| `refresh(accessor)`      | Re-trigger an async computation                                    |
| `isRefreshing(accessor)` | Check if an async accessor is refreshing                           |
| `resolve(fn)`            | Returns a promise that resolves when a reactive expression settles |
| `mapArray(list, mapFn)`  | Reactive array mapping with keyed reconciliation                   |
| `repeat(count, mapFn)`   | Reactive repeat based on a reactive count                          |
| `onSettled(fn)`          | Run a callback after the current flush cycle completes             |
| `snapshot(store)`        | Returns a non-reactive copy of a store, preserving unmodified references |
| `reconcile(value, key)`  | Returns a diffing function for updating stores from new data       |
| `merge(...sources)`      | Reactively merges multiple objects/stores, last source wins        |
| `omit(props, ...keys)`   | Creates a reactive view of an object with specified keys removed   |
| `deep(store)`            | Tracks all nested changes on a store                               |
| `storePath(...path)`     | Path-based setter for stores as an alternative to mutating callbacks |

## Development

From the monorepo root:

```bash
pnpm install
pnpm --filter @solidjs/signals build
pnpm --filter @solidjs/signals test
pnpm --filter @solidjs/signals test:watch
pnpm --filter @solidjs/signals test:gc
pnpm --filter @solidjs/signals bench
```

## License

MIT
