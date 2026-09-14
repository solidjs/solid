---
"@solidjs/universal": patch
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

The universal renderer's `spread()` follows the `@solidjs/web` contract (#3388): `ref` folds into the props effect and is re-applied only when its identity changes (refs run with no owner, so nothing they create is disposed by the fold); children keep their own owned `insert` — that effect owns the child subtree — but a plain object whose `children` is a data property inserts the value with no effect at all. Three reactive nodes become two when children flow through the spread, one when they don't. `spread` also resolves a lone function source inside its own tracking scopes and accepts an array of sources — `spread(node, [a, b], skipChildren)` — the union of their keys with later sources winning, only the winning source read, function sources called inline with no merge and no memo. Both compilers' universal output uses it: a lone spread passes straight through (reactive included, no more `mergeProps(() => …)`), and several sources compile to the array instead of a `mergeProps()` call.
