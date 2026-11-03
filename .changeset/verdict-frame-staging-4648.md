---
"@solidjs/signals": patch
---

An `isPending()` probe in a derivation that reads a hold's (or this flush's) staging now reads that staging, as the derivation's plain reads do, instead of the committed value beside it; and a probe of a first value staged in the current flush reads that value instead of `undefined` (#4648).
