---
name: solid-reactivity
description: How to use Solid 2.0's reactive primitives correctly. Use when writing or reviewing code that calls createSignal, createMemo, createEffect, createStore, createProjection, or createOptimistic, or when async data is involved. Covers the signatures that changed from Solid 1.x and the 1.x APIs that no longer exist.
---

# Solid reactivity

Solid 2.0 changed several signatures that look unchanged. Code written from
Solid 1.x habit compiles and then behaves wrong. Check this file before
writing a primitive call.

## createEffect takes two functions

This is the most common mistake. `createEffect` is split into a tracked
compute and an untracked effect.

```ts
// Correct.
createEffect(
  () => count(), // compute: tracks, runs in the compute phase
  value => console.log(value) // effect: side effects, runs after the flush
);

// Wrong. This is the Solid 1.x shape and throws MISSING_EFFECT_FN in dev.
createEffect(() => console.log(count()));
```

Return a cleanup from the effect function. It runs before the next run and on
disposal.

```ts
createEffect(
  () => userId(),
  id => {
    const controller = new AbortController();
    fetch(`/users/${id}`, { signal: controller.signal });
    return () => controller.abort();
  }
);
```

Pass `{ effect, error }` instead of a plain function to handle errors that
arrive from the compute or from upstream sources, including async rejections.
Errors thrown inside the effect function itself are not routed there. Wrap
those in `try`/`catch` yourself, because an uncaught one reaches the nearest
error boundary and halts the reactive system if there is none.

```ts
createEffect(() => user(), {
  effect: value => render(value),
  error: err => setMessage(String(err))
});
```

## A function argument makes a signal reactive

`createSignal` has two shapes. With a value it is a plain signal. With a
function it is a writable memo: it recomputes from its sources, and the setter
applies a local override.

```ts
const [count, setCount] = createSignal(0); // plain
const [user, setUser] = createSignal(() => fetchUser(userId())); // writable memo

setUser({ ...user(), name: "Alice" }); // local optimistic edit
```

`createStore` works the same way. With an object it is a store. With a
function it is a projection seeded by the second argument.

```ts
const [state, setState] = createStore({ items: [] });
const [view, setView] = createStore(
  draft => {
    draft.total = sum(state.items);
  },
  { total: 0 }
);
```

## Async is a function that throws while pending

There is no `createResource` and no `createAsync`. Any computation can be
async: pass a function that returns a promise or async iterable, and a read
while it is pending throws. The nearest `<Loading>` catches that and shows its
fallback.

```tsx
const [user] = createSignal(() => fetch(`/users/${id()}`).then(r => r.json()));

<Loading fallback={<Spinner />}>
  <Profile name={user().name} />
</Loading>;
```

Do not try to branch on a loading flag inside the computation. Let the read
throw and let the boundary handle it. Use `latest()` to read the previous
settled value instead of suspending, and `isPending()` to check without
triggering.

Give a computation a `loadingValue` to render a placeholder rather than
suspend. Type the placeholder honestly: if it stands in for real data, mark it
in the data, for example with a `skeleton: true` field, rather than letting it
impersonate a settled value.

## Solid 1.x APIs that are gone

Reach for the replacement, not the old name.

- `createResource` and `createAsync`: any computation is async, see above.
- `batch`: use `flush`.
- `createSelector`: use `createProjection`.
- `createComputed` and `createDeferred`: no replacement, restructure.
- `on`: no longer needed, the compute argument of `createEffect` is the
  dependency list.
- `onMount`: use `onSettled`.
- `onError` and `catchError`: use `createErrorBoundary` or `<Errored>`.
- `startTransition` and `useTransition`: removed.
- `equalFn`: renamed `isEqual`.
- `getListener`: renamed `getObserver`.
- `unwrap`: renamed `snapshot`.
- `createMutable`, `modifyMutable`, `produce`: `produce` behavior is the
  default store setter now.
- `indexArray` and `Index`: `<For>` covers both, see the control-flow skill.
- `observable` and `from`: use async iterators.

The full map with the reasoning is in the `Not Implemented` block at the
bottom of `packages/solid/src/index.ts`.

## Reading without tracking

`untrack(fn)` reads without subscribing. Prefer restructuring so the read is
outside the tracked scope; reach for `untrack` when that is not possible.
`snapshot(store)` returns a plain non-reactive copy of a store.
