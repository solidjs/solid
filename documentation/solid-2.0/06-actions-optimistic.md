# RFC: Actions and optimistic updates

**Start here:** If you’re migrating an app, read the beta tester guide first: [MIGRATION.md](MIGRATION.md)

## Summary

Solid 2.0 introduces an `action()` wrapper for async mutations and a pair of optimistic primitives—`createOptimistic` and `createOptimisticStore`—to express “optimistic UI” without inventing a separate mutation subsystem. Actions run inside transitions and provide a structured way to interleave optimistic writes, async work, and refreshes. Optimistic primitives behave like signals/stores but reset to their source when the transition completes.

## Motivation

- **Mutations are not reads:** Async data reads can be modeled as computations (RFC 05). Mutations need a different tool: they should coordinate optimistic writes, async side effects, and follow-up refreshes.
- **Optimism should compose:** Optimistic UI should reuse the signal/store mental model, and should integrate with transitions rather than forking the reactive graph.
- **Ergonomics:** A generator-based API provides a simple “do optimistic update → await → refresh” workflow without needing ambient async context features.

## Detailed design

### `action(fn)` for async mutations

`action()` wraps a generator or async generator. It returns an async function you can call from handlers. Inside an action, you can:

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

It supports two common forms:

- **Thunk form**: `refresh(() => expr)` re-runs `expr` (typically something that reads async-derived values) and returns its value.
- **Refreshable form**: `refresh(x)` requests recomputation for `x` when `x` is a derived signal/store/projection that participates in refresh (e.g. things created via function forms like `createStore(() => ...)` / projections).

```js
// Re-run a read tree explicitly
refresh(() => query.user(id()));
```

```js
// After a server write, refresh derived store reads
const [todos] = createStore(() => api.getTodos(), []);

const addTodo = action(function* (todo) {
  yield api.addTodo(todo);
  refresh(todos);
});
```

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

`createOptimisticStore(fnOrValue, initial?, options?)` is the store analogue. A common pattern is to derive from a source getter and then apply optimistic mutations in an action.

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
