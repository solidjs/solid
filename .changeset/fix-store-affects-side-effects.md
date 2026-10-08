---
"@solidjs/signals": patch
---

Fix `affects(store, key)` throwing `TypeError: _.O is not a function` in production bundles: the package's `sideEffects` now declares the prod and observe `store/affects.js` modules, which install the store half of `affects()` on import, so bundlers keep them in apps that use stores (apps without stores still leave them out).
