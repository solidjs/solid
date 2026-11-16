---
"@solidjs/signals": patch
---

fix(signals): a returned landing no longer reconciles its answer into a row another store lent, which made two keyed optimistic stores wait on each other and overflowed the stack in `reasks()` (#4928)
