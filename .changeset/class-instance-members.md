---
"@solidjs/signals": patch
---

A class instance in a store: prototype getters now run on the store proxy, so they track the fields they read (a getter on a nested instance went stale before), and methods called outside a setter run on the raw instance, so objects that manage their own state (actors, clients) keep working when held in a store. Methods called on a draft still write reactively. For derived values read in effects or JSX, use a getter rather than a method (documented in the stores guide).
