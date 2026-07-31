---
"@solidjs/web": patch
---

Hand slot claims over from the enclosing hydration registry. `hydrate()`'s page-wide sweep gathers every `_hk` node including client slot roots inside server component frames, but adoption only ever claims them through its scoped registry — the root registry's copies survived to the end of hydration and every page load warned about "unclaimed" nodes that were claimed and live. The claim scope now removes its keys from the enclosing registry when it takes ownership of a range.
