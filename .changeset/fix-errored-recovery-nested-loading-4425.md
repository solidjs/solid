---
"@solidjs/signals": patch
---

An `<Errored>` healing after a refresh no longer waits on a `<Loading>` born in the recovery pass: the D-39 parent walk in `caught()` fires only for a boundary that already existed (#4425)
