# RFC: Stores

**Start here:** If you’re migrating an app, read the beta tester guide first: [MIGRATION.md](MIGRATION.md)

## Summary

Solid 2.0’s store layer leans into “mutable draft” ergonomics by default: store setters accept a draft callback (produce-style) and can optionally return a value to perform a shallow replacement/diff. Helper APIs are simplified (`mergeProps` → `merge`, `splitProps` → `omit`), and a new derived-store primitive (`createProjection`, also reachable via `createStore(fn)`) replaces selector-style patterns with a more general “mutate a projection” approach. A `deep()` helper is provided for cases where you need deep observation rather than property-level tracking.

## Motivation

- **Ergonomics without losing granularity:** Draft-mutation is the most ergonomic way to express updates; the store system can still keep fine-grained reactivity under the hood.
- **Fewer special-case helpers:** `merge` and `omit` apply broadly (props and stores) and avoid surprising `undefined` semantics.
- **Derived stores that scale:** `createSelector`-style APIs solve one pattern; `createProjection` generalizes it and can be used for selection, derived caches, and async-derived store values.

## Detailed design

### Draft-first store setters (“produce by default”)

The primary store update form is a setter that receives a mutable draft.

```js
const [store, setStore] = createStore({ greeting: "hi", list: [] });

setStore((s) => {
  s.greeting = "hello";
  s.list.push("value");
});
```

#### Returning a value performs a shallow replacement/diff

When you need to replace a top-level array/object in one go, return a value from the setter callback.

```js
const [store, setStore] = createStore({ list: ["a", "b"] });

setStore((s) => {
  // Replace the top-level list (shallow diff)
  return { ...s, list: [] };
});
```

#### `storePath` (compat helper for 1.x-style path setters)

Solid 2.0’s default store setter is draft-first (produce-style). For teams migrating from Solid 1.x’s “path argument” setter ergonomics, `storePath(...)` is provided as an **opt-in helper** that adapts the old style into a function you can pass to `setStore`.

```js
// 2.0 preferred: draft-first setter
setStore((s) => {
  s.user.address.city = "Paris";
});

// Optional compat: 1.x-style path setter via storePath
setStore(storePath("user", "address", "city", "Paris"));
```

`storePath` also supports common path patterns (indices, filters, ranges) and a delete sentinel:

```js
setStore(storePath("items", { from: 1, to: 4, by: 2 }, 99));
setStore(storePath("nickname", storePath.DELETE));
```

### `merge` (rename and semantic cleanup)

`merge` replaces `mergeProps` and is treated as a general helper for merging multiple sources. Importantly: **`undefined` is a value**, not “missing”.

```js
const defaults = { a: 1, b: 2 };
const overrides = { b: undefined };
const merged = merge(defaults, overrides);

// merged.b is undefined (explicit override)
```

### `omit` (replaces `splitProps`)

Instead of “splitting” (which creates extra objects and can de-opt proxies), use `omit` to create a view without the listed keys.

```js
const props = { a: 1, b: 2, c: 3 };
const rest = omit(props, "a", "b");

rest.c;        // 3
"a" in rest;   // false
```

### Derived stores: `createProjection` and `createStore(fn)`

`createProjection(fn, initial?, options?)` creates a mutable derived store (a projection). The derive function receives a draft that you can mutate.

If the derive function **returns a value**, that value is **reconciled** into the projection output (rather than being shallowly replaced). This makes “return new data” projections work well for lists/maps while preserving identity for unchanged entries (keyed by `options.key`, default `"id"`).

```js
// Selection without notifying every row
const [selectedId, setSelectedId] = createSignal("a");

const selected = createProjection((s) => {
  const id = selectedId();
  s[id] = true;
  if (s._prev != null) delete s[s._prev];
  s._prev = id;
}, {});
```

```js
// Reconcile returned list data into a projection (keyed reconciliation)
const users = createProjection(async () => {
  return await api.listUsers();
}, [], { key: "id" });
```

`createStore(fn, initial?, options?)` is the derived-store form; it’s effectively “projection store” creation using the familiar store API.

```js
const [cache] = createStore((draft) => {
  // mutate derived draft based on reactive inputs
  draft.value = expensive(selector());
}, { value: 0 });
```

### `snapshot(store)` (replaces `unwrap`)

`snapshot(store)` produces a **non-reactive plain value** suitable for serialization or interop with libraries that expect plain objects/arrays.

In Solid 2.0 the store implementation leans on immutable internals; simply “unwrapping” proxies is not sufficient when you need a distinct object graph. `snapshot` generates a new object/array where necessary (while preserving references when nothing has changed).

```js
const [store] = createStore({ user: { name: "A" } });

const plain = snapshot(store);
JSON.stringify(plain);
```

### `deep(store)` helper

Store tracking is normally property-level (optimal). When you truly need deep observation (e.g. for serialization, logging, or “watch everything”), use `deep(store)` inside a reactive scope.

```js
createEffect(
  () => deep(store),
  (snapshot) => {
    // runs when anything inside store changes
  }
);
```

## Migration / replacement

### `mergeProps` → `merge`

- Rename imports/usage.
- Update expectations: `undefined` overrides rather than being skipped.

### `splitProps` → `omit`

- Replace `splitProps(props, ["a", "b"])` with `omit(props, "a", "b")`.
- Prefer passing `props` through where possible rather than copying.

### `createSelector` → `createProjection`

- Replace selector patterns with a projection store that updates only the affected keys.

### `unwrap` → `snapshot`

- Replace `unwrap(store)` with `snapshot(store)` when you need a plain value for serialization/interop.

## Removals

| Removed | Replacement |
|--------|-------------|
| `mergeProps` | `merge` |
| `splitProps` | `omit` |
| `createSelector` | `createProjection` / `createStore(fn)` |
| `unwrap` | `snapshot` |

## Alternatives considered

- Keeping `splitProps`: rejected due to allocation/proxy-deopt costs and because `omit` is sufficient.
- Keeping `createSelector`: rejected as too narrow; `createProjection` is a more general tool.
