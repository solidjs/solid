---
"@solidjs/web": patch
---

`ssrElement` accepts an array of prop sources and an optional `skip` predicate: `ssrElement(tag, [a, b, c], children, needsId, skip)`. The array form serializes straight from the sources with the exact output of `ssrElement(tag, merge(a, b, c), ...)` — later sources win per key, attributes land in merged order, only the winning source's getter is read (once), and `skip(key)` drops a key from every source without reading it — so libraries and compilers spreading several sources no longer have to build an intermediate merged object that is walked once and discarded. The array (or a thunk yielding it) is resolved after the hydration key is taken; a function source is a plain thunk called once that creates no memo and consumes no hydration ids. Nullish sources are empty. The single-object form is unchanged.
