---
"solid-js": patch
---

Add dev-mode enforcement of Loading boundaries for async content. During `render()`, async values consumed by JSX without a `<Loading>` boundary now throw an error catchable by `<Errored>` boundaries. Re-export `enforceLoadingBoundary` from `@solidjs/signals`.
