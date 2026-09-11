---
"@solidjs/signals": patch
---

Projection leaf nodes are released when their readers let go (#3351). Every node materialized under a projection or derived store is linked into the projection computed's firewall child chain; the chain was append-only, so a long-lived keyed record retained one node — and the last value it served — per leaf ever read, until the projection itself was disposed. The chain is now doubly linked and the unobserved sweep unlinks the node in O(1), so deleted rows and their nested objects are collectable while the projection stays live, and the per-mark child walk covers live leaves only.
