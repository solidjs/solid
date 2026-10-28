---
"@solidjs/signals": patch
"solid-js": patch
---

The first draft write to a plain store array clones it with `slice()` instead of copying one property descriptor per element. A push into a 10,000-row store drops from ~10.7 ms to ~0.15 ms per write. Arrays with accessors, named keys or a non-Array prototype keep the descriptor copy.
