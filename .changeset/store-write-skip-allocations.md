---
"@solidjs/signals": patch
---

A store setter no longer allocates a Set for its write scope, and a setter that writes one key of a record keeps that key bare instead of in a Set. A single-key write through a store setter is about 22% faster.
