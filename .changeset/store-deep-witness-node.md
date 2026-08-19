---
"@solidjs/signals": patch
---

Store: `deep()` subscribes one witness node per record instead of one node
per path. The rewrite's first `deep()` created and read a property node for
every reachable key on every effect re-run (~40% regression on the
single-deep()-effect benchmark vs the legacy per-record $TRACK). Targets now
carry a lazy deep-witness node: `deep()` reads the key-set node plus the
witness per record and walks targets directly (no per-child proxy
round-trips); write channels bump the witness only when it exists (one null
check otherwise). Declared affects() scopes mark the witness like any
property node, so isPending() probes over deep() reads keep working.
Benchmark restored to parity with the legacy implementation.
