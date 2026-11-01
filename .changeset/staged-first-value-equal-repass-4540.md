---
"@solidjs/signals": patch
---

fix(signals): a re-pass equal to a first value already staged this flush is not a change, so a non-keyed `Show` over an async condition no longer remounts its child when the child writes the source on mount (#4540)
