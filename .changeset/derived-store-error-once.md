---
"@solidjs/signals": patch
---

A derived store (`createStore(fn)`, `createProjection`, `createOptimisticStore(fn)`) hands an upstream error to its readers once: a re-run of the derive that meets the same error no longer re-runs a reader already showing it, so an effect's error arm runs once per error.
