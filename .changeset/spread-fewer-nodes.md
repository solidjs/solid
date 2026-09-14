---
"@solidjs/web": patch
---

`spread()` creates fewer reactive nodes per element (#3388): `ref` folds into the attribute effect and is re-applied only when its identity changes (refs run with no owner, so nothing they create is disposed by the fold); children keep their own owned `insert` — that effect owns the child subtree, and merging it would rebuild the children on every attribute change — but a plain object whose `children` is a data property inserts the value with no effect at all. Three nodes become two when children flow through the spread, one when they don't. `spread` also accepts an array of sources with an optional `skip` predicate — `spread(el, [a, b], skipChildren, skip)` — the union of own keys with later sources winning, only the winning source read, function sources called inline with no memo (and so no hydration id), matching the server `ssrElement` array form.
