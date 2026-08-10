---
"solid-js": minor
---

Hydration guard for `loadingValue` / `seedLoadingValue`: until SSR renders commit #0, the server ignores loading values — an async source suspends into its Loading boundary and streams the real value — so a node hydrating with an open loading window would compute structure from the placeholder while claiming DOM the server rendered from real data (a `Show` over `data.skeleton` claims the wrong branch and corrupts the hydration walk). The hydration-aware primitive wrappers now drop `loadingValue`/`seedLoadingValue` while hydrating: the node adopts the serialized server value exactly like any async source, and loading values apply only to fresh client mounts, where commit #0 is correct by construction. Server-side rendering of commit #0 (placeholder in HTML, landing streamed as data) is the follow-up that replaces this guard.
