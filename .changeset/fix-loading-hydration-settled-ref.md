---
"solid-js": patch
---

**Loading hydration (client):** Serialized boundary refs that are already settled (`{ s: 1, v }`) still run one deferred `resumeBoundaryHydration` (with optional lazy-asset wait) so inner memos/projections match SSR; a per-boundary closure flag prevents double-scheduling—no global `WeakSet`/`Map`. Terminal serialized states `{ s: 1 }` and `{ s: 2 }` stay gather-only so a promise that later gets `p.s = 2` does not keep re-entering the pending branch and trapping the UI on the fallback. Standalone asset loading only runs when `!sharedConfig.has(id)` so it does not duplicate work when the boundary ref path handles assets. `gather` is optional for test hosts.
