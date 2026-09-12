---
"@solidjs/web": patch
---

Call `runHydrationEvents()` after `dynamic()` spreads props onto a string tag, so events the hydration script queued for a `<Dynamic>` element are replayed instead of being dropped until `_$HY.done`.
