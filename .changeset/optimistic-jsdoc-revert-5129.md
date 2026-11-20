---
"solid-js": patch
"@solidjs/signals": patch
---

Docs: the `createOptimistic`, `createOptimisticStore` and `action` JSDoc now say that optimistic writes always revert when the action settles, and their examples keep the result by refreshing or writing the source of truth. The previous examples kept nothing (#5129).
