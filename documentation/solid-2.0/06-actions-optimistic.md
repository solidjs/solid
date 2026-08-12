# RFC: Actions and optimistic updates

**Start here:** If you’re migrating an app, read the migration guide first: [MIGRATION.md](MIGRATION.md)

## Summary

Solid 2.0 introduces an `action()` wrapper for async mutations and a pair of optimistic primitives—`createOptimistic` and `createOptimisticStore`—to express “optimistic UI” without inventing a separate mutation subsystem. Actions run inside transitions and provide a structured way to interleave optimistic writes, async work, and refreshes. Optimistic primitives behave like signals/stores but reset to their source when the transition completes.

## Motivation

- **Mutations are not reads:** Async data reads can be modeled as computations (RFC 05). Mutations need a different tool: they should coordinate optimistic writes, async side effects, and follow-up refreshes.
- **Optimism should compose:** Optimistic UI should reuse the signal/store mental model, and should integrate with transitions rather than forking the reactive graph.
- **Ergonomics:** A generator-based API provides a simple “do optimistic update → await → refresh” workflow without needing ambient async context features.

## Detailed design

### `action(fn)` for async mutations

`action()` wraps a generator or async generator and returns an action: an async function you can call from handlers. Inside an action, you can:

- do optimistic writes
- yield/await async work
- refresh derived async computations via `refresh()`

```js
const [todos, setOptimisticTodos] = createOptimisticStore(() => api.getTodos(), []);

const saveTodo = action(function* (todo) {
  // optimistic write
  setOptimisticTodos((todos) => { todos.push(todo); });

  // perform async work
  yield api.addTodo(todo);

  // refresh reads (store/projection form)
  refresh(todos);
});
```

For better TS ergonomics, an async generator form is also viable:

```js
const saveTodo = action(async function* (todo) {
  setOptimisticTodos((todos) => { todos.push(todo); });
  const res = await api.addTodo(todo);
  yield; // resume action in the same transition context
  refresh(todos);
  return res;
});
```

### `refresh()` (explicit recomputation)

Solid 2.0 exports a `refresh()` helper to explicitly re-run derived reads when you know the underlying source-of-truth may have changed (for example, after an action completes a server write).

Conceptually, `refresh()` is “invalidate and recompute now”, without requiring you to thread bespoke `refetch()` methods through your app.

Pass a refreshable source directly. `refresh(x)` requests recomputation for `x` when `x` is a derived signal/store/projection that participates in refresh (e.g. things created via function forms like `createStore(() => ...)` / projections).

```js
// Re-run one derived source explicitly
refresh(user);
```

```js
// After a server write, refresh derived store reads
const [todos] = createStore(() => api.getTodos(), []);

const addTodo = action(function* (todo) {
  yield api.addTodo(todo);
  refresh(todos);
});
```

`refresh()` is not a UI state primitive. During mutations, express the expected user-visible state with `createOptimistic` / `createOptimisticStore`, then call `refresh()` to reconcile with the source of truth after the server write.

`refresh()` is also an action: call it from event handlers, effects, or other actions rather than from pure computations. It starts invalidation work; it does not carry user-visible optimistic state by itself. Because it re-asks the *same* question (no input changed), a bare `refresh()` is quiet: the fresh value reveals silently and `isPending` stays `false`. When the reload should read as pending, declare it with `affects()`.

### `affects(target, key?)` (declare what in-flight work will change)

`affects` declares that the surrounding work will change the targeted data. The marked data — and anything derived from it — reads as pending (`isPending` → `true`) from the declaration until the transaction settles or reverts, exactly as if a real fetch for it were in flight; the values themselves stay readable throughout. It is additive only: a declaration can turn pending *on* for data the graph can't see changing yet; nothing turns pending *off* while a real change is in flight — pairing `affects(x)` with `refresh(x)` keeps the whole window pending even though the bare refresh alone would be quiet.

Targets mirror how you read: `affects(store)` marks a store record (root or nested) and everything reachable from it at declaration time — including rows captured by `<For>` — while siblings stay untouched; `affects(record, "key")` marks exactly the named slot; and `affects(accessor)` marks a signal/memo source. One key per call — keys do **not** form a path (mark several slots with several calls, or target the nested record directly).

```js
const reload = action(function* () {
  affects(todos);   // the whole store reads pending…
  refresh(todos);   // …over this otherwise-quiet re-ask
  yield api.done();
});

const rename = action(function* (todo, text) {
  setOptimisticTodos(() => { todo.text = text; });
  affects(todo, "updatedAt"); // server will change this slot too
  yield api.rename(todo.id, text);
  refresh(todos);
});
```

Note the division of labor: optimistic writes show the expected value (they are verdict-inert — they neither pend their own slot nor silence anything else), `affects` marks data you know is changing but can't show yet, and process affordances (“saving…”, a disabled reload button) are co-written state — an optimistic boolean in the action that reverts on settle — not verdicts.

### `createOptimistic` (optimistic signal)

`createOptimistic` has the same surface as `createSignal`, but its writes are treated as optimistic—values can be overridden during a transition and revert when the transition completes.

```js
const [name, setName] = createOptimistic("Alice");

const updateName = action(function* (next) {
  setName(next);          // optimistic
  yield api.saveName(next);
});
```

### `createOptimisticStore` (optimistic store)

`createOptimisticStore(fnOrValue, seed, options?)` is the store analogue in its derived-store form. That second argument is the backing host object/array for the optimistic proxy. A common pattern is to derive from a source getter and then apply optimistic mutations in an action.

```js
const [todos, setOptimisticTodos] = createOptimisticStore(() => api.getTodos(), []);

const addTodo = action(function* (todo) {
  setOptimisticTodos((todos) => { todos.push(todo); });
  yield api.addTodo(todo);
  // refresh store/projection form (object with [$REFRESH])
  refresh(todos);
});
```

## Migration / replacement

- If you previously used ad-hoc “mutation wrappers” + manual flags, prefer consolidating the pattern into `action()` + optimistic primitives.
- If you used `startTransition` or `useTransition` for mutation UX, those go away; actions/transitions are integrated into the runtime model, and pending UX should be expressed via `isPending`/`Loading` (RFC 05).

## Removals

No direct removals; this RFC is additive. (It complements the removal of `useTransition`/`startTransition` covered in RFC 05.)

## Alternatives considered

- AsyncContext-based mutation scope: rejected for now (not widely available/portable).
- React-style `startTransition` wrappers: rejected in favor of built-in transitions and structured actions.
- Manually passing in a resume function to call after await instead of using generators.
