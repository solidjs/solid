# RFC: Stores

**Start here:** If you’re migrating an app, read the migration guide first: [MIGRATION.md](MIGRATION.md)

## Summary

Solid 2.0’s store layer leans into “mutable draft” ergonomics by default: store setters accept a draft callback (produce-style) and can optionally return a value to perform a shallow replacement/diff. Helper APIs are simplified (`mergeProps` → `merge`, `splitProps` → `omit`), and a new derived-store primitive (`createProjection`, also reachable via `createStore(fn)`) replaces selector-style patterns with a more general “mutate a projection” approach. A `deep()` helper is provided for cases where you need deep observation rather than property-level tracking, and `createStore(value, { shallow: true })` provides a single-layer store for record-granularity data — root keys reactive, values plain records replaced by reference.

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

**A derive must never swallow `NotReadyError`** (#3073). Reading a not-yet-settled async source inside a derive throws; that propagation is load-bearing. It is how loading states coordinate on every build, and on the server build — which has no subscription graph — it is additionally the *only* re-derive channel: the projection machinery catches the escaping error, holds the projection pending, and retries the derive when the source settles. A derive that wraps its reads in a broad `try/catch` "completes" with partial state and severs that channel — the browser build masks the mistake (dependencies register before the throw, so reactivity re-runs the derive anyway), but the node build freezes at the first result. To branch on readiness instead of suspending, probe with `isPending()` rather than catching; not-ready handling (hold the previous state, retry at settlement) is already the machinery's job.

**`createStore(fn, seed, options?)`** — a writable derived store. Same derive semantics as `createProjection`, but returns `[store, setter]` so you can also write to it imperatively. Use this when you need both reactively derived state *and* local mutations.

```js
const [cache, setCache] = createStore((draft) => {
  draft.value = expensive(selector());
}, { value: 0 });

// Can also write imperatively
setCache(s => { s.override = true; });
```

### `reconcile(value, key?)` (diffing into stores)

`reconcile` returns a diffing function that updates a store (or a nested part of a store) from new data while preserving identity for unchanged entries. The second argument is the key used for identity matching (a string property name or a function). It defaults to `"id"`; pass `null` for **positional** matching — index N of the new array merges into index N of the old, with no keyed diff pass. Positional mode is the classic pattern for fixed-shape data that churns in place (dashboards, monitors), and is what 1.x expressed as `reconcile(v, { key: null, merge: true })` — merge semantics are always on in 2.0.

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

### Shallow stores (`shallow: true`)

By default stores track at property level all the way down — that is the model, and it is the right choice for almost all state. `shallow: true` is a **specialized performance opt-in** for one identifiable workload shape, not a general recommendation: reach for it when profiling shows ingestion cost on data whose records change wholesale.

`createStore(value, { shallow: true })` creates a **single-layer** store: the root's own keys are fully reactive (per-key tracking, membership, enumeration, `length`), while the values under them are **plain records replaced by reference** — no proxies, no tracking, and no deep diffing below the boundary.

```js
const [rows, setRows] = createStore(initialRows, { shallow: true });

// each poll delivers a completely fresh payload
onPoll(fresh => setRows(reconcile(fresh, null)));
```

Use this when the *record* is the unit of change: rows, entities, or feed items that arrive or update wholesale (server collections, polling dashboards, streamed lists). Deep tracking earns its cost by skipping unchanged leaves; when every leaf of a changed record changes together, that machinery is pure overhead — a shallow store makes ingestion a per-slot reference compare and reads below the boundary plain property access.

The contract, stated once: **records are replaced, never edited.**

- Reads below the boundary — including inside a setter — hand back the plain record, so read-then-replace, `filter`/`pop` removal idioms, and projection derives all work naturally. Mutating a record in place notifies nothing.
- Records that pass through a shallow boundary stay plain permanently and present identically through every store (one identity — never wrapped elsewhere). Ingesting a value that is already deep-tracked throws in dev.
- `reconcile` at the boundary is positional (`reconcile(fresh, null)`). Keyed row identity belongs to the consumer. In a deep store, reference-keyed `<For>` works because reconcile preserves each row's *proxy* across payloads; shallow rows have no proxy, so a rebuilt payload means new references in every slot — give `<For>` the identity function the proxy used to embody. (Reference keying remains fine when your data flow reuses objects for unchanged records.)

```js
<For each={rows} keyed={(row) => row.id}>
  {(row) => <tr>...{row().name}...</tr>}
</For>
```

Unchanged slots skip by reference equality (a partial payload that reuses row objects re-renders nothing), same-key replacements update through the row accessor without touching the DOM row, and new/removed keys create and dispose as usual.

`shallow` is also accepted by `createProjection` and `createOptimisticStore`. Optimistic writes compose cleanly with the replacement contract: a tentative record replacement stages in the overlay, shows immediately, and reverts to the untouched original — the base records are never mutated.

When *not* to use it: state you edit field-by-field (forms, editors, sparse in-place mutation). That is exactly what the default deep store is optimal for — shallow trades leaf granularity for record-granularity throughput, and re-runs all of a record's bindings when the record is replaced.

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
