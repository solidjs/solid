# RFC: Reactivity, batching, and effects

**Start here:** If you’re migrating an app, read the beta tester guide first: [MIGRATION.md](MIGRATION.md)

## Summary

Solid 2.0 tightens the reactivity model: no writes under owned scope (with narrow exceptions), stricter use of `untrack` for top-level reactive reads, and microtask batching via `flush` instead of `batch`. Effects are split into a tracking phase and an effect phase, enabling safer async and resumability. `createTrackedEffect` and `onSettled` (replacing `onMount`) complete the picture. These changes make the execution model predictable and allow Loading/Error boundaries to work correctly with async.

## Motivation

- **Writes under scope:** Writing to a signal inside a tracked context (e.g. inside an effect or component body) can cause subtle bugs and makes the graph harder to reason about. Split effects make it safe to disallow this by default.
- **Strict top-level access (new):** Top-level reactive reads in component body can accidentally capture dependencies and re-run in async situations; in 2.0 we warn in dev unless the read is inside createMemo/createEffect or explicit `untrack`.
- **Batching:** Synchronous batching with `batch()` is replaced by default microtask batching. Setters queue work; reads (and DOM/effects) reflect the update after the batch flushes (next microtask, or via `flush()`). This aligns with Vue/Svelte and simplifies the model; `batch` is no longer needed.
- **Split effects:** Running all “tracking” (compute) halves of effects before any “effect” (callback) halves gives a clear dependency picture before side effects run, which is required for async, Loading, and Errored boundaries.

## Detailed design

### No writes under owned scope

Writing to a signal inside a reactive scope (effect, memo, component body) warns in dev. Writes belong in event handlers, `onSettled`, or untracked blocks. When a signal must be written from within scope (e.g. internal state), opt in with `pureWrite: true`:

```js
// Default: warn if set in effect/component
const [count, setCount] = createSignal(0);

// Opt-in: allow writes in owned scope (e.g. internal flags)
const [ref, setRef] = createSignal(null, { pureWrite: true });
```

`pureWrite` is not a general-purpose escape hatch. A common misuse is enabling it to silence warnings for application state while still writing from reactive scope:

```js
// ❌ BAD: using pureWrite to silence a write-under-scope warning for app state
const [count, setCount] = createSignal(0, { pureWrite: true });
const [doubled, setDoubled] = createSignal(untrack(count) + 1); // force untracked read to get around other warning
createMemo(() => setDoubled(count() + 1)); // feedback loop

// ✅ GOOD: derive without writing back, or write in an event
const doubled = createMemo(() => count() * 2);
button.onclick = () => setCount((c) => c + 1);
```

### Strict top-level access (new in 2.0)

**What’s new:** In component body **top level**, reactive reads (signal, signal-backed prop, store property) **warn in dev** unless they are inside a reactive scope (e.g. `createMemo`, `createEffect`) or explicitly wrapped in `untrack`. This steers authors to avoid accidental dependencies that would re-run the component in async or lose reactivity.

```js
// New: top-level read in component body warns unless wrapped
function Title(props) {
  const t = untrack(() => props.title); // intentional one-time read — no warn
  return <h1>{t}</h1>;
}
function Bad(props) {
  const t = props.title; // warns: Untracked reactive read
  return <h1>{t}</h1>;
}

// Common pitfall: destructuring reactive props at top level (warns)
function BadArgs({ title }) {
  return <h1>{title}</h1>;
}
```

This also applies to the **bodies of control-flow function children** (e.g. Show/Match/For callbacks): those callbacks are structure-building, so reactive reads done directly in the callback body won’t update and will warn in dev. Prefer reading through JSX expressions (which compile to tracked computations), or wrap the read in a reactive scope.

```js
// ❌ BAD: reactive read in callback body (warns)
<Show when={user()}>
  {(u) => {
    const name = u().name;
    return <span>{name}</span>;
  }}
</Show>

// ✅ GOOD: read in JSX expression (tracked)
<Show when={user()}>{(u) => <span>{u().name}</span>}</Show>
```

Tests: `packages/solid/test/component.spec.ts` ("Strict Read Warning") — warns on direct signal read, props backed by signal, store destructuring; no warn inside createMemo, createEffect, or untrack.

Derived signals should not initiate other signals from reactive values except through the derived (initializer) form.

### `flush` and microtask batching

Updates are applied on the next microtask by default. After calling a setter, reads continue to return the last committed value until the batch is flushed (next microtask, or explicitly via `flush()`). DOM updates and effect callbacks also run after the flush. Use **`flush()`** when you need to read the DOM right after a state change (e.g. focus):

```js
function handleSubmit() {
  setSubmitted(true);
  flush(); // apply updates now
  inputRef.focus(); // DOM is up to date
}
```

**`batch` is removed;** `flush()` is the way to synchronously apply pending updates.

### Split tracking from effect

Effects have two phases: **compute** (reactive reads only; dependencies recorded) and **effect** (side effects; runs after all compute phases in the batch). This gives a clear dependency picture before any side effects run and is required for async and boundaries.

```js
createEffect(
  () => count(),           // compute: only reads
  (value, prev) => {       // effect: runs after flush
    console.log(value);
    return () => { /* cleanup */ };
  }
);

// With initial value
createEffect(
  () => [a(), b()],
  (deps) => { /* ... */ },
  undefined
);
```

**`createRenderEffect`** is split the same way and tears when dependencies change. **`createEffect`** may accept an options object with `effect` and `error` for handling errors from the reactive graph (e.g. async).

### createTrackedEffect and onSettled

**`createTrackedEffect`** is the single-callback form for special cases; it may re-run in async situations and is not the default. **`onSettled`** replaces `onMount`: run logic when the current activity is settled (e.g. after mount, or from an event handler to defer work until the reactive graph is idle).

```js
onSettled(() => {
  const value = count(); // reactive read allowed here
  doSomething(value);
  return () => cleanup();
});
```
Unlike other tracked scopes these primitives cannot create nested primitives which is a breaking change from Solid 1.x. They also return a cleanup function instead of their previous value.

**`onCleanup`** remains for reactive lifecycle cleanup inside computations. But is not expected to be used inside side effects.

## Migration / replacement

- **`batch`:** Remove; use `flush()` when you need synchronous application of updates (e.g. before reading DOM).
- **`onMount`:** Replace with `onSettled`.
- **Writes under scope:** Move setter calls to event handlers, `onSettled`, or untracked blocks; or create the signal with `{ pureWrite: true }` for the rare valid case (e.g. internal or intentionally in-scope writes).

## Removals

| Removed | Replacement / notes |
|--------|----------------------|
| `batch` | `flush()` when you need immediate application |
| `onError` / `catchError` | Effect `error` callback or ErrorBoundary / Errored |
| `on` helper | No longer necessary with split effects |

`@solidjs/legacy` can provide approximations for deprecated APIs where feasible.

## Alternatives considered

- Keeping `batch` as an alias for “run updates now” was considered; unifying on `flush` reduces API surface and matches the mental model (drain queue).
- Keeping a single-callback effect as the default was rejected in favor of split effects for async and boundary semantics.

## Open questions

- Whether to promote the write-under-scope warning to an error in a future release.
