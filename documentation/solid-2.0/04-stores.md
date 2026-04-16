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

The relationship between these two mirrors the signal/memo split:

| Signals | Stores |
|---------|--------|
| `createMemo(fn)` — readonly derived value | `createProjection(fn, seed)` — readonly derived store |
| `createSignal(fn)` — writable derived value | `createStore(fn, seed)` — writable derived store |

Just as `createMemo` returns only a getter and `createSignal(fn)` returns `[getter, setter]`, `createProjection` returns only the store while `createStore(fn, seed)` returns `[store, setter]`.

**`createProjection(fn, seed, options?)`** — a readonly derived store. The derive function receives a draft it can mutate. If the derive function **returns a value**, that value is **reconciled** into the output (keyed by `options.key`, default `"id"`), preserving identity for unchanged entries.

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

**`createStore(fn, seed, options?)`** — a writable derived store. Same derive semantics as `createProjection`, but returns `[store, setter]` so you can also write to it imperatively. Use this when you need both reactively derived state *and* local mutations.

```js
const [cache, setCache] = createStore((draft) => {
  draft.value = expensive(selector());
}, { value: 0 });

// Can also write imperatively
setCache(s => { s.override = true; });
```

### `reconcile(value, key)` (diffing into stores)

`reconcile` returns a diffing function that updates a store (or a nested part of a store) from new data while preserving identity for unchanged entries. The second argument is the key used for identity matching (a string property name or a function).

In 2.0 the usage changes from 1.x because setters are now draft-first: you call `reconcile` *inside* the setter callback, targeting the specific part of the draft you want to reconcile.

```js
// 1.x (path-style setter)
setStore("todos", reconcile(serverTodos));

// 2.0 (draft-first setter)
setStore(s => {
  reconcile(serverTodos, "id")(s.todos);
});
```

This pairs naturally with `createProjection`, where returning a value from the derive function uses reconciliation automatically (keyed by `options.key`, default `"id"`).

### `snapshot(store)` (replaces `unwrap`)

`snapshot(store)` produces a **non-reactive plain value** suitable for serialization or interop with libraries that expect plain objects/arrays.

In Solid 2.0 the store implementation leans on immutable internals; simply “unwrapping” proxies is not sufficient when you need a distinct object graph. `snapshot` generates a new object/array where necessary (while preserving references when nothing has changed).

```js
const [store] = createStore({ user: { name: "A" } });

const plain = snapshot(store);
JSON.stringify(plain);
```

### `deep(store)` helper

Store tracking is normally property-level (optimal). When you need deep observation, use `deep(store)` in the compute phase of a split effect. It subscribes to every nested property and returns a plain (non-proxy) snapshot.

This matters because the effect callback runs in an untracked scope — if you pass a store proxy through and read its properties in the effect half, those reads trigger `STRICT_READ_UNTRACKED` warnings and won't re-run the effect. `deep()` solves this by doing all the reads in the compute phase and handing a plain object to the effect:

```js
createEffect(
  () => deep(store),
  (snapshot) => {
    // snapshot is a plain object — safe to read, serialize, diff
    saveToLocalStorage(JSON.stringify(snapshot));
  }
);
```

Contrast with `snapshot(store)`, which also returns a plain object but does **not** subscribe — useful when you need the current store value without tracking it. See [RFC 01 — Stores in the compute phase](01-reactivity-batching-effects.md#stores-in-the-compute-phase) for the full pattern comparison.

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
