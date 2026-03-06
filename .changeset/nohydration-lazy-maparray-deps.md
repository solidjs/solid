---
"solid-js": patch
"@solidjs/web": patch
---

Add NoHydration/Hydration components, expose moduleUrl on lazy, fix mapArray hydration ID mismatch, update dependencies

**NoHydration / Hydration components** — Moved from dom-expressions into solid-js using the owner-tree context API. `NoHydration` suppresses hydration keys and signal serialization for its children. `Hydration` re-enables hydration within a `NoHydration` zone with an `id` prop matching the client's `hydrate({ renderId })`. On the client, `NoHydration` skips rendering during hydration; `Hydration` is a passthrough. Lazy components inside `NoHydration` register CSS but not JS modules, enabling code-split islands without a compiler.

**lazy().moduleUrl** — Exposed `moduleUrl` as a read-only property on lazy component wrappers (both client and server) to support Islands architectures and advanced asset discovery.

**mapArray hydration ID fix** — Server-side `mapArray` was constructing owner IDs by decimal string concatenation (`"prefix" + 10 = "prefix10"`), while the client uses base-36 encoding (`"prefixa"`). Refactored to use parent/child `createOwner()` pattern matching the client, ensuring ID parity for lists with 10+ items.

**Dependency updates** — `@solidjs/signals` ^0.11.3 (fixes strictRead in computations), `dom-expressions` 0.41.0-next.11 (resolveAssets base path prefixing, removed NoHydration/Hydration stubs), `babel-plugin-jsx-dom-expressions` 0.41.0-next.11 (SSR conditional memo alignment).

**Test fixes** — Updated strict read warning message assertion, fixed SSR streaming test manifests to use relative paths (matching real Vite output), removed stale TODO, added comprehensive test suites for NoHydration/Hydration, mapArray base-36 IDs, ternary conditional ID parity, and Show fallback hydration toggling.
