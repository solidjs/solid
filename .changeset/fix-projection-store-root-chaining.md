---
"@solidjs/signals": patch
---

Fix `createProjection(() => store)` not updating when the source store is mutated (#2941). A projection commit whose derive returns a foreign store now adopts it as the live backing (store-in-store chain) instead of flattening a disconnected raw copy, so the source's updates flow through the projection with no re-derive — restoring the beta.15 semantics without regressing the #2825 self-proxy guards.
