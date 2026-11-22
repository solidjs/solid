---
"@solidjs/signals": patch
---

A cleanup that runs while a transition lands and writes a node that transition still holds no longer evicts another live transition (its `isPending` stayed `true` forever) or folds a live transition into the landed one (#5159).
