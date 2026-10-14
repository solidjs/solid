---
"@solidjs/signals": patch
---

Fix `affects(store)` / `affects(store, key)` throwing `TypeError: _.O is not a function` in tree-shaken production and observe bundles (#3891). The store half of `affects()` was installed by a side-effect-only import that bundlers drop under `"sideEffects": false`; `affects()` now installs it on its first store-targeted call, and the store half reaches the store engine through hook slots instead of importing it — so a store app that never calls `affects()` carries none of it, and an app without stores never pulls in the store engine. Thanks to @nickshiro, whose #3912 proposed installing it from `affects()`.
