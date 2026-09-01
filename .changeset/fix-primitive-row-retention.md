---
"@solidjs/signals": patch
---

Primitive rows participate in structural identity matching keyed by their value: buildRowOps only admitted wrappable rows to the occurrence-aware key queues, so a primitive permutation emitted all-new sources and rebuilt every moved row instead of retaining nodes — classic value-identity now moves them, with duplicate occurrences already sound through the existing queues.
