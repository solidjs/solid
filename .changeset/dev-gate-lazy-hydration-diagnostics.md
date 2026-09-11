---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
---

Move the #3338 diagnostics out of prod bytes. The `lazy()` "not preloaded" explanation and the document-root preload-failure framing are dev-only; prod keeps terse messages and, at a document root, hands the preload failure itself to `reportError` (no wrapper `Error`). The `haltReactivity` `reportError` hand-off is compacted.
