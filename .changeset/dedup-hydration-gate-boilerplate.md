---
"solid-js": patch
---

Deduplicate the pre-hydration gate lifecycle shared by the ssrSource client/hybrid branches (signal, store, and effect shapes) into one helper — no behavior change, recovers ~40 B brotlied in store-carrying hydrating bundles.
