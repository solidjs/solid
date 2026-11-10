---
"@solidjs/signals": patch
---

A bundle that uses stores without importing `deep()` no longer ships the store's deep-tracking bookkeeping: the write and reconcile paths check a module flag that only `deep()` sets, so a bundler drops the guarded code.
