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

#### Awaitable `refresh()`

`refresh()` returns a promise for the target's **next quiescent state**: the re-ask — and anything that supersedes it — has settled. Fire-and-forget callers can keep ignoring it (an ignored promise never surfaces an unhandled rejection); awaiting it turns refresh into a sequencing point:

```js
const submit = action(async function* (order) {
  setOptimisticOrder(order);
  yield api.placeOrder(order);
  // Wait for the refetch to actually land, then act on fresh server state.
  const inv = yield refresh(inventory);
  if (inv[order.sku] < threshold) yield api.flagRestock(order.sku);
});
```

The contract:

- **Value delivery.** Accessor targets resolve with the settled value. Store targets resolve with the store node you passed — stores are identity-stable containers, so the await is the ordering and any read through the node afterwards is fresh. Refreshing a nested store node re-asks the whole family (refresh granularity is the derive function's granularity) but resolves with the node the caller was looking at.
- **Quiescence, not flight identity.** If a second refresh — or any invalidation — supersedes this one mid-flight, the promise waits for whatever finally lands and delivers that. A superseded flight that never settles on its own means nothing; the superseding answer contains or replaces it.
- **Failures propagate.** A failed re-ask rejects the promise. Inside an action, `yield refresh(x)` throws back at the yield point, so the failure joins the action's normal story: catch it to compensate, or let it revert the optimistic state with the failed action.
- **Staged delivery inside actions.** Truth landing into the open transaction stages (it cannot commit while the action holds); the promise still settles then, delivering the staged value — matching `resolve()`/`until()` delivery. The caller's own optimistic override is never the delivered value.
- **Still quiet.** Awaiting does not create a pending window; pair with `affects()` as before when the reload should read as pending.

This is the mutate-then-refetch sequencing primitive: the confirmation is simply "the refetch I issued has settled", with no condition to express and no version fields to invent. When the confirmation instead arrives on a live channel the mutation didn't ask — sockets, subscriptions — reach for `until()` below.

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

### `until()` (live-source acknowledgment)

The flows above assume the mutation's own response confirms the write: await it, `yield refresh()`, done — the refetch's settle point is the confirmation. Actions that feed **live sources** — sockets, subscriptions, live queries — have no such ack: the transport call returns immediately (or is fire-and-forget), and the authoritative update arrives later on the data channel. Without a hold, the action settles at the transport ack, the optimistic state reverts, and the confirmed data flickers in a beat later.

`until(fn, options?)` is that hold. It returns a promise that resolves the first time the reactive predicate `fn` settles **truthy**, with that (narrowed) value. Falsy results and pending async reads both mean "not yet" — the subscription stays live and re-evaluates as sources change. Yield it from an action to hold the transaction — and every optimistic override riding it — open until the world confirms:

```js
const [messages, setMessages] = createOptimisticStore(() => liveQuery("messages"), []);

const send = action(async function* (text) {
  const clientId = crypto.randomUUID();
  setMessages((m) => { m.push({ clientId, text, pending: true }); }); // optimistic
  await socket.send({ clientId, text });                              // fire-and-forget
  // Hold until the live source echoes the write:
  yield until(() => messages.some((m) => m.clientId === clientId), { timeout: 10_000 });
  // settle → the override drops onto data that already contains the real row
});
```

Two properties make this sound:

- **Authoritative-view reads.** Inside an action, the predicate reads the *authoritative* view, and the carve-out is exactly one layer deep: active optimistic **overrides** (and the structure they add — membership, array length, `Object.keys`) are invisible to it, so your own tentative write can never satisfy your own ack — even on the single-primitive shape above, where the optimistic store *is* the live-fed store. Everything else reads normally, **including uncommitted transition-staged data**: truth that arrives *into* the open transaction (the landing of a `refresh()` the action issued, an entangled write) stages and cannot commit until the hold releases — a predicate that refused staged reads would deadlock on the very data it is waiting for. Real data is real wherever it currently lives; only the overlay is optimism. (Derived computeds read by the predicate serve their normal cached values, so express the condition over sources of truth, not derived views of the overlay.)
- **Level-triggered, transport-agnostic.** The predicate is a condition over state, not a listener on a channel. If the confirmation landed before you started waiting, the predicate is already true — there is no subscribe/deliver race, no message buffering, and no coupling to how truth arrives (push, refetch, another tab). Correlation stays in the predicate: a client-generated id the server echoes, or a version check like `doc.version >= saved.version`.

Failure composes with action semantics. `until` rejects on a predicate error, an async source rejection, `{ timeout }` (with `TimeoutError`), or `{ signal }` abort (with the signal's reason); the rejection is thrown back into the generator at the `yield` point — catchable there, or the action fails and its optimistic state reverts. Set `timeout` whenever the confirming truth arrives over a transport that can drop; a dead socket otherwise holds the transaction forever.

Practical guidance:

- **Correlate by key**, not just in the predicate: give the optimistic row the same identity the confirmed row will carry (e.g. the echoed `clientId` as the store key), so the landing replaces it instead of briefly sitting next to it.
- **Scope `affects()` narrowly** during long holds — mark the row, not the store, or every pending-driven affordance reads busy for the whole confirmation window.
- **Any arrival path confirms.** Live-channel landings, other transactions' commits (they land beneath the hold), and refetches the action itself issued (they land *staged into* the hold, and the predicate reads staged data) all satisfy the predicate the moment they carry the confirming truth.

Where `resolve(fn)` answers "what is this value" (first settled value, whatever it is), `until(fn)` answers "when does the world confirm this condition" (first *truthy* settle), and an awaited `refresh(x)` answers "when has this re-ask settled" (no condition at all — the settle point of a refetch you issued). They share delivery machinery; the read-semantics differences are deliberate: `resolve` reads your own transaction's view, overrides included — it is reporting your state. `until` reads the authoritative view, overrides carved out — it is waiting on the world, and your own optimism must not be able to answer for it. `refresh` delivers the landed (staged-or-committed) value, never the caller's override. All see transition-staged data; none can deadlock on a value the surrounding action holds. Most mutate-then-refetch flows want `yield refresh(...)`; only confirmations arriving on a channel the mutation didn't ask genuinely need `until`.

## Migration / replacement

- If you previously used ad-hoc “mutation wrappers” + manual flags, prefer consolidating the pattern into `action()` + optimistic primitives.
- If you used `startTransition` or `useTransition` for mutation UX, those go away; actions/transitions are integrated into the runtime model, and pending UX should be expressed via `isPending`/`Loading` (RFC 05).
- If you paired live sources with timers or manual "pending row" bookkeeping to bridge the mutation-to-subscription gap, replace the bridge with `yield until(...)` — optimistic state clears when truth lands or the hold fails, never on a timer.

## Removals

No direct removals; this RFC is additive. (It complements the removal of `useTransition`/`startTransition` covered in RFC 05.)

## Alternatives considered

- AsyncContext-based mutation scope: rejected for now (not widely available/portable).
- React-style `startTransition` wrappers: rejected in favor of built-in transitions and structured actions.
- Manually passing in a resume function to call after await instead of using generators.
- For live-source acknowledgment: waiting on channel *messages* (edge-triggered `waitForMessage(...)`) — rejected as racy (the ack can arrive before the wait starts), transport-coupled, and correlation-protocol-specific. Holding the *overlay* until the source's next delivery instead of holding the action — rejected because "next delivery" is not "my ack" on a busy channel, and fixing that requires a predicate anyway; it converges to `until` with worse failure semantics.
