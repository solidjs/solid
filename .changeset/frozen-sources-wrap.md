---
"@solidjs/signals": patch
"solid-js": patch
---

Frozen plain objects and arrays inside a store now wrap and track like unfrozen ones. Stores never write to their sources, so there is nothing for a freeze to protect, and serving a frozen subtree as one plain value made every reader under it re-run on any change. Libraries that freeze their state (XState in development, for example) are now fine-grained. To keep a value plain, use a shallow store (`createStore(value, { shallow: true })`). Also fixes a proxy-invariant TypeError when reading the `length` descriptor of a frozen source array.
