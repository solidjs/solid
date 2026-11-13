---
"@solidjs/signals": patch
---

The attribution engine no longer keeps disposed scopes, async sources and loading boundaries alive. The `costs()` and `feedback()` rows were stored in maps keyed by the node, and the rerun history reached the written signal and the writing effect through its records, so a disposed component stayed reachable, with its owner and DOM, until the engine was reset or the record left the history. Rows are now looked up through a `WeakMap`, the history holds those nodes through a `WeakRef`, and `costs()` folds the rows of collected scopes into one row per name and kind, so a component that mounts again adds no row. A scope's own row is gone from `costs()` once the scope is collected; its totals are in the shared row.
