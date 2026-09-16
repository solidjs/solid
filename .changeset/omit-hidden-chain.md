---
"@solidjs/signals": patch
---

`omit()` chains folded filters instead of copying them

When an omit folds over another view — an omit of an omit, or of a merge with omit leaves — the two filters were combined into one key list per leaf, per layer. On a component chain (defaults → omit → statics → omit …) each copy held every key hidden so far, growing with the depth: at depth 7 the copies were the largest allocation of the views (100–450 bytes a leaf, more with `push` growth of the backing store). A filter is now one two-field link over the filter it folds; a check walks the links, doing the same `includes` work the combined list did. A filter with nothing to hide adds no link, and a predicate filter no longer needs a closure to combine.

Depth-7 Kobalte-shaped chain, optimized: build −32%, build + consume −11%, bytes allocated −23%. The `polymorphic-chain` SSR case allocates 17% less per instance. In the bytecode tiers (interpreter, Sparkplug) the check-heavy consume is 5–9% more instructions, since one `includes` builtin over a flat list is the cheapest possible check there; that is the trade, made for the optimized tiers and the allocation rate a server sees.
