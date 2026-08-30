# Solid 2.0 × Effect

Two demos showing that Solid 2.0 and [Effect](https://effect.website) compose without a binding
library. The entire integration is [`src/solid-effect.ts`](src/solid-effect.ts) (~60 lines, two
exports) — no `Result` wrappers, no hooks, no atom layer.

```bash
pnpm install
pnpm dev # http://localhost:3007
```

## Why this works now

Solid 1.x integrations (e.g. `@effect-atom/atom-solid`) had to reimplement loading/error state on
top of Solid: atoms return `Result` values you pattern-match by hand. Solid 2.0 makes async
first-class on ordinary computations — a memo can return a `PromiseLike` or an `AsyncIterable`,
pending propagates to `<Loading>`, failures propagate to `<Errored>`, and
`latest`/`isPending` give stale-while-revalidate. That surface happens to line up with Effect's
execution model almost one-to-one.

## Read path — typeahead (`runEffect`)

```tsx
const results = createMemo<Package[]>(() => {
  const q = query().trim();
  if (!q) return [];
  return runEffect(searchPackages(q)); // Effect w/ retry + backoff + timeout + typed errors
});
```

`runEffect` adapts an Effect to the AsyncIterable protocol. The load-bearing alignment is
**cancellation**: when a computation re-runs, Solid closes the superseded flight's iterator
(`it.return()`), and `runEffect`'s `return()` interrupts the fiber. Effect's structured
interruption then tears down the whole in-flight tree — pending retries, timeouts, finalizers —
with neither side knowing about the other. Type fast and watch the event log: every superseded
keystroke is _interrupted_, not merely ignored. No debounce, no `AbortController`, no request
bookkeeping in the component.

Note the granularity: a plain `Effect.runPromise` result would _not_ be interruptible (Solid drops
stale promises by identity; it has no way to abort them). Routing through the iterator protocol is
what connects Solid's flight lifecycle to Effect's fiber lifecycle.

## Action path — checkout saga (`effectAction`)

```tsx
const placeOrder = effectAction(function* (items, decline) {
  setPhase("reserving");
  const reservation = yield* reserveInventory(items); // each yield* = one transaction step,
  setPhase("charging"); //                               run as an interruptible fiber
  const charge = yield* chargeCard(total, decline);
  ...
});
```

Solid's `action` runs a generator as a transaction: writes between yields commit atomically per
step, and `createOptimistic` writes revert when the action settles. Effect values are iterable
(that is how `Effect.gen` works), so `yield*` inside a plain generator delegates the Effect out to
`effectAction`'s driver loop **with full inferred types** — the saga reads exactly like
`Effect.gen`, but each `yield*` is also a transaction boundary.

Two properties fall out:

- **The `await` hazard is unexpressible.** `action` documents that `await` escapes the
  transaction (writes after it commit immediately) and asks for a bare `yield` before post-await
  writes. Effect programs have no `await` — every suspension is `yield*`, which is exactly the
  transaction-safe suspension point. The discipline Effect enforces is the discipline the
  transaction wants.
- **Cancellation composes into a saga.** Cancel (or a typed `CardDeclinedError`) surfaces inside
  the generator as a throw at the in-flight `yield*`. The catch block runs compensations in
  reverse order of what committed (refund the charge, release the inventory hold) — as further
  transaction steps — while the interrupted step's own `onInterrupt` finalizers cover mid-step
  cleanup (voiding a half-done authorization). Rethrowing rejects the action, which reverts the
  optimistic UI automatically. Client and server roll back together; the component contains no
  undo logic.

A superseding invocation interrupts the previous one's in-flight fiber before starting, so a
double-submit cancels (with compensation) rather than silently racing.

## Honest notes

- Each `yield*`-ed step runs as its **own fiber**. Cross-step compensation therefore lives in the
  generator's catch block (the saga coordinator), not in Effect finalizers — finalizers only cover
  the step they're attached to. That split is deliberate and arguably clearer, but it is a
  difference from running one big `Effect.gen` program.
- Effect's typed error channel degrades to a thrown value at `<Errored>` on the read path.
  Inside `effectAction` generators it survives (`instanceof` narrows `Data.TaggedError` classes).
- Services/`Layer` are not wired up here; a real integration would provide a `ManagedRuntime` via
  Solid context and use `Effect.runFork` from it. `runEffect`/`effectAction` as written use the
  default runtime, so steps are typed `Effect<A, E, never>`.
- `repro-close-timing.mjs` documents a core finding from building this example
  ([#3122](https://github.com/solidjs/solid/issues/3122)): an `isPending` read over the source
  defers the superseded flight's iterator close until the superseding flight settles, so the
  first keystroke's fiber is interrupted late instead of at supersede time.
