---
"@solidjs/web": patch
"@solidjs/signals": patch
"solid-js": patch
---

`spread()` reads a `merge()` proxy through its sources instead of through the proxy. A spread mixed with other attributes compiles to `spread(el, merge(statics, () => rest))`; going through the proxy cost merge's `keys()` (a `Set` plus an own-enumerable scan of every source) and then, per key, a right-to-left `in` walk of the sources, on every run. The spread now iterates the flattened sources directly — the union of own string keys, later sources overriding earlier, `children`/`ref` excluded — and enumerates each source through the same single-trap path as `readShallow()`. `omit()` is not a merge and stays opaque: it is enumerated through its own filtering trap. Own keys only, per source: a key an earlier source owns and a later source merely inherits resolves to the earlier source's value (the proxy's `in` walk saw the inherited one) — spread has always applied own properties only. `@solidjs/signals` gains an `@internal` `mergeSources()`. Guarded by the Tier-1 `spread-enumerate` bench (`merge(static, reactive)` row).
