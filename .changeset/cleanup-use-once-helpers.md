---
"@solidjs/signals": patch
"@solidjs/web": patch
---

Internal cleanup with no behavior change: inline four single-use helpers (`hasContext`/`isUndefined`, `markCovered`, `shallowWithSymbols`), delete two dead ones (`isNextProxy`, `ownEnumerableKeysPlain`), and collapse `spread()`'s nullish-source handling into one accessor closure. A few dozen bytes off the app scenarios.
