# Solid 2.0 × Effect

Two demos showing that Solid 2.0 and [Effect](https://effect.website) compose without a binding
library. The entire integration is [`src/solid-effect.ts`](src/solid-effect.ts) (~90 lines:
`runEffect`, `effectAction`, and a runtime context) — no `Result` wrappers, no hooks, no atom
layer.

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

## Why Solid specifically

The comparison that matters isn't Solid 1.x — it's that these seams don't exist in other
frameworks:

- **A place to put interruption.** Solid consumes AsyncIterables as first-class computation
  values, and a superseded flight's iterator gets `it.return()`. That protocol hook is the entire
  cancellation bridge (`return()` → `Fiber.interrupt`). React's `use()` and query libraries can
  render promise states, and Svelte's async `$derived` covers loading/error propagation — but
  both simply _drop_ a stale promise. There is no lifecycle moment that says "this producer is
  now unwanted," so Effect's structured interruption has nothing to attach to short of hand-wired
  `AbortController`s. Wasted retries, open resources, and server load are invisible and
  unrecoverable by design.
- **A transaction to put steps in.** `action` runs a generator as a transaction with atomic
  per-step commits, and `createOptimistic` writes revert on failure. That is the half of a saga
  Effect cannot provide: Effect can compensate the server, but it cannot roll back your UI.
  React's `useOptimistic` is per-hook state, not a multi-step transaction; Svelte has no
  counterpart. Without it, "cancel mid-checkout" means hand-written undo logic no matter how good
  the effect system is.
- **Matching execution models.** Solid flights and Effect fibers are both structured and
  pull-based — they start, supersede, and dispose on the same schedule, and both suspend on
  generator yields. That's why the integration is protocol-level (async iteration on the read
  path, `yield*` delegation on the action path) rather than a binding library: neither side wraps
  or schedules the other. Frameworks whose unit of work is "re-render the component" need the
  atom/registry layer precisely because their lifecycle and Effect's don't line up anywhere.
- **A tree to put services in.** Effect's requirement channel (`R`) needs someone to provide
  `Layer`s and scope their lifetimes. Solid context _is_ that structure: `createRuntime(layer)`
  builds a `ManagedRuntime` disposed by `onCleanup` (service lifetime = subtree lifetime), and
  `runEffect`/`effectAction` resolve it from the nearest `RuntimeContext` — so providing a
  different runtime lower in the tree overrides services for that subtree only, hierarchically,
  the same way any Solid context works. Cross-subtree sharing is Effect's own machinery, not
  ours: nested providers pass the parent runtime's `MemoMap` to `ManagedRuntime.make`, so a layer
  used by several subtrees is built once and finalized by Effect's refcounting when the last
  subtree unmounts. A flat global registry has to reintroduce scoping; Solid's ownership tree
  already is one.

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
- Services/`Layer` ride Solid context: the app provides
  `<RuntimeContext value={createRuntime(SearchConfigLive)}>`, and `searchPackages` requires
  `SearchConfig` through the typed `R` channel. `runEffect` resolves the runtime at the reading
  computation, `effectAction` at component setup; both fall back to the default runtime, which is
  only sound for `R = never` steps (the checkout saga runs that way). One composition note:
  `ManagedRuntime.make` wants a self-contained layer (`RIn = never`), so a child provider whose
  layer depends on parent services composes with `Layer.provideMerge` — the shared `MemoMap`
  makes the overlapping construction free.
- `repro-close-timing.mjs` documents a core finding from building this example
  ([#3122](https://github.com/solidjs/solid/issues/3122)): an `isPending` read over the source
  defers the superseded flight's iterator close until the superseding flight settles, so the
  first keystroke's fiber is interrupted late instead of at supersede time.
