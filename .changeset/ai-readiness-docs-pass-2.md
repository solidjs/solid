---
"solid-js": patch
---

AI-readiness docs/JSDoc pass — continued from the initial pass shipped earlier on this branch. Targets the failure modes surfaced while authoring the kitchen-sink TodoMVC example.

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
