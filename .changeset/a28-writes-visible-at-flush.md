---
"@solidjs/signals": patch
---

A write becomes visible at flush — to every channel (A28). Between `set(x)` and the flush that carries it, the write is not the committed value, not the staged value `latest()` / `isPending()` serve, and not an input to any derivation created meanwhile: `latest(x)` answers the pre-write value, `isPending(x)` is false, `until()`'s predicate evaluated in the carrying flush sees it. Optimistic writes are writes too (A28 (5), "match React"): `setOptimistic(v)` becomes the active override at the flush that carries it — plain reads, `snapshot()`, `in`, keys, `length` and `isPending()` see nothing before — while the writer's own channels (a functional updater, the store draft, the `affects()` declaration walk) compose on it. A rewrite of a node a transaction holds keeps the staged value the last flush left for `latest()`/verdicts until the next flush. Companions and store keys first materialized under a hold are born as the holding transaction's (#3336).

Landed as a read-side rule rather than #3337's deferred subscriber walk: "unflushed" is structural (an ambient staged value outside a flush), the plain write path is untouched, and readers served the flushed value are latched for the carrying flush. Supersedes the #2922 mid-tick `latest()` pull (`flush()` first to read your own write) and re-pins the pre-A28 expectations accordingly.
