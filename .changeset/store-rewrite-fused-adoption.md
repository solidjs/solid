---
"@solidjs/signals": patch
---

Store rewrite performance: the adoption walk notifies inline (fused single
pass — descend first so identity-preserved slots stay silent, then per-key
node notification), replacing the separate fold re-walk. Deleted keys ride a
counted fast-out; presence/membership stay as a shared tail. Fold writes pass
values directly instead of allocating a closure per changed key.
