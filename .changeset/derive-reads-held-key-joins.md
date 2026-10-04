---
"@solidjs/signals": patch
---

Size audit (measurement branch): a derived store's derive reading a key (or container) a transaction holds through its draft — a user's write inside an action, held with it — joins that transaction, so the derive's whole result reveals with the action rather than key by key (core R31 / #3733: "under the transaction and revealed with it"; the `derived-write-then-derivation-3733` action-hold pin). A user setter reading its own draft is no pass and joins nothing.
