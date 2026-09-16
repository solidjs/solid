---
"@solidjs/signals": patch
---

`omit()` combines folded filters into one exact-size list while short, and chains them past that

When an omit folds over another view — an omit of an omit, or of a merge with omit leaves — the two filters were combined into one key list per leaf, per layer, by `slice()` + `push`. V8 grows the backing store to `1.5n + 16` slots on that push, so each copy allocated 2.4–2.7× an exact one, and on a component chain (defaults → omit → statics → omit …) the copies held every key hidden so far, growing with the depth. Two short lists now combine with `concat` — one builtin call, exact-size — up to 8 keys; past that, or with a predicate on either side, they chain as one two-field link over the filter folded, with no copy at all. A predicate filter no longer needs a closure to combine, and a filter with nothing to hide adds nothing.

Tier-1 `polymorphic-chain` SSR bench (Kobalte shape, `renderToString`, 200 rows): −17% optimized, −12% Sparkplug, −7% interpreter. Depth-7 props chain: build −14%, build + consume −9% optimized; +3–5% in the bytecode tiers, where the walk over the links past the copy limit costs more than one `includes` over a flat list would.
