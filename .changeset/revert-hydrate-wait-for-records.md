---
"@solidjs/web": patch
---

Revert #3615: `hydrate()` no longer defers on `_$HY.p`; the ordering it guarded against does not occur in a correctly assembled document.
