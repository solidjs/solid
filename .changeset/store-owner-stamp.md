---
"@solidjs/signals": patch
---

Store-owned backings now carry their owning target under an internal enumerable symbol stamp instead of registering in two weak collections (ownership set + raw→target map) on every draft — the identity-hash/ephemeron cost of those registrations was the remaining floor of a one-key store write (#3360, part two). Steady-state single-key writes drop from ~340 ns to ~180 ns; reconcile and projection benches improve 10–80%. The stamp is invisible through the proxy (`ownKeys`, `in`, descriptors, spreads), never appears in `snapshot()` output, never acquires a node, and is skipped by every key walk (membership/deep-witness diffs, reconcile, optimistic staging, affects scopes).
