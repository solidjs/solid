# @solidjs/web

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
