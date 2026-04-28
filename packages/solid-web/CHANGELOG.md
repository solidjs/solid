# @solidjs/web

## 2.0.0-beta.9

### Patch Changes

- d8d8c95: Reshape `createDynamic` into a `dynamic` factory.

  `createDynamic(source, props): JSX.Element` is replaced by `dynamic(source): Component<P>` — a `lazy`-style factory returning a stable component whose identity is driven by a reactive (and optionally async) source. `source` may return `null | undefined | false` to render nothing, so `() => cond() && Comp` works directly.

  ```tsx
  const Active = dynamic(() => (isEditing() ? Editor : Viewer));
  return <Active value={value()} />;
  ```

  The `<Dynamic component={...}>` JSX wrapper is unchanged at the call site; it now delegates to `dynamic` internally. Direct callers of `createDynamic(source, props)` should use `<Dynamic>` or `createComponent(dynamic(source), props)`.

- d31b3c6: Simplify `render` wrappers and give custom universal renderers deferred top-level mount.

  `@solidjs/web`'s `render()` is now a thin wrapper around `dom-expressions`' `render` — it threads `{ insertOptions: { schedule: true } }` through the new `insertOptions` seam (added in `dom-expressions@0.50.0-next.2`), scopes the `ASYNC_OUTSIDE_LOADING_BOUNDARY` dev window, and tail-flushes the queue. No behavioral change for end users; the local `createRoot` / `flatten` / `insert` plumbing that was inlined in the previous commit has moved back into `dom-expressions`.

  `@solidjs/universal` is no longer a pure re-export of `dom-expressions/src/universal.js`. It wraps `createRenderer` so the returned `render(code, element)` does `createRoot` + `insert(..., { schedule: true })` + tail `flush()`. Every custom universal renderer now inherits the same permissive top-level async semantics as `@solidjs/web`, without having to rewrite its own `render`.

- Updated dependencies [9015b12]
- Updated dependencies [fb2e43b]
- Updated dependencies [845b6bb]
- Updated dependencies [23f7550]
- Updated dependencies [8b9c5bf]
- Updated dependencies [9015b12]
- Updated dependencies [c324d2c]
- Updated dependencies [4620612]
- Updated dependencies [f7d5af6]
- Updated dependencies [c324d2c]
- Updated dependencies [c324d2c]
- Updated dependencies [3ee92f3]
- Updated dependencies [0ef177e]
- Updated dependencies [9015b12]
  - solid-js@2.0.0-beta.9

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

- Updated dependencies [34c65b8]
- Updated dependencies [ed2079f]
- Updated dependencies [2597a4a]
- Updated dependencies [00c3f78]
- Updated dependencies [d46928f]
- Updated dependencies [000da61]
- Updated dependencies [2e4a924]
- Updated dependencies [ac0067a]
- Updated dependencies [ac0067a]
  - solid-js@2.0.0-beta.8
  - @solidjs/signals@2.0.0-beta.8

## 2.0.0-beta.7

### Patch Changes

- Updated dependencies [76b11b2]
- Updated dependencies [5869c94]
- Updated dependencies [3242e50]
- Updated dependencies [f18780e]
- Updated dependencies [ea7f892]
- Updated dependencies [5acf0ee]
- Updated dependencies [beb419e]
- Updated dependencies [bd563d0]
- Updated dependencies [e855fcb]
- Updated dependencies [5086c21]
- Updated dependencies [8511fc1]
  - solid-js@2.0.0-beta.7
  - @solidjs/signals@2.0.0-beta.7

## 2.0.0-beta.6

### Patch Changes

- Updated dependencies [df3f514]
- Updated dependencies [74ea248]
- Updated dependencies [4a954e7]
- Updated dependencies [159d204]
- Updated dependencies [6a87fb2]
  - solid-js@2.0.0-beta.6

## 2.0.0-beta.5

### Patch Changes

- Updated dependencies [03e2cca]
- Updated dependencies [8ef7ece]
- Updated dependencies [8db4de8]
- Updated dependencies [e6177b4]
- Updated dependencies [8ef7ece]
- Updated dependencies [009d3de]
- Updated dependencies [3bd00d2]
- Updated dependencies [3eed9c1]
- Updated dependencies [d037842]
- Updated dependencies [6b4af47]
  - solid-js@2.0.0-beta.5

## 2.0.0-beta.4

### Patch Changes

- 2922dbb: Add regression coverage for SSR Show hydration placement so Show content hydrates before its following sibling once the dom-expressions runtime fix is published.
- 8d3e093: Update the bundled `dom-expressions`, `hyper-dom-expressions`, and `lit-dom-expressions` baseline to pick up the spread children caching fix, and add regression coverage for intrinsic spread children and `Dynamic component="div"` granularity.
- Updated dependencies [681d6a5]
- Updated dependencies [2922dbb]
  - solid-js@2.0.0-beta.4

## 2.0.0-beta.3

### Patch Changes

- Updated dependencies [284738e]
- Updated dependencies [5c961fa]
- Updated dependencies [284738e]
- Updated dependencies [284738e]
- Updated dependencies [26ea296]
  - solid-js@2.0.0-beta.3

## 2.0.0-beta.2

### Patch Changes

- 8187065: Fix unnecessary sibling re-rendering when Show/conditional children update by wrapping insert accessor in a transparent memo, with reactive accessor detection to skip redundant memoization
- Updated dependencies [8187065]
- Updated dependencies [8187065]
- Updated dependencies [8187065]
- Updated dependencies [8187065]
- Updated dependencies [8187065]
  - solid-js@2.0.0-beta.2

## 2.0.0-beta.1

### Patch Changes

- dadeeeb: Add NoHydration/Hydration components, expose moduleUrl on lazy, fix mapArray hydration ID mismatch, update dependencies

  **NoHydration / Hydration components** — Moved from dom-expressions into solid-js using the owner-tree context API. `NoHydration` suppresses hydration keys and signal serialization for its children. `Hydration` re-enables hydration within a `NoHydration` zone with an `id` prop matching the client's `hydrate({ renderId })`. On the client, `NoHydration` skips rendering during hydration; `Hydration` is a passthrough. Lazy components inside `NoHydration` register CSS but not JS modules, enabling code-split islands without a compiler.

  **lazy().moduleUrl** — Exposed `moduleUrl` as a read-only property on lazy component wrappers (both client and server) to support Islands architectures and advanced asset discovery.

  **mapArray hydration ID fix** — Server-side `mapArray` was constructing owner IDs by decimal string concatenation (`"prefix" + 10 = "prefix10"`), while the client uses base-36 encoding (`"prefixa"`). Refactored to use parent/child `createOwner()` pattern matching the client, ensuring ID parity for lists with 10+ items.

  **Dependency updates** — `@solidjs/signals` ^0.11.3 (fixes strictRead in computations), `dom-expressions` 0.41.0-next.11 (resolveAssets base path prefixing, removed NoHydration/Hydration stubs), `babel-plugin-jsx-dom-expressions` 0.41.0-next.11 (SSR conditional memo alignment).

  **Test fixes** — Updated strict read warning message assertion, fixed SSR streaming test manifests to use relative paths (matching real Vite output), removed stale TODO, added comprehensive test suites for NoHydration/Hydration, mapArray base-36 IDs, ternary conditional ID parity, and Show fallback hydration toggling.

- Updated dependencies [dadeeeb]
  - solid-js@2.0.0-beta.1

## 2.0.0-beta.0

### Major Changes

- 2645436: Update to R3 based signals
- a4c833d: Update to new package layout, signals implementation, compiler

### Patch Changes

- b1646a5: update signals
- c74106f: fix multi insert/removal, ssr wip, async signal render
- 433eae5: Add `runWithOwner` to rxcore shim to support callback refs from updated dom-expressions runtime
- Updated dependencies [512fd5e]
- Updated dependencies [dea16f3]
- Updated dependencies [15dc3c6]
- Updated dependencies [c3e5e78]
- Updated dependencies [874c256]
- Updated dependencies [4cab248]
- Updated dependencies [1122d74]
- Updated dependencies [c78ec9f]
- Updated dependencies [9788bad]
- Updated dependencies [21fff6f]
- Updated dependencies [2645436]
- Updated dependencies [60f2922]
- Updated dependencies [433eae5]
- Updated dependencies [b1646a5]
- Updated dependencies [e8d8403]
- Updated dependencies
- Updated dependencies [1a1a5d4]
- Updated dependencies [5f29f14]
- Updated dependencies [85aa54f]
- Updated dependencies [433eae5]
- Updated dependencies [c74106f]
- Updated dependencies [f4b0956]
- Updated dependencies [3e3c875]
- Updated dependencies [75eebc2]
- Updated dependencies [568ed6f]
- Updated dependencies [75eebc2]
- Updated dependencies [d1e6e29]
- Updated dependencies [a4c833d]
- Updated dependencies [84c80f9]
- Updated dependencies [381d895]
- Updated dependencies [fbbd7e3]
- Updated dependencies [53dcb14]
- Updated dependencies [dea16f3]
  - solid-js@2.0.0-beta.0
