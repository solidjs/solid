---
"@solidjs/signals": patch
---

A sync derived store over a failing sync memo hands each new error to its readers once per flush, not twice: the error a source propagates to the derive now reaches the family's dedupe.
