---
"solid-js": patch
---

Make `createSelector` transition-aware. Subscribers were marked stale on `state` even when a transition was running, so a selector driving `<Show>` or `classList` stayed stale after the first `startTransition` update (router navigations, SolidStart + Suspense).
