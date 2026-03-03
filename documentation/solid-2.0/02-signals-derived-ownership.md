# RFC: Signals, derived primitives, ownership, and context

**Start here:** If you’re migrating an app, read the beta tester guide first: [MIGRATION.md](MIGRATION.md)

## Summary

This RFC groups the “core runtime ergonomics” changes that are tightly coupled: **ownership defaults**, **context provider ergonomics**, and **derived (function-form) primitives**. The goal is to make reactive lifetime more predictable (fewer unowned graphs), reduce API surface (`Context.Provider`, `createComputed`), and make “derived state” patterns use consistent primitives with clearer semantics.

## Motivation

- **Ownership as the default:** In 1.x it’s easy to accidentally create unowned reactive graphs (especially in library code), which leads to leaks and confusing cleanup. In 2.0 we want ownership to be the default and detaching to be explicit.
- **Context ergonomics:** `Context.Provider` is boilerplate and a special-case surface. Using the context value directly as the provider component reduces ceremony and aligns with how it’s used.
- **Derived primitives:** Patterns that previously relied on `createComputed` (or ad-hoc “write-back” computations) should move to primitives that are composable with async and with split effects. “Function-form” `createSignal` / `createStore` offer a single consistent place for “derived but writable” shapes.

## Detailed design

### Ownership: `createRoot` is owned by the parent by default

In 2.0, a root created inside an existing owned scope is itself owned by that parent (and will be disposed when the parent is disposed). You still get a `dispose` callback for manual cleanup.

```js
function Widget() {
  createRoot((dispose) => {
    const [count, setCount] = createSignal(0);
    const id = setInterval(() => setCount((c) => c + 1), 1000);
    onCleanup(() => clearInterval(id));
  });
  return null;
}
// When Widget is disposed, the nested root is disposed too.
```

#### Detaching is explicit: `runWithOwner(null, ...)`

If you really want “no owner” (module singletons, external integrations), detach explicitly:

```js
// A truly detached singleton
export const singleton = runWithOwner(null, () => {
  const [value, setValue] = createSignal(0);
  return { value, setValue };
});
```

This makes “global lifetime” an explicit opt-in rather than the accidental default.

### Context: context value is the provider component

Context creation still looks the same, but usage becomes simpler: the context itself is a component that takes a `value` prop and provides it to descendants.

```js
// 2.0
const ThemeContext = createContext("light");

function App() {
  return (
    <ThemeContext value="dark">
      <Page />
    </ThemeContext>
  );
}

function Page() {
  const theme = useContext(ThemeContext);
  return <div class={theme}>...</div>;
}
```

### Derived primitives: function-form `createSignal` and `createStore`

2.0 supports function overloads for `createSignal` and `createStore` to represent “derived state” using the same primitives users already know.

#### Function-form `createSignal` (“writable memo”)

`createSignal(fn, initialValue?, options?)` creates a signal whose value is computed by `fn(prev)` and can also be written through its setter. This replaces many `createComputed` “write-back” use cases with an explicit primitive.

```js
// Example: derived signal
const [value, setValue] = createSignal(() => props.something);
// setValue(...) writes like a normal signal; the compute receives prev on recompute.ß
```

#### Function-form `createStore` (derived/projection store)

`createStore(fn, initial?, options?)` creates a derived store driven by mutation in `fn(draft)` (and may also return a value / Promise / async iterable). It’s the store analogue for derived shapes and underpins patterns like “selector-like” updates without notifying everything.

```js
// Example: derived store that only flips the active key
const [selected, setSelected] = createStore((draft) => {
  const id = selectedId();
  draft[id] = true;
  if (draft._prev != null) delete draft[draft._prev];
  draft._prev = id;
}, {});
```

## Migration / replacement

### `Context.Provider` → context-as-provider

```jsx
// 1.x
<ThemeContext.Provider value="dark">
  <Page />
</ThemeContext.Provider>

// 2.0
<ThemeContext value="dark">
  <Page />
</ThemeContext>
```

### Unowned roots → explicit detachment

- If you relied on roots living “forever,” wrap them in `runWithOwner(null, ...)`.
- Otherwise, prefer creating roots under an existing owner so disposal is automatic.

### `createComputed` removal

If you used `createComputed` to “write back”:

- Prefer split `createEffect(compute, effect)` (RFC 01) when the intent is “react to X and do side effects”.
- Prefer function-form `createSignal` / `createStore` when the intent is “derived state with a setter”.
- Prefer `createMemo` for readonly derived values.

## Removals

| Removed | Replacement |
|--------|-------------|
| `createComputed` | `createEffect` (split), function-form `createSignal`/`createStore`, or `createMemo` |
| `Context.Provider` | Use the context directly as the provider component (`<Context value={...}>`) |

## Alternatives considered

- Keeping `createRoot` detached by default: rejected because it makes leaks and “forever lifetime” accidental.
- Keeping `Context.Provider`: rejected as needless boilerplate and special casing.
- Keeping `createComputed`: rejected because “write-back computations” are harder to reason about in an async/split-effects model.

## Open questions

- Should we provide an explicit “detached root” helper (sugar over `runWithOwner(null, ...)`) for readability?
