# solid-js

## 2.0.0-beta.9

### Patch Changes

- 9015b12: AI-readiness docs/JSDoc pass — continued from the initial pass shipped earlier on this branch. Targets the failure modes surfaced while authoring the kitchen-sink TodoMVC example.

  **Cheatsheet (`solid-js/CHEATSHEET.md`)**
  - New "Props" section leading with "props are reactive values, not accessors". Covers the two failure modes that dominated the audit: passing `filter={filter}` instead of `filter={filter()}`, and destructuring props in the child (`function Comp({ value })`) which unwraps reactivity once and breaks tracking. The footgun list now points at this section.
  - Reframed `onSettled` as the canonical lifecycle primitive for component-level setup/teardown (return a cleanup function from the body); demoted `onCleanup` to advanced.
  - Store/setter/projection entries reframed to match the JSDoc precision below.

  **`createStore`, `createOptimisticStore`, `createProjection`**
  - `StoreSetter<T>` is mutation-first; the return form is shallow (arrays index-replace + length-adjust, objects top-level diff) and is **not** keyed reconciliation. Keyed reconciliation belongs to the projection-function return path (`createStore(fn, …, { key })`, `createProjection`, `createOptimisticStore(fn, …)`), where the function's return is reconciled by `options.key` (default `"id"`).
  - `createStore` JSDoc gained a paragraph against putting signal accessors as store property values — the proxy already tracks reads per-property; nesting `() => signal()` inside a store property gives you a getter that won't track when called.
  - `createOptimisticStore` / `createProjection` — explicit note that `options.key` defaults to `"id"` and is only worth specifying for non-`id` identity fields. Replaced the imperative `draft.length = 0; draft.push(...)` example with a `return …filter(...)` form that names the keyed-reconcile guarantee, plus a per-property mutation example.
  - Added a `setStore(s => s.list.filter(...))` line to `createStore` and a `removeTodo` `filter`-return action to `createOptimisticStore`.

  **`<Loading>`**
  - Added a sentence on scoping: place the boundary around the data-dependent slot, not the surrounding shell, so revalidation doesn't replace layout chrome with the fallback.

  **Hydration wrappers (`solid-js`)**
  - The hydration-aware re-exports of `createMemo`, `createSignal`, `createOptimistic`, `createProjection`, `createStore`, `createOptimisticStore`, `createRenderEffect`, `createEffect`, and `createErrorBoundary` previously had no docs at the wrapper site — hovering them in `solid-js` showed only the type signature. Each wrapper now carries the canonical primitive description plus a short **Hydration** paragraph pointing at the new `HydrationSsrFields` type, which centrally documents the `ssrSource` modes (`"server"` / `"hybrid"` / `"client"`) and `deferStream`.
  - `HydrationProjectionOptions` (used by `createProjection`, the projection form of `createStore`, and `createOptimisticStore`) gets its own JSDoc explaining the `ssrSource` extension over `ProjectionOptions`.

  **`@solidjs/universal` README**
  - 2.0 banner added matching the `@solidjs/web` pattern — names the `solid-js/universal` → `@solidjs/universal` rename and the new deferred-mount semantics in the wrapped `createRenderer.render` (top-level mount goes through the effect queue and drains with a tail `flush()`; uncaught top-level async holds the initial commit on the active transition).
  - Custom-renderer example fixed: import path corrected to `@solidjs/universal`, the destructured `use` (1.x relic) replaced with `applyRef, ref` to match the actual `dom-expressions/universal.js` return shape, and the forwarded control-flow list updated to 2.0 names — `For, Repeat, Show, Switch, Match, Errored, Loading, Reveal` instead of `For, Show, Suspense, SuspenseList, Switch, Match, Index, ErrorBoundary`.

  JSDoc/example/docs only — no runtime or type-signature changes.

- fb2e43b: Docs and JSDoc pass for AI-assisted code generation: rewrite root, `solid-js`, and `@solidjs/web` READMEs for the 2.0 beta; ship a one-page `CHEATSHEET.md` inside the `solid-js` npm package; audit and add `@example` blocks to the high-traffic public exports across `solid-js`, `@solidjs/web`, and `@solidjs/signals`. No runtime changes.
- 845b6bb: Drop the solid-side support machinery for dom-expressions' old
  `memo(accessor, true)` wrap in `insert()`. That wrap has been replaced in
  dom-expressions with a conditionally nested render-effect pattern that
  splits the accessor's creation scope from its read scope — fixing stale
  reads and transition-ownership regressions (the Sierpinski hover freeze)
  without reintroducing the #2610 sibling re-render.

  Solid-side companion cleanup:
  - `@solidjs/web` `memo` helper collapses to `createMemo(() => fn())` and
    drops the `coreMemo` import; the `transparent` branch and `$r`
    short-circuit are no longer reachable.
  - `@solidjs/signals` `accessor()` no longer tags the returned function
    with `$r`.
  - `@solidjs/web` drops `@solidjs/signals` from `peerDependencies` and
    `devDependencies` — it reaches signals transitively through
    `solid-js`.

  No public API changes. Coordinates with a forthcoming dom-expressions
  release.

- 23f7550: Bump dom-expressions/babel-plugin-jsx-dom-expressions/hyper-dom-expressions to 0.50.0-next.3. Replace lit-dom-expressions with sld-dom-expressions in @solidjs/html for an AST-driven, CSP-safe tagged-template runtime. Wire `untrack` into @solidjs/h's runtime to satisfy the new hyper API. Add small vitest smoke suites for @solidjs/h and @solidjs/html, and a `@solidjs/web#test-types` task with a tripwire for upstream `client.d.ts` re-exports of `VoidElements`/`RawTextElements`. Refresh both READMEs.
- 8b9c5bf: Bump dom-expressions, babel-plugin-jsx-dom-expressions, hyper-dom-expressions, and sld-dom-expressions to 0.50.0-next.4. Picks up the hyperscript callback-prop materialization fix (returning `h(Comp, …)` from a render-prop callback no longer re-mounts stable rows on parent updates) and the upstream `client.d.ts` re-exports of `VoidElements`/`RawTextElements`. Drops the local workarounds in `@solidjs/web` (explicit constants re-export and the `client.d.ts` skip in `types:copy-web`). Folds the For-row regression cases into `@solidjs/h`'s smoke suite as plain tests.
- 9015b12: `createContext<T>()` (default-less form) is now typed `Context<T>` (was `Context<T | undefined>`). `useContext` returns `T` directly and the runtime continues to throw `ContextNotFoundError` when no Provider is mounted (this was already the runtime behavior — only the type signature was lying).

  This eliminates the `useX`-with-throw wrapper hook idiom: `const useTodos = () => { const t = useContext(Ctx); if (!t) throw …; return t; }` becomes a plain `useContext(TodosContext)` call.

  The default form `createContext<T>(defaultValue)` is unchanged: `useContext` falls back to `defaultValue` outside any Provider. Reserved for primitive fallbacks (theme, locale, frozen config); for any context carrying reactive state, prefer the default-less form.

  **Breaking:** consumers that rely on `useContext(ctx)` returning `undefined` for a default-less context (and branch on that) will now see the throw at runtime and the type narrowing they were doing becomes a type error. Migration: pass an explicit default to `createContext`, or remove the now-redundant null check.

- c324d2c: Diagnostic messages now include their stable code identifier as a prefix (e.g. `[NO_OWNER_EFFECT] Effects created outside a reactive context will never be disposed`). Applied to all dev-mode diagnostics: `STRICT_READ_UNTRACKED`, `PENDING_ASYNC_UNTRACKED_READ`, `PENDING_ASYNC_FORBIDDEN_SCOPE`, `SIGNAL_WRITE_IN_OWNED_SCOPE`, `RUN_WITH_DISPOSED_OWNER`, `NO_OWNER_CLEANUP`, `CLEANUP_IN_FORBIDDEN_SCOPE`, `NO_OWNER_EFFECT`, `NO_OWNER_BOUNDARY`, `ASYNC_OUTSIDE_LOADING_BOUNDARY`, and `MISSING_EFFECT_FN`.

  The previously bare `throw new Error("Cannot create reactive primitives inside createTrackedEffect or owner-backed onSettled")` (raised when creating a memo, effect, or owner inside `createTrackedEffect`/`onSettled`) is now also surfaced through the diagnostic system as `PRIMITIVE_IN_FORBIDDEN_SCOPE` (severity `error`, dev-only, throws after emitting). Existing tests that match the message substring continue to work.

  The code identifier surfaces in console output and thrown errors, so users (and AI tools) can search documentation, issue trackers, and the source by code rather than parsing prose. The `code` field on `DiagnosticEvent` is unchanged — this only affects the human-readable `message` string.

- 4620612: Fix `createOptimisticStore` flicker on the second toggle of the same property when the action calls `refresh()` after `yield`. The stash branch's committed-view rerun was firing whenever the action queue was empty, even if the transition was still waiting on async reporters — causing render effects to briefly read the previous committed value before the new override. The rerun now also requires `_asyncReporters` to be empty, matching `transitionComplete`'s definition of idle.
- f7d5af6: Fix `<For keyed={false}>` (and `mapArray` with `keyed: false`) lagging by one update when its source is a store and a store property is mutated in-place. The mapArray internal owner now points its `_parentComputed` at the mapArray computed, so untracked store-proxy reads inside `updateKeyedMap` resolve to the pending value being written in the same flush rather than the stale committed value. Fixes #2687.
- c324d2c: `createEffect(compute)` (single-argument form) is now a hard error. Solid 2.0's `createEffect` requires a separate effect callback as its second argument: `createEffect(() => signal(), value => doWork(value))`.

  Two layers now surface the misuse:
  - **TypeScript** — a deprecated overload `createEffect(compute): never` is added so editors render the call with strikethrough and surface the migration message on hover.
  - **Runtime (dev)** — calling without an effect function now throws synchronously with a clear message and emits a new `MISSING_EFFECT_FN` diagnostic (replaces the previous opaque `TypeError: Cannot read properties of undefined`).

  If you want a derived value, use `createMemo`. If you want a one-shot side effect at construction time, just call the function directly.

- c324d2c: Tighten npm `description` fields across the published packages so they identify each package's role unambiguously in npm search results and AI-indexed package metadata.
  - `solid-js` — was generic ("A declarative JavaScript library for building user interfaces."); now names the actual differentiators (real DOM, signal-based updates, no virtual DOM).
  - `@solidjs/web` — names the concrete entry points (rendering, hydration, SSR, Portal, Dynamic).
  - `@solidjs/signals` — names the actual primitives (signals, memos, effects, stores, async-aware computations) instead of "reactive core implementation".
  - `@solidjs/h` — drops the self-deprecating "less-optimal" wording; states the use case (no compiled JSX).
  - `solid-html` — leads with the user-visible benefit (no build step).
  - `babel-preset-solid` — mentions what makes it Solid-specific (fine-grained DOM ops vs. generic JSX).

  `solid-element` and `@solidjs/universal` descriptions left unchanged.

- 3ee92f3: Fix mid-transition observability of mixed optimistic and entangled state. Subscribers recomputing under an optimistic lane that read a plain signal with a pending mid-transition write now see the signal's committed value (entangled), while optimistic overrides still project their optimistic value. Async drivers continue to read latest values for correct fetching. At commit, gated subscribers re-run with the new committed view.
- 0ef177e: Fixes #2686. Owned non-lazy memos no longer autodispose when their
  subscriber count momentarily drops to zero (e.g. during a transition swap,
  or when read only through `untrack` from a suspending render-effect). They
  now live for their owner's lifetime and retain their cached value, so an
  async `createMemo` read via `untrack` from a suspending consumer settles
  once and stays settled across re-runs.

  Lazy memos (`createMemo(fn, { lazy: true })`) and unowned memos retain the
  previous "compute-on-demand, dispose-when-not-needed" semantics, and the
  JSDoc on `lazy` now documents this contract.

  Internally this folds the per-node config booleans (`_ownedWrite`,
  `_noSnapshot`, `_transparent`, `_inSnapshotScope`, `_childrenForbidden`,
  `_preventAutoDisposal`) into a single `_config: number` bitfield with
  `CONFIG_*` constants, replacing `_preventAutoDisposal` (opt-out) with
  `CONFIG_AUTO_DISPOSE` (opt-in). Public node options are unchanged.

- 9015b12: Introduce `Refreshable<T>` as a public type alias for the `$REFRESH` brand applied to derived/projected stores. The return types of `createOptimisticStore`, `createProjection`, and the projection form of `createStore` now use `Refreshable<Store<T>>` instead of inlining `Store<T> & { [$REFRESH]: any }`.

  This fixes a TS4058 error in user-defined hooks that wrap these primitives — the inferred return type would previously reference the unique `$REFRESH` symbol from a deep import path, forcing consumers to write an explicit return annotation. `Refreshable` is re-exported from both `@solidjs/signals` and `solid-js` (client + server entries) so the inferred type is now nameable from any consumer.
  - @solidjs/signals@2.0.0-beta.9

## 2.0.0-beta.8

### Patch Changes

- 34c65b8: CSR: async reads without a `Loading` ancestor no longer throw. The root mount now participates in transitions — when uncaught async surfaces during initial render, the root DOM attach is withheld until all pending settles and then attaches atomically. On the no-async happy path, `render()` still attaches synchronously before returning (via an internal tail `flush()`).

  **New `schedule` option on effects**

  `@solidjs/signals` exposes a new `schedule?: boolean` option on `EffectOptions`. When `true`, the initial effect callback is enqueued through the effect queue (the same path user effects already take) instead of running synchronously at creation. This lets the initial run participate in transitions — if any source bails during the compute phase, the callback is held until the transition settles.

  ```ts
  createRenderEffect(
    () => source(),
    v => {
      /* runs after flush, deferred by any pending transition */
    },
    { schedule: true }
  );
  ```

  `@solidjs/web`'s `render()` uses this option internally for its top-level insert, which is what enables permissive top-level async in CSR.

  **Dev diagnostic**

  `ASYNC_OUTSIDE_LOADING_BOUNDARY` is now a non-halting `console.warn` (severity downgraded from `error` to `warn`). With deferred-mount the runtime is correct; the diagnostic is an informative FYI rather than a correctness failure. The warning only fires during the synchronous body of `render()` / `hydrate()` — post-mount transitions (including lazy route changes) run under their own transitions with the guard off and do not emit this warning.

  Placing a `Loading` boundary remains the right tool when you want explicit fallback UI or partial progressive mount.

  **Known limitation: multi-phase async**

  Multi-phase async flows — for example, a `lazy()` component whose resolved body reads a second pending async memo — may still reveal partial DOM between waves. This is because the scheduler currently nulls `activeTransition` before running the completing flush's restored queues; a new transition started by recomputes during that phase does not re-stash already-restored callbacks. Single-wave nested async (including static siblings alongside a pending descendant) commits atomically. The multi-phase case is tracked as a follow-up; the recommended workaround today is to place a `Loading` boundary around multi-phase async subtrees.

- ed2079f: Fix SSR `<Loading>` to handle a bare async memo passed directly as its child (e.g. `<Loading>{asyncValue()}</Loading>`). The boundary now catches the synchronous `NotReadyError` from the discovery pass, awaits the underlying source, and re-runs discovery — restoring parity with the client and allowing inner `<Errored>` boundaries to propagate async holes through outer `<Loading>` on the server (issue #2677).
- 2597a4a: Fix `createProjection` hydration from async iterables when no `Loading` boundary wraps the consumer (e.g. `Repeat` reading projection state directly).
  - `hydration.ts`: disable snapshot capture while applying the initial full value from the server iterable so `prepareStoreWrite` doesn't record the pre-write (empty) base as the snapshot. Without this, reads during hydration (like `Repeat` reading `length`) see the stale pre-value and fail to match the server-rendered DOM, producing unclaimed nodes and duplicated items.
  - `projection.ts`: eagerly assign the inner `computed` owner to the outer `node` binding on first run so `STORE_FIREWALL` lookups work during synchronous hydration writes (before `node = computed(...)` returns).

- 00c3f78: Fix `createProjection` streaming when no outer `Loading` boundary is present. Two related bugs were fixed, plus a small internal refactor:
  - The synchronous `reconcile` path in `createProjectionInternal` now goes through `storeSetter` so the `writeOnly` guard is engaged during reconcile reads. Previously it bypassed the guard, causing the projection's own reads (via its store's `_firewall`) to be tracked as dependencies, dirtying the projection mid-recompute and producing a runaway self-loop.
  - `recompute` now snapshots `_inFlight` before running the node's `_fn`. When `_fn` self-registers an async subscription (as `createProjection` does via an internal `handleAsync(owner, asyncIterable, setter)` call that returns `undefined` from the body), the outer `handleAsync(el, undefined)` would otherwise clear `_inFlight` and drop every subsequent yielded value. The snapshot lets `recompute` skip the outer `handleAsync` in that case and keep the internally-registered iteration alive, so projections stream all values (not just the first) regardless of whether a `Loading` boundary is present.
  - Internal: the projection recompute body (`draft + storeSetter + handleAsync + commit`) is now shared between `createProjection` and the derived form of `createOptimisticStore` via a `runProjectionComputed` helper. As a side-effect this routes optimistic projections' sync commit through `storeSetter` too, bringing them in line with the fix above.

- d46928f: fix: stores now batch like signals on cold writes

  Untracked reads of a store property after a `setStore` mutation now return the
  previous value until `flush()` (or the surrounding effect/transition) commits,
  matching `createSignal` semantics. The `in` operator batches the same way —
  after a cold add or delete, presence reflects the pre-write shape until commit.
  Previously both reads resolved synchronously against the override, which broke
  the "no reading uncommitted state" invariant for store properties that had
  never been observed.

  Internally we upsert a transient pending node for the property (and, on
  presence change, a matching `STORE_HAS` node) on cold writes, queue the new
  value as `_pendingValue`, and sweep nodes that never gain a subscriber when
  their pending write commits. Optimistic stores and projection writes are
  unaffected — they keep their immediate-visibility semantics.

- 000da61: Refactor `WidenPropValue` helper in `jsx-properties.d.ts` to split the nested conditional into a small named helper. Behavior-identical; removes a line that sat exactly at `printWidth: 100` so formatters running at the default width no longer fight the repo's prettier config.
- 2e4a924: Remove the `ssrSource: "initial"` mode and type derived `client` hydration reads as possibly undefined until hydration resumes.
- ac0067a: Replace `Reveal`'s boolean `together` prop with an `order` string union
  (`"sequential" | "together" | "natural"`) and add the new `"natural"` mode.
  - `order="sequential"` is the default and matches the previous default behavior.
  - `order="together"` replaces `<Reveal together>`; existing `together` props must be migrated to `order="together"`.
  - `order="natural"` is new. A nested `<Reveal order="natural">` group opts its own
    children out of the outer frontier (each child reveals as its own data resolves),
    while the group as a whole still acts as a single composite slot to the enclosing
    `<Reveal>`. This closes the gap where a nested subtree needed to respect its parent's
    broader ordering while returning to natural, independent reveal behavior internally.
  - `collapsed` is only consulted when `order="sequential"` (the default). It is
    silently ignored under `order="together"` or `order="natural"` — no type error,
    so dynamic `order` bindings don't need a discriminated-union workaround.
  - `RevealOrder` (the `"sequential" | "together" | "natural"` string union) is
    exported from `solid-js` for use in consumer code that types the prop directly.
  - `renderToString` now supports `order="natural"` out of the box (no streaming required).
  - `createRevealOrder` options changed from `{ together?, collapsed? }` to
    `{ order?, collapsed? }` with the same accessor shape.

  See `documentation/solid-2.0/03-control-flow.md` for the full outer/inner nesting
  matrix and SSR caveats.

- ac0067a: Fix nested `<Reveal>` coordination: a nested group is now held on its fallbacks
  until its parent releases the slot it occupies, in both the client runtime and
  SSR streaming. Previously, an inner `Reveal` inside an outer `order="together"`
  (or past the frontier of an outer `sequential` without `collapsed`) could reveal
  its own children independently, breaking the outer group's "reveal as one unit"
  guarantee.

  Key behavior changes:
  - `order="together"` now releases when every direct slot is "minimally ready"
    under its own order (a nested `sequential` is minimally ready at frontier-0,
    a nested `natural` when any child is ready, a nested `together` when all its
    children are ready) rather than waiting for every descendant to fully resolve.
    This keeps `together` composable without sacrificing the cohesive group reveal.
  - When an outer `sequential` advances to a nested `Reveal` as its frontier, or
    an outer `natural` surfaces a nested `Reveal` slot, the nested group is now
    released to run its own order locally. Previously the nested group inherited
    the outer's hold, which forced its children to reveal together once released;
    they now reveal per the nested group's own policy (e.g., inner `natural`
    children reveal independently as their data lands). This applies to both the
    client runtime and SSR streaming.
  - SSR fix: when an outer `sequential+collapsed` frontier advances to a nested
    `Reveal`, the inner group now emits `revealFallbacks` for its leaf children so
    their collapsed fallback templates become visible under the inner's own order.
    Previously the inner fallbacks remained hidden until they resolved. Requires a
    matching `dom-expressions` update: `$dflj(ids)` now materializes every id in
    the list instead of stopping at the first, so bulk uncollapse reveals all of
    its listed fallbacks in one call. Solid's `advanceFrontier` now passes the
    single new frontier key to `revealFallbacks` for sequential cascading, which
    preserves the prior incremental behavior.
  - Nested `<Reveal>` groups cannot opt out of an outer group's hold while it is
    still held. Wrapping a subtree in a `<Loading>` does not bypass this — the
    `<Loading>` is itself a slot the parent holds. Subtrees that need independent
    reveal should not be nested under an outer ordering.
  - On the server, HTML for resolved fragments still streams immediately into
    templates; only the `revealFragments` swap calls are stashed and drained in
    resolution order when the enclosing `Reveal` releases the slot.

  See `documentation/solid-2.0/03-control-flow.md` for the updated nesting matrix
  and the "minimally ready" definition per order.

- Updated dependencies [34c65b8]
  - @solidjs/signals@2.0.0-beta.8

## 2.0.0-beta.7

### Patch Changes

- e855fcb: Fix dual runtime package type resolution for CommonJS consumers.
- 76b11b2: Bump dom-expressions to next.22 with cascading root hole fix and jsx-properties type resolution
- 5869c94: Fix ASYNC_OUTSIDE_LOADING_BOUNDARY diagnostic firing even when a boundary handled the async
- 3242e50: Move loadModuleAssets to dom-expressions and consume via sharedConfig for lazy hydration without Loading boundary
- f18780e: Update `@solidjs/signals` to `0.13.12` to fix `Loading` boundaries mounted during async refresh so new fallbacks render instead of holding stale content.
- ea7f892: Fix ownerless conditional memo reads by reviving suspended unowned computeds on direct access, and align Repeat and Reveal compiler/runtime exports.
- beb419e: Move `@solidjs/signals` into the monorepo and wire local builds, tests, and releases to the workspace package.
- bd563d0: Remove the misleading initial value parameter from derived primitives and require explicit seed values for store-backed projection APIs.
- 5086c21: Rename `pureWrite` option to `ownedWrite` across signals and hydration to align with error messaging and documentation
- 8511fc1: Support async callbacks in createMemo and createProjection on the server by retrying when a NotReadyError-rejected promise is detected, instead of treating it as a terminal error
- Updated dependencies [5acf0ee]
  - @solidjs/signals@2.0.0-beta.7

## 2.0.0-beta.6

### Patch Changes

- 159d204: Add Reveal component SSR support with streaming fragment coordination, collapsed fallback mode, and nested composite slots
- df3f514: Align with dom-expressions: add MathML support to Dynamic/createElement, consolidate namespaces, remove deprecated isSvg/Properties/SVGNamespace
- 74ea248: Dev tooling 2.0 surface: remove registerGraph/sourceMap, consolidate devComponent metadata into single \_component object, wire DEV.hooks to @solidjs/signals hook registration (onOwner, onGraph, onUpdate, onStoreNodeUpdate), expose graph traversal helpers (getChildren, getSignals, getParent, getSources, getObservers) through DEV, export isDisposed
- 4a954e7: Fix server-side `createProjection` promise serialization to resolve with the projected state so hydration receives the correct value.
- 6a87fb2: Support Reveal collapsed mode in string (non-async) SSR by providing RevealGroupContext and collapsing non-frontier fallbacks server-side. Warn for nested Reveal in renderToString where client coordination is limited.

## 2.0.0-beta.5

### Patch Changes

- 03e2cca: Forward async iterator cancellation through hydration and SSR wrappers so generators close when hydration adapters or SSR serializers stop consuming them.
- 8ef7ece: **Loading hydration (client):** Serialized boundary refs that are already settled (`{ s: 1, v }`) still run one deferred `resumeBoundaryHydration` (with optional lazy-asset wait) so inner memos/projections match SSR; a per-boundary closure flag prevents double-scheduling—no global `WeakSet`/`Map`. Terminal serialized states `{ s: 1 }` and `{ s: 2 }` stay gather-only so a promise that later gets `p.s = 2` does not keep re-entering the pending branch and trapping the UI on the fallback. Standalone asset loading only runs when `!sharedConfig.has(id)` so it does not duplicate work when the boundary ref path handles assets. `gather` is optional for test hosts.
- 8db4de8: Treat Loading on as a value prop so keyed loading boundaries work with normal component usage.
- e6177b4: Fix streamed SSR `Loading` and `Errored` hydration so async memo rejections render the expected fallback and recover correctly after reset.
- 8ef7ece: Align server `createMemo` Promise handling with `@solidjs/signals`: pending promises now always attach `NotReadyError` regardless of initial value, so seeds like `[]` no longer skip Loading/async boundaries.
- 009d3de: Apply the remaining formatting updates for the streamed SSR hydration fixes and their regression coverage.
- 3bd00d2: Move `Loading` into the flow exports while keeping hydration-aware behavior in `createLoadingBoundary`.
- 3eed9c1: Refine server Loading and Errored settlement and update dom runtime dependencies.
- d037842: Tighten Show and Match JSX typings to reject ambiguous zero-argument function children.
- 6b4af47: Update to `@solidjs/signals` 0.13.8 and drop redundant hydrated async-iterable cleanup now handled by the signals core.

## 2.0.0-beta.4

### Patch Changes

- 681d6a5: Update the bundled `@solidjs/signals` baseline to `0.13.6` and fix boundary hydration so `ssrSource: "client"` children resume after hydration mode turns off.
- 2922dbb: Update the bundled `@solidjs/signals` baseline to pick up the recent beta bug fixes from #2628, #2631, #2633, #2634, #2635, #2636, #2619, #2637, #2638, and #2639, covering loading and error boundaries, pending state propagation, tracked effect semantics, `resolve()` behavior, and async generator projection and optimistic-store fixes.

## 2.0.0-beta.3

### Patch Changes

- 284738e: Re-export `enableExternalSource` and related types from `@solidjs/signals`. Add `on` prop to `<Loading>` component for declarative boundary reset.
- 5c961fa: Add regression test for #2620: createProjection + refresh with keyed For/Show tree rendering stale DOM nodes due to uncleared STATUS_PENDING flags (fix in @solidjs/signals)
- 284738e: Fix ssrSource "client" and "hybrid" mode hydration for projections and stores
  - "client" mode: use a `hydrated` signal gate so the user's function runs only after hydration completes, instead of returning an identity function that never transitions
  - "hybrid" mode: use a `hydrated` signal gate to load the server promise during hydration, then transition to the client's async generator post-hydration. A shallow shadow draft absorbs the first iteration's reads/writes (preventing first-value duplication) before switching to the real reactive store
  - Fix microtask timing in `hydrateStoreFromAsyncIterable` with a custom thenable so `process` and `asyncWrite` execute in the same microtask
  - Skip hydration wrapper for transparent memos (HMR support)

- 284738e: Rename `createLoadBoundary` to `createLoadingBoundary` for consistency with the `<Loading>` component naming.
- 26ea296: Suppress dev-mode "owned scope" warnings for internal hydration-gating signals by marking them as pureWrite, and bump @solidjs/signals to 0.13.3 which decouples snapshot exclusion from pureWrite via a new \_noSnapshot flag

## 2.0.0-beta.2

### Patch Changes

- 8187065: Add dev-mode error when async content is used in JSX without a `<Loading>` boundary during `render()`. In dev, the app is unmounted and an error message is rendered into the container. Re-export `setOnUnhandledAsync` hook from `@solidjs/signals`.
- 8187065: Refactor async iterable hydration to delegate to signals' handleAsync pipeline:
  - Replace imperative consumeFirstSync/scheduleIteratorConsumption with normalizeIterator that ensures V1 is sync for snapshot capture and V2+ are greedily batched after a single microtask deferral
  - createMemo, createProjection, and createStore(fn) hydration now return async iterables that handleAsync processes natively, eliminating manual flush/schedule management
  - Fix hybrid mode: processResult and createProjection .then() callbacks now return values so serialized promises resolve correctly
- 8187065: Fix SSR createSignal(fn) with async value showing undefined instead of triggering Loading boundary
- 8187065: Include `$REFRESH` in the return types of `createStore(fn)`, `createOptimisticStore(fn)`, and `createProjection` to match `@solidjs/signals` upstream types, and re-export `$REFRESH` from `solid-js`
- 8187065: Use untrack(fn, strictReadLabel) for strict-read warnings instead of separate setStrictRead API

## 2.0.0-beta.1

### Patch Changes

- dadeeeb: Add NoHydration/Hydration components, expose moduleUrl on lazy, fix mapArray hydration ID mismatch, update dependencies

  **NoHydration / Hydration components** — Moved from dom-expressions into solid-js using the owner-tree context API. `NoHydration` suppresses hydration keys and signal serialization for its children. `Hydration` re-enables hydration within a `NoHydration` zone with an `id` prop matching the client's `hydrate({ renderId })`. On the client, `NoHydration` skips rendering during hydration; `Hydration` is a passthrough. Lazy components inside `NoHydration` register CSS but not JS modules, enabling code-split islands without a compiler.

  **lazy().moduleUrl** — Exposed `moduleUrl` as a read-only property on lazy component wrappers (both client and server) to support Islands architectures and advanced asset discovery.

  **mapArray hydration ID fix** — Server-side `mapArray` was constructing owner IDs by decimal string concatenation (`"prefix" + 10 = "prefix10"`), while the client uses base-36 encoding (`"prefixa"`). Refactored to use parent/child `createOwner()` pattern matching the client, ensuring ID parity for lists with 10+ items.

  **Dependency updates** — `@solidjs/signals` ^0.11.3 (fixes strictRead in computations), `dom-expressions` 0.41.0-next.11 (resolveAssets base path prefixing, removed NoHydration/Hydration stubs), `babel-plugin-jsx-dom-expressions` 0.41.0-next.11 (SSR conditional memo alignment).

  **Test fixes** — Updated strict read warning message assertion, fixed SSR streaming test manifests to use relative paths (matching real Vite output), removed stale TODO, added comprehensive test suites for NoHydration/Hydration, mapArray base-36 IDs, ternary conditional ID parity, and Show fallback hydration toggling.

## 2.0.0-beta.0

### Major Changes

- c3e5e78: Async everywhere
- 2645436: Update to R3 based signals
- a4c833d: Update to new package layout, signals implementation, compiler

### Minor Changes

- Move pre-release tag from experimental to beta
- 75eebc2: feat: snapshot-based boundary-local hydration safety (Goal 4)

  Signal writes during hydration are now safe by construction. Each Loading boundary gets its own snapshot scope — computations created during hydration read snapshot values (matching server DOM) while writes update only the current value. After a boundary's sync hydration walk completes, its snapshot scope is released and stale computations rerun with current values.

  Key changes:
  - Add markTopLevelSnapshotScope/releaseSnapshotScope plumbing to all hydrated primitives
  - Extract createBoundaryTrigger() helper for internal trigger signals excluded from snapshot capture
  - Add resumeBoundaryHydration() with isDisposed guard, per-boundary scope management, and flush
  - Add onCleanup for cleanupFragment to handle orphaned streaming content on navigation
  - Remove deferHydration option (no longer needed with snapshots)
  - Remove isHydrating/onHydrationEnd from public API (snapshots make hydration timing transparent)
  - Update @solidjs/signals to ^0.10.7, dom-expressions to 0.41.0-next.6

- 75eebc2: feat(ssr): implement ssrSource, async iterable streaming, and client hydration (Goal 2d)

  Adds the ssrSource option (4 modes: "server", "hybrid", "initial", "client") controlling how computations serialize and hydrate. Server-side async iterable streaming via processResult tap wrapper with patch-based projection serialization. Client-side async iterable hydration with synchronous first-value consumption from seroval and scheduleIteratorConsumption for remaining values. Includes isHydrating/onHydrationEnd lifecycle APIs, deferHydration option, and subFetch updates for generator dependency capture.

### Patch Changes

- 512fd5e: update signals to 0.3.0
- dea16f3: Add client hydration support with tree-shakeable createMemo/createSignal wrappers, fix SSR context isolation for concurrent requests, align seroval serialization format, update @solidjs/signals to ^0.10.2
- 15dc3c6: return of useTransition, small API tweaks
- 874c256: fix input compilation, rebased dom-expressions
- 4cab248: Fix Dynamic component hydration key misalignment by aligning server-side createDynamic owner tree with client
- 1122d74: Fix server-side flow component hydration key alignment for Show, Errored, and Repeat
- c78ec9f: Bump dom-expressions to 0.41.0-next.9 to fix SSR spread element hydration mismatch. Dynamic children of spread elements were incorrectly wrapped in memo() on the server, consuming extra owner slots and causing \_hk value misalignment with the client.
- 9788bad: Harden SSR async error handling: add try/catch to Loading's async IIFE, serialize errors in createErrorBoundary for client hydration, and fix unhandled promise rejections in processResult
- 21fff6f: Make insert render effects transparent and align SSR owner tree to fix hydration ID mismatches
- 60f2922: Add hydration-aware wrappers for createErrorBoundary, createOptimistic, createProjection, createStore(fn), and createOptimisticStore(fn). Server-side createProjection now creates owner for ID alignment and handles async Promise returns. Bump @solidjs/signals to 0.10.4 for peekNextChildId support.
- 433eae5: Make `children` helper lazy to prevent hydration mismatches when resolved children are never inserted into the DOM. Export `storePath` and related types (`StorePathRange`, `ArrayFilterFn`, `CustomPartial`, `Part`, `PathSetter`) from both client and server builds. Bump `@solidjs/signals` to 0.11.1.
- b1646a5: update signals
- e8d8403: add action helper
- 1a1a5d4: add `from` to repeat
- 5f29f14: Update signals, dom expressions to default attrs
- 85aa54f: Refactor SSR stream blocking: delegate deferStream blocking to dom-expressions via serialize instead of imperative ctx.block() calls in processResult. Pass deferStream option through createSignal(fn), createMemo, and createProjection to serialize. Update dom-expressions to 0.41.0-next.3 for structural blocking support.
- 433eae5: Rename `pending` API to `latest`. `isPending(() => latest(value))` reads more naturally than the redundant `isPending(() => pending(value))`. Also renames internal `pendingReadActive`, `_pendingValueComputed`, and `getPendingValueComputed` in @solidjs/signals to align with the new name.
- c74106f: fix multi insert/removal, ssr wip, async signal render
- f4b0956: fix(ssr): lock server-side comp.value to first async iterable value

  During SSR, async-iterable-backed computations (createMemo, createProjection) now lock their readable value to the first yield. Subsequent iterations still stream to the client via seroval, but SSR reads always return V1. This prevents hydration mismatches when Loading boundaries retry after the iterator has advanced.

  For projections, the SSR-visible store state is deep-cloned at first value resolution, isolating it from subsequent generator mutations (including nested object changes).

- 3e3c875: remove runWithObserver, add back createReaction, createTrackedEffect
- 568ed6f: Add ssrSource support for createEffect and createRenderEffect; fix server createEffect to run compute function
- d1e6e29: Add dev-mode warning for untracked reactive reads in component bodies and control flow callbacks. Signals, memos, and store properties read outside a reactive scope now emit a console warning with the component or flow control name. Integrated into devComponent, Show, Match, For, and Repeat. Zero production overhead.
- 84c80f9: Make devComponent use transparent owner so dev-mode IDs match production for hydration parity. Bump @solidjs/signals to 0.10.3 for transparent owner support.
- 381d895: update signals to store/projections with returns
- fbbd7e3: Update dependencies (signals 0.10.5, dom-expressions 0.41.0-next.5) and fix build compatibility with Turbo 2.x and TypeScript 5.9
- 53dcb14: expose new transition methods
- dea16f3: Add server-side rendering implementation: pull-based server signals, streaming Loading component, SSR-aware flow controls, and hydration context infrastructure

## 1.9.12

### Patch Changes

- 51b0797: fix: prevent createDeferred from keeping Node.js process alive
- 6b0c4ee: fix: lazily create inTransition external source to prevent use-after-dispose
- 51cce75: Set committed value for computations created during transition
- c58983d: fix SSR output including `bool:` attribute serialization and escaping for logical and child expressions

## 1.9.11

### Patch Changes

- 6628d9f: Update dom-expressions/seroval to latest

## 1.9.10

### Patch Changes

- 2270ae9: Fix: Collision during SSR in createResource due to `loading` property.
- 94d87f1: Update `build:clean` and `types:clean` script to include missing paths
- 3114302: Improve `splitProps` performance
- 6c92555: Update dom-expressions, seroval plugins, optional chaining ref, style optimization

## 1.9.9

### Patch Changes

- f59ee48: fix dynamic overtracking
- 62c5a98: Update `SuspenseList` to handle hydration context
- 62c5a98: Add unit tests for `resolveSSRNode` and `createResource` functions
- c07887c: fix #2524 closedby types, fix regression inlining style/classList

## 1.9.8

### Patch Changes

- 09a9c1d: Export RendererOptions and Renderer types from solid-js/universal
- 472c007: fix(scheduler): adjust yield timing logic to improve task scheduling …
- 3d3207d: fix #2491 no key on merge false
- 2cd810f: compiler and jsx type updates
  - fix: ssr style undefined
  - fix: ssr double escaped array
  - fix: skip jsxImportSource skipping transform
  - fix: @once on style, classlist
  - JSX type updates
  - Update Universal Renderer Types
- cbff564: feat: createMutable support for class inheritance
- e056eab: add support for `is` in `Dynamic`, closes #2413
- bdba4dc: Fix resource instances always getting cached on SSR
- Updated dependencies [2cd810f]
  - babel-preset-solid@1.9.8

## 1.9.7

### Patch Changes

- 84ca952: Fix hydration issues caused by seroval update.
- 4cd7eb1: Catch synchronous errors in `createResource`.

## 1.9.6

### Patch Changes

- 362e99f: fix #2444 prev value in memo messing with reactive rendering
- 8356213: update compiler config, fix boolean attribute regression, update JSX types
- c65faec: fix #2428 - owner always present in resource fetcher
- 6380b01: fix #2399: novalidate, #2460 spellcheck types

## 1.9.5

### Patch Changes

- 86ae8a9: add optional initalValue argument to `from` helper
- 89e016d: dev: Add `internal` flag to signal
- 9431b88: Mirror createDynamic for SSR
- 35266c1: JSX type updates, preliminary MathML support, fix spread overescaping
- 0eab77d: Removed unnecessary evaluations of <Show> and <Match> conditions.
- fff8aed: Update typescript to 5.7
- f9ef621: dev: Add afterRegisterGraph hook replacing afterCreateSignal

## 1.9.4

### Patch Changes

- b93956f: fix escaping in resolution done outside of DOM Expressions
- 199dd69: fix reconcile null guard
- 7f9cd3d: lazy image, tagged template detection, security fixes
- 32aa744: Improve resolving arguments in createResource

## 1.9.3

### Patch Changes

- bb6ce8b: Reordering setter overloads
- 9b70a15: validation fixes, type updates, ssr attribute fix

## 1.9.2

### Patch Changes

- 22aff14: update validation: smaller lib, opt out, better table handling
  add `on:` event types for native events
- e2e2a03: Fix setter type compatibility with kobalte select and add tests

## 1.9.1

### Patch Changes

- fb67b687: fix anchor host interfering with event delegation
- 7ecf92d3: fix #2304 component props can be string, explicit imports in tests

## 1.9.0

### Minor Changes

- 4f8597dc: better handling of exports client/server
- 120bf06d: fix!: Remove browser field from package.json
- 2a3a1980: update dom-expressions
  - Improved Custom Element/Shadow DOM traversal - @olivercoad
  - Better heuristic to determine when to importNode - @titoBouzout
  - handleEvent syntax to allow custom event properties when not delegated - @titoBouzout
  - support for bool: attribute namespace - @titoBouzout
  - add "is" as detection for custom element - @titoBouzout
  - fix missing exports in different envs - @trusktr
  - better hydration mismatch errors - @ryansolid
  - improved HTML validation of JSX partials - @titoBouzout

### Patch Changes

- 80b09589: Improve signal setter type for code completion of string literal unions.
- 51bec61a: update TS to NodeNext

## 1.8.23

### Patch Changes

- bc20a4ce: update types, fix hydration cancel timing error, sync ssr script appending
- 9697c94b: jsdoc: Fix incorrect links of reactive utility `on`
- 9e192d7e: fix #2282: Add Check for Proxy support
- 379293d9: use correct hydration id in server lazy
- 73c00927: Fix missing code block end in `useTransition`'s jsdoc comment
- e4b2c668: fix missing disposal of nested transition nodes
- 94929afa: fix wrapping of object with `null` prototype

## 1.8.22

### Patch Changes

- f8ae663c: Fix broken links in Readme
- 19d0295f: fix stranded effects during hydration cancelation
- 26128ec0: fix #2259 attr: in ssr, updates some types

## 1.8.21

### Patch Changes

- a036a63a: shortcut hydrate call when hydration is done

## 1.8.20

### Patch Changes

- c8fe58e9: fix #2250 hydration error, fix lazy component loading, better hydration cancelation
- 80dd2769: fix #2236 improper shortcircuit in resource hydration

## 1.8.19

### Patch Changes

- 3fc015c2: track length in array helpers, fix mobx external source
- f909c1c1: fix #2228 - chained resources with initial values
- 816a5c61: fix #2209 processing parent before child value binding in select
- 424a31a3: optimize hydration keys

## 1.8.18

### Patch Changes

- 6693b56f: update TS, custom elements, and a lot compiler fixes
  fixes #2144, #2145, #2178, #2192
- a8c2a8f3: remove weird server resource hack, fix hydrated resource state

## 1.8.17

### Patch Changes

- 72c5381d: fix #2134, merge dom expressions fix #2136, fix #2137, fix #2110
- e065e475: fix #2135 ssr of top level fragments under Suspense

## 1.8.16

### Patch Changes

- 8de75a47: fix #2065 forward initial value to `on`
- 071cd42f: fix #2100, fix #2102 - hydration errors due to over optimization
- 3212f74d: Adjust some JSDocs

## 1.8.15

### Patch Changes

- 829af663: fix #2047 early interaction/multiple resources
- 4ee461dc: improve template escaping, fragment hydration, SVG use types

## 1.8.14

### Patch Changes

- 4b76be80: fix storage export in top-level package.json

## 1.8.13

### Patch Changes

- 3ac8210c: fix storage export

## 1.8.12

### Patch Changes

- aba5de08: fix #1746 class properties not working getters in createMutable
- 85b26c36: fix #2041, fix #2043 - async renderer timing, numeric prop literals

## 1.8.11

### Patch Changes

- 1ec67f15: fix #2028, fix #2029 revert spread value bypass, and guard multi-text

## 1.8.10

### Patch Changes

- 169d23b4: fix disposal timing when streaming

## 1.8.9

### Patch Changes

- 80d4830f: fix #2016 value spread, smaller build output
- 918586fb: fix #2017 object replacing array in `reconcile`
- 71bea784: fix #1971 order of merged properties
- b0862d39: fix #2014 html not replaced when resource resolves next `tick`
- cbc8d3ee: remove seroval plugins from build output

## 1.8.8

### Patch Changes

- 40b5d78d: chore(types): return mapped type for splitProps excluded `other` value
- 968e2cc9: update seroval, fix #1972, fix #1980, fix #2002, support partial ALS
- 292aba41: fix #1982 ErrorBoundary with ExternalSource
- 7e5667ab: fix #1998 Switch relying on order
- 8d2de12f: fix #1850 untrack in external source
- b887587a: fix #1973 array over object reconcile

## 1.8.7

### Patch Changes

- 22667bbc: fix: createSignal not found when bundled
- e09a3cc3: fix timing issue with deferStream

## 1.8.6

### Patch Changes

- 2b320376: Add types directory export for each package
- fb7f4bc1: fix #1950 leaking error tracking
- b092368c: feat(DEV): Add afterCreateSignal hook to DevHooks
- 54e1aecf: update seroval, fix this, optimize star imports, fix #1952 hydration race condition

## 1.8.5

### Patch Changes

- 80ca972f: fix `onHydrate` call being skipped

## 1.8.4

### Patch Changes

- cf0542a4: fix #1927, fix #1929, fix #1931, update storage API
- 3f3a3396: serialization error handling, experimental async storage

## 1.8.3

### Patch Changes

- 1f0226e1: fix #1917 for real this time

## 1.8.2

### Patch Changes

- b632dfd5: Add missing `indexArray` to server-side runtime.
- dd492c5e: fix #1917, fix #1918 error handling with serialization
- 4968fe26: Add `.js` extension to import

## 1.8.1

### Patch Changes

- 0b9b71aa: better errors for hydration

## 1.8.0

### Minor Changes

- 2c087cbb: update to seroval streaming serializer, change ssr markers
- 2c087cbb: hydration perf improvement, fix #1849

### Patch Changes

- 2c087cbb: remove attribute quotes in template, batch serialization
- 2c087cbb: improved serialization/guards, fix #1413, fix #1796 hydration with lazy
- 2c087cbb: fix: missing `has` property in `SharedConfig`
- 2c087cbb: fix #1905, fix #1908 JSX type ommissions

## 1.8.0-beta.2

### Minor Changes

- e3a97d28: hydration perf improvement, fix #1849

### Patch Changes

- d797a143: fix #1905, fix #1908 JSX type ommissions

## 1.8.0-beta.1

### Patch Changes

- f6d511db: remove attribute quotes in template, batch serialization
- af625dd3: fix: missing `has` property in `SharedConfig`

## 1.8.0-beta.0

### Minor Changes

- d8e0e8e8: update to seroval streaming serializer, change ssr markers

### Patch Changes

- bf09b838: improved serialization/guards, fix #1413, fix #1796 hydration with lazy

## 1.7.12

### Patch Changes

- 12eb1552: fix #1875 - mergeProps not handling undefined on SSR
- 13b1fa6e: fix #1883 initialize createDeferred with transition value
- 10ac07af: update jsx types, iife compiler optimization
- 8b49110b: Allow passing defer:boolean to `on`

## 1.7.11

### Patch Changes

- 26740b88: fix #1848 Suspense Default Context Non-Null

## 1.7.10

### Patch Changes

- 5ed448ae: Export `ContextProviderComponent`, `ResolvedChildren` and `ResolvedJSXElement` types
- 7dd1f413: fix .pipeTo signature to return promise
- c2008f02: Fix underscore property
- 792e7dea: fix #1821 improve context performance

## 1.7.9

### Patch Changes

- 44a2bf0b: fix #1814 incorrect typing embedding for h and html
- 6cd10c73: Changes how the Setter type was declared without actually functionally changing it, fixing the Setter type being assignable to any other Setter type; fixes #1818.

  Generically typed Setters must now non-null assert their parameter, i.e.

  ```diff
  function myCustomSignal<T>(v: T) {
    const [get, set] = createSignal<T>();
  -   const mySetter: Setter<T | undefined> = (v?) => set(v);
  +   const mySetter: Setter<T | undefined> = (v?) => set(v!);

    const [get, set] = createSignal<T>(v);
  -   const mySetter: Setter<T> = (v?) => set(v);
  +   const mySetter: Setter<T> = (v?) => set(v!);
  }
  ```

- 6c9879c9: fix in introspection in stores
- 039cf60d: update universal runtime readme
- 852f4c76: add missing link jsx types

## 1.7.8

### Patch Changes

- efd23186: fix #1780 invalid HTML comments
- 51074fab: remove optional chaining, reduce bundle size
- fe6f03f9: fix #1795 early effects running during async hydration

## 1.7.7

### Patch Changes

- c4cbfd3c: fix(Portal): reactive in children when pass signal directly
- 0100bd12: Propagate errors to parents when throwing errors in nested catchError
- 46e5e787: Improve type inference of `createSelector`.
- 8ba0e80a: Fix `mergeProps`.
- e660e5a3: add prettier code format in git-commit-hook
- 93d44d45: fix #1787 missing CJS types

## 1.7.6

### Patch Changes

- 83c99d51: fix #1739 resolved state of disabled resources
- f99dd044: Solid-Element: Add clarification on 'props' parameter in customElement function
- 88493691: apply reference optimization to mergeProps
- 514ef679: test: add tests to `splitProps`
- 20261537: fix #1735 web component instantiation before constructor
- 194f93c7: Improve performance in `splitProps` and `mergeProps`

## 1.7.5

### Patch Changes

- 5288cfa8: fix #1713, fix non-option jsx types
- 8852c199: test: add tests to `splitProps` and `mergeProps`

## 1.7.4

### Patch Changes

- 1b5ea076: perf: avoid unnecessary flat
- 91110701: fix element/test mismatch issues #1684, #1697, #1707
  fix solid-ssr types
  add missing JSX types #1690
  fix firefox iframe #1688

## 1.7.3

### Patch Changes

- 655f0b7e: fix attr in ssr spread, fix static undefined classList values, fix #1666 directives in TTLs
- 8ce2c47b: Portal fixes #1676, #1677

## 1.7.2

### Patch Changes

- 27994dc9: Another attempt at fixing skypack
- dfec6883: fix #1668 proto methods on store data nodes

## 1.7.1

### Patch Changes

- ba024813: fix ref timing in portals

## 1.7.0

### Minor Changes

- 503b6328: Add type narrowing non-keyed control flow
- 86c32279: always cast to errors when handled
- f7dc355f: Remove FunctionElement from JSX.Element types
- 940e5745: change to seroval serializer, better ssr fragment fixes
- 608b3c3a: Add catchError/deprecate onError
- 2b80f706: Reduce DOM compiler output size
  Remove auxilary closing tags and lazy evaluate templates
- 8d0877e4: fix #1562 cleanup order
- 74f00e15: Support prop/attr directives in spreads, apply prop aliases only to specific elements

### Patch Changes

- 6b77d9ed: Better types on function callback control flow
- 41ca6522: fixes around templates and hydration
- 840933b8: fix #1653 portal bypasses Suspense
- cb6a383d: ensure narrowed values are non-null
- 3de9432c: Better Input Event Types, Template Pruning, Universal Renderer Fixes
- 2cb6f3d6: fix treeshaking in rollup 3
- 24469762: Add a reference to the component funciton to DevComponent owner.
  Rename DevComponent's property from `componentName` to `name`.
- 5545d3ee: Type narrowed flow on the server, add stale warning
- 0dc8e365: Make non-null control flow assertion stricter by throwing
- 4929530b: Remove name generation of owners and signals
- 71c40af6: DEV: Minor additions and change the API of dev hooks
- 6a4fe46c: fix #1553 improper html entity encoding in literal expressions
- 5d671b89: Fix external source tests
- 23c157ac: fix backward compatibility of template, fix #1639 loading on iframe

## 1.7.0-beta.5

### Patch Changes

- 0dc8e365: Make non-null control flow assertion stricter by throwing

## 1.7.0-beta.4

### Patch Changes

- cb6a383d: ensure narrowed values are non-null
- 3de9432c: Better Input Event Types, Template Pruning, Universal Renderer Fixes
- 2cb6f3d6: fix treeshaking in rollup 3
- 23c157ac: fix backward compatibility of template, fix #1639 loading on iframe

## 1.7.0-beta.3

### Patch Changes

- 41ca6522: fixes around templates and hydration

## 1.7.0-beta.2

### Minor Changes

- 940e5745: change to seroval serializer, better ssr fragment fixes

## 1.7.0-beta.1

### Minor Changes

- 608b3c3a: Add catchError/deprecate onError
- 2b80f706: Reduce DOM compiler output size
  Remove auxilary closing tags and lazy evaluate templates
- 8d0877e4: fix #1562 cleanup order
- 74f00e15: Support prop/attr directives in spreads, apply prop aliases only to specific elements

### Patch Changes

- 6b77d9ed: Better types on function callback control flow
- 24469762: Add a reference to the component funciton to DevComponent owner.
  Rename DevComponent's property from `componentName` to `name`.
- 5545d3ee: Type narrowed flow on the server, add stale warning

## 1.7.0-beta.0

### Minor Changes

- 503b632: Add type narrowing non-keyed control flow
- 86c3227: always cast to errors when handled
- f7dc355: Remove FunctionElement from JSX.Element types

### Patch Changes

- 4929530: Remove name generation of owners and signals
- 71c40af: DEV: Minor additions and change the API of dev hooks
- e245736: Fixed test case for setStore 7 parameter overload by fixing KeyOf giving number for KeyOf<never>
- 6a4fe46: fix #1553 improper html entity encoding in literal expressions

## 1.6.16

### Patch Changes

- d10da016: Fix #1651 hydration markers introduced too early
- 620c7636: Switch test runner from Jest to Vitest

## 1.6.15

### Patch Changes

- e8448ebd: fix #1624 early fallback removal, add missing svg pathLength type
- da83ebda: defer ssr cleanup to next macrotask

## 1.6.14

### Patch Changes

- 6cceab2f: fix #1613 broken renderToString

## 1.6.13

### Patch Changes

- af20f00b: fix #1602 wrong resource state during SSR
- 60f8624d: fix #1596 ssr fragment text merge, fix #1599 ssr onCleanup

## 1.6.12

### Patch Changes

- e2888c77: Correct the type of `isServer` const to `boolean` from `false`.
- 676ed331: docs: fix typos
- b8a3ff13: fix #1586 error boundary called twice
- 1aff80c6: fix #1573 top level reconcile not merging
- 53db3f0f: fix fallback hydration
- 47d574a8: fix #1588: dynamic mount elements in Portals without recreation
- e245736f: Fixed test case for setStore 7 parameter overload by fixing KeyOf giving number for KeyOf<never>
- 61d1fe25: Export `isDev` const from solid-js/web for differentiating between dev/prod env.
- 4fdec4f9: fix #1564, fix #1567 template literal bugs

## 1.6.11

### Patch Changes

- bfbd002: Fixed the store setter's recursive fallback overload not terminating with non-numbers
- 1ecdea4: chore: export package.json
- 91d518a: fix: createResource should not ignores empty string throw
- 18e734d: Support null for detachedOwner in createRoot
- 12d458d: fix #1547, missing SVGPattern type
- 4aaa94b: Fix: swap KeyOf for MutableKeyOf in one of the SetStoreFunction overload
- c26f933: Add fast track for `untrack` in case of `null` listener
- 6fb3cd8: fix #1541: process errors at the end of synchronous execution
- c5b208c: fix #1522, errors stop future effects from running

## 1.6.10

### Patch Changes

- 1b32e63: Fix broken comments description link to solid docs
- dd879da: fix #1493 export DynamicProps
- d89e791: Add generic to onCleanup
- 695d99b: Export `EffectOptions` and `OnOptions` from main module
- d35a1ca: Fixed the return type of the `Symbol.observable` method of the `observable` in the generated `.d.ts`
- 7ab43a4: fix #1492 SSR Spread Breaks Hydration
  fix #1495 runWithOwner not clearing listener
  fix #1498 unrecoverable error in async batch

## 1.6.9

### Patch Changes

- a572c12: Streaming without a wrapper and compile time JSX validation
- 0ad9859: fix #1478 error infinite loop
- 12629a3: DEV: registerGraph `graph` property added to values

## 1.6.8

### Patch Changes

- 6db2d89: Fix #1461 - streaming broken due to reusing same resources for lazy dedupe

## 1.6.7

### Patch Changes

- c4ac14c: Format/Cleanup Types and code style
- 1384496: Fix unowned roots having owner in dev
- 1dbd5a9: stub out render and hydrate on server
- 368e508: make splitProps with dynamic source return proxies
- 54f3068: fix #1452 runWithOwner responsible for errors in its scope
- c8edacd: Fix lazy defined in components during SSR
- 89baf12: fix boolean escaping, improve ssr performance

## 1.6.6

### Patch Changes

- a603850: Export SignalOptions
- 2119211: fix #1423 - inlined arrow functions in SSR and update rollup
- 5a5a72d: Fix #1436 incorrectly missing proxy detection
- 5eb575a: fix: delete lazy contexts one by one as they are completed

## 1.6.5

### Patch Changes

- 50d1304: fix #1416 nulls in array reconcile
- ee71b16: fix #1410 - node 14 compatibility. Remove `||=` operator that isn't available on some legacy platforms.

## 1.6.4

### Patch Changes

- a42a5f6: memoize merging functions

## 1.6.3

### Patch Changes

- e95e95f: Bug fixes and testing changelog
